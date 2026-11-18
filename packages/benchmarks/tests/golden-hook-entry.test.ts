import { describe, expect, it } from "bun:test";
import { toHookEntry } from "../scripts/golden-run-builder.js";

describe("toHookEntry", () => {
  it("tags kernel per-turn hooks with iteration", () => {
    const e = toHookEntry("act", "before", 1, { iteration: 2 });
    expect(e).toEqual({ phase: "act", timing: "before", t: 1, source: "kernel", iteration: 2 });
  });

  it("tags engine post-loop hooks with stepsCount, not iteration", () => {
    const e = toHookEntry("complete", "after", 1, { metadata: { stepsCount: 7 } });
    expect(e.source).toBe("engine");
    expect(e.stepsCount).toBe(7);
    expect("iteration" in e).toBe(false);
  });

  it("handles missing ctx as engine with no counters", () => {
    const e = toHookEntry("think", "before", 1, undefined);
    expect(e).toEqual({ phase: "think", timing: "before", t: 1, source: "engine" });
  });
});
