import { describe, expect, it } from "bun:test";
import { crashedRunDetail, crashedRunLabel, type CrashedRunWire } from "./crashed-runs.js";

const run = (over: Partial<CrashedRunWire> = {}): CrashedRunWire => ({
  runId: "01RUN",
  agentId: "cortex-desk-1-2",
  name: "Market report",
  startedAt: 0,
  durableRunId: "d-1",
  checkpointIteration: 2,
  updatedAt: Date.parse("2026-11-11T11:00:00Z"),
  ...over,
});

describe("crashed runs", () => {
  it("labels by name, else the agent id", () => {
    expect(crashedRunLabel(run())).toBe("Market report");
    expect(crashedRunLabel(run({ name: null }))).toBe("cortex-desk-1-2");
    expect(crashedRunLabel(run({ name: "  " }))).toBe("cortex-desk-1-2");
  });

  it("says which loop it resumes after (1-based) and when it was saved", () => {
    expect(crashedRunDetail(run(), Date.parse("2026-11-11T12:00:00Z"))).toBe(
      "Stopped mid-run · resumes after loop 3 · last saved 1 hour ago",
    );
  });
});
