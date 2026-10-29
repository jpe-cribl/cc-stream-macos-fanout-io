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

interface AggregationConf {
  aggregations: string[];
  groupbys: string[];
  cumulative?: boolean;
}

interface Pipeline {
  functions?: { id: string; conf?: unknown }[];
}

function readYaml(relative: string): unknown {
  return yamlParse(readFileSync(join(PACK_ROOT, relative), "utf8"));
}

function functionConfOf<T>(pipeline: string, id: string): T {
  const conf = readYaml(
    join("default", "pipelines", pipeline, "conf.yml"),
  ) as Pipeline;
  const matches = (conf.functions ?? []).filter((fn) => fn.id === id);
  expect(
    matches,
    `${pipeline} must have exactly one '${id}' function`,
  ).toHaveLength(1);
  return matches[0]?.conf as T;
}

function publisherOf(pipeline: string): PublishConf {
  return functionConfOf<PublishConf>(pipeline, "publish_metrics");
}

function aggregationOf(pipeline: string): AggregationConf {
  return functionConfOf<AggregationConf>(pipeline, "aggregation");
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

const COUNTERS = [
  "macos_process_starts",
  "macos_app_checkins",
  "macos_launchd_spawns",
];

it("counters are cumulative and the window gauge is not", () => {
  for (const pipeline of COUNTERS) {
    expect(aggregationOf(pipeline).cumulative, pipeline).toBe(true);
  }
  expect(aggregationOf("macos_ws_monitor_gap").cumulative).not.toBe(true);
});

it("aggregation keys use the function schema names", () => {
  for (const pipeline of [...COUNTERS, "macos_ws_monitor_gap"]) {
    const conf = aggregationOf(pipeline);
    expect(conf.aggregations, pipeline).toBeDefined();
    expect(conf.groupbys, pipeline).toBeDefined();
    expect(conf).not.toHaveProperty("aggregates");
    expect(conf).not.toHaveProperty("groupByFields");
    expect(conf).not.toHaveProperty("idleBucketTimeLimit");
  }
});
