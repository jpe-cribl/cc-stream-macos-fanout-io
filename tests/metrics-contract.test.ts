import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parse as yamlParse } from "yaml";
import { PACK_ROOT } from "./cribl-client.js";

interface Route {
  id: string;
  pipeline: string;
  final: boolean;
}

interface PublishConf {
  metrics: { field: string; metricName: string; type: string }[];
  dimensions: string[];
}

interface Pipeline {
  functions?: { id: string; conf?: unknown }[];
}

function readYaml(relative: string): unknown {
  return yamlParse(readFileSync(join(PACK_ROOT, relative), "utf8"));
}

function publisherOf(pipeline: string): PublishConf {
  const conf = readYaml(
    join("default", "pipelines", pipeline, "conf.yml"),
  ) as Pipeline;
  const publishers = (conf.functions ?? []).filter(
    (fn) => fn.id === "publish_metrics",
  );
  expect(
    publishers,
    `${pipeline} must publish exactly one metric set`,
  ).toHaveLength(1);
  return publishers[0]?.conf as PublishConf;
}

it("routes exec events to the starts pipeline without consuming them", () => {
  const { routes } = readYaml(join("default", "pipelines", "route.yml")) as {
    routes: Route[];
  };
  expect(routes.map((r) => [r.id, r.pipeline, r.final])).toEqual([
    ["process_exec_starts", "macos_process_starts", false],
    ["process_app_checkins", "macos_app_checkins", true],
    ["launchd_spawns", "macos_launchd_spawns", true],
    ["ws_monitor_gap", "macos_ws_monitor_gap", true],
  ]);
});

it("publishes the derived metric names, types, and dimensions", () => {
  expect(publisherOf("macos_process_starts")).toMatchObject({
    metrics: [
      {
        field: "starts",
        metricName: "'macos_process_starts_total'",
        type: "counter",
      },
    ],
    dimensions: ["host", "exe"],
  });
  expect(publisherOf("macos_app_checkins")).toMatchObject({
    metrics: [
      {
        field: "app_checkins",
        metricName: "'macos_app_checkins_total'",
        type: "counter",
      },
    ],
    dimensions: ["host", "app"],
  });
  expect(publisherOf("macos_launchd_spawns")).toMatchObject({
    metrics: [
      {
        field: "spawns",
        metricName: "'macos_launchd_spawns_total'",
        type: "counter",
      },
    ],
    dimensions: ["host", "label"],
  });
  expect(publisherOf("macos_ws_monitor_gap")).toMatchObject({
    metrics: [
      {
        field: "gap_seconds",
        metricName: "'ws_monitor_gap_seconds'",
        type: "gauge",
      },
    ],
    dimensions: ["host"],
  });
});
