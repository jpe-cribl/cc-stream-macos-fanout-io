import { expect, it } from "vitest";
import { getInstalledPackId, makeClient } from "./test-helpers.js";

it("drops events no earlier route consumed", async () => {
  const client = makeClient();
  const sampleId = await client.saveSample("unmatched-event", [
    {
      sourcetype: "ws-monitor",
      host: "example",
      source: "/var/log/example.jsonl",
      _time: 1781280000,
      _raw: "unmatched sample",
    },
  ]);

  try {
    const preview = await client.call("post", "/preview", {
      pack: getInstalledPackId(),
      payload: {
        mode: "pipe",
        pipelineId: "drop_unmatched",
        level: 3,
        sampleId,
        dropped: false,
        cpuProfile: false,
        timeout: 10_000,
        memory: 2048,
      },
    });
    const events =
      preview !== null &&
      typeof preview === "object" &&
      "items" in preview &&
      Array.isArray((preview as { items: unknown }).items)
        ? (preview as { items: unknown[] }).items
        : Array.isArray(preview)
          ? preview
          : [];
    expect(events).toHaveLength(0);
  } finally {
    await client.deleteSample(sampleId);
  }
});
