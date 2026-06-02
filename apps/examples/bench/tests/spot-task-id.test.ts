import { describe, it, expect } from "bun:test";
import { resolveSpotTask } from "../spot-task.js";

describe("resolveSpotTask", () => {
  it("resolves from SPOT_TASK_ID against the bench task set", () => {
    const r = resolveSpotTask({ SPOT_TASK_ID: "overflow-summarize" });
    expect(r.taskId).toBe("overflow-summarize");
    expect(r.tools).toContain("file-read");
    expect(r.expectedSections).toContain("## Summary");
    expect(r.prompt).toContain("bench-out/overflow-summarize.md");
  });
  it("falls back to SPOT_TASK/SPOT_TOOLS free-form (no expectedSections)", () => {
    const r = resolveSpotTask({ SPOT_TASK: "do x", SPOT_TOOLS: "file-write" });
    expect(r.prompt).toBe("do x");
    expect(r.tools).toEqual(["file-write"]);
    expect(r.expectedSections).toEqual([]);
    expect(r.taskId).toBeUndefined();
  });
});
