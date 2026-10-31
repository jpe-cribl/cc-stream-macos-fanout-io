import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parse as yamlParse } from "yaml";
import { PACK_ROOT } from "./cribl-client.js";

interface Route {
  id: string;
  pipeline: string;
  final: boolean;
  disabled?: boolean;
}

interface AggregationConf {
  aggregations: string[];
  groupbys: string[];
  cumulative?: boolean;
  metricsMode?: boolean;
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
    ["default", "drop_unmatched", true],
  ]);
});

it("disables the default route so unmatched events are dropped", () => {
  const { routes } = readYaml(join("default", "pipelines", "route.yml")) as {
    routes: Route[];
  };
  expect(routes.find((r) => r.id === "default")).toMatchObject({
    disabled: true,
  });
});

const METRICS: Record<string, { name: string; dimensions: string[] }> = {
  macos_process_starts: {
    name: "macos_process_starts_total",
    dimensions: ["host", "exe"],
  },
  macos_app_checkins: {
    name: "macos_app_checkins_total",
    dimensions: ["host", "app"],
  },
  macos_launchd_spawns: {
    name: "macos_launchd_spawns_total",
    dimensions: ["host", "label"],
  },
  macos_ws_monitor_gap: {
    name: "ws_monitor_gap_seconds",
    dimensions: ["host"],
  },
};

it("aggregates as native metrics named for the published series", () => {
  for (const [pipeline, { name, dimensions }] of Object.entries(METRICS)) {
    const conf = aggregationOf(pipeline);
    expect(conf.metricsMode, pipeline).toBe(true);
    expect(conf.aggregations, pipeline).toHaveLength(1);
    expect(conf.aggregations[0], pipeline).toMatch(
      new RegExp(`\\.as\\(${name}\\)$`),
    );
    expect(conf.groupbys, pipeline).toEqual(dimensions);
  }
});

it("pipelines stamp the metrics index and do not publish by field", () => {
  for (const pipeline of Object.keys(METRICS)) {
    const { functions = [] } = readYaml(
      join("default", "pipelines", pipeline, "conf.yml"),
    ) as {
      functions?: {
        id: string;
        conf?: { add?: { name: string; value: string }[] };
      }[];
    };
    expect(
      functions.some((fn) => fn.id === "publish_metrics"),
      pipeline,
    ).toBe(false);
    const stamped = Object.fromEntries(
      functions
        .flatMap((fn) => fn.conf?.add ?? [])
        .map((a) => [a.name, a.value]),
    );
    expect(stamped.index, pipeline).toBe("'os_metrics'");
  }
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
