import { describe, expect, it } from "bun:test";
import { DURABLE_RUNS_CHAT_DETAIL, durableRunsOn, durableRunsPatch, durableRunsValue } from "./durable-runs.js";

describe("durable runs config", () => {
  it("is on unless durableRuns.enabled is literally false (a config with no key reads as on)", () => {
    expect(durableRunsOn({})).toBe(true);
    expect(durableRunsOn({ durableRuns: {} })).toBe(true);
    expect(durableRunsOn({ durableRuns: { enabled: "no" } })).toBe(true);
    expect(durableRunsOn({ durableRuns: { enabled: true } })).toBe(true);
    expect(durableRunsOn({ durableRuns: { enabled: false } })).toBe(false);
    expect(durableRunsValue({})).toBe("On");
    expect(durableRunsValue({ durableRuns: { enabled: false } })).toBe("Off");
  });

  it("patches the same durableRuns shape the Builder writes and keeps other fields", () => {
    expect(durableRunsPatch({}, true)).toEqual({ durableRuns: { enabled: true } });
    expect(durableRunsPatch({ durableRuns: { enabled: true, checkpointEvery: 3, dir: "/x" } }, false)).toEqual({ durableRuns: { enabled: false, checkpointEvery: 3, dir: "/x" } });
  });

  it("explains resumable stops, approvals and the framework limit", () => {
    expect(DURABLE_RUNS_CHAT_DETAIL).toContain("Continue");
    expect(DURABLE_RUNS_CHAT_DETAIL).toContain("Approvals and questions");
    expect(DURABLE_RUNS_CHAT_DETAIL).toContain("framework limit");
  });
});
