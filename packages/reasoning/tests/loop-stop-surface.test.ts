// File: tests/loop-stop-surface.test.ts
// Pins the loop-stop resume surface on the package entry barrel.
import { describe, it, expect } from "bun:test";
import * as reasoning from "../src/index.js";
import type { LoopStopRecord, LoopStopToolDone } from "../src/index.js";

describe("loop-stop public surface", () => {
  it("exports the resume helpers as functions", () => {
    expect(typeof reasoning.resumeFromStop).toBe("function");
    expect(typeof reasoning.isLoopStopped).toBe("function");
    expect(typeof reasoning.isLoopStopReason).toBe("function");
    expect(typeof reasoning.resumeMaxIterations).toBe("function");
    expect(typeof reasoning.loopResumeGuidanceText).toBe("function");
  });

  it("types are nameable from the barrel", () => {
    const names: ReadonlyArray<keyof LoopStopRecord> = [];
    const done: ReadonlyArray<keyof LoopStopToolDone> = [];
    expect(names.length + done.length).toBe(0);
  });
});
