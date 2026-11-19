import { describe, expect, it } from "bun:test";
import { crashedRunDetail, crashedRunLabel, resumeCrashedRun, type CrashedRunWire } from "./crashed-runs.js";

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

describe("resumeCrashedRun", () => {
  it("hands back the NEW run's id (a Resume is a new linked run) and the refusal text", async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify({ agentId: "a", runId: "d-1-cont-0a1b2c3d" }), { status: 200 })) as unknown as typeof fetch;
      expect(await resumeCrashedRun("01RUN")).toEqual({ ok: true, runId: "d-1-cont-0a1b2c3d" });
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: "nope" }), { status: 404 })) as unknown as typeof fetch;
      expect(await resumeCrashedRun("01RUN")).toEqual({ ok: false, error: "nope" });
    } finally {
      globalThis.fetch = real;
    }
  });
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
