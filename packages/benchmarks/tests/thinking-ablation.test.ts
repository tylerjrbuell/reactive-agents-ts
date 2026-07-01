// File: tests/thinking-ablation.test.ts
//
// Structural test for the cross-tier thinking ablation session.
// Does NOT execute any LLM calls — verifies session shape only.
//
// Two assertions per the task-7 brief:
//   (1) variants are exactly ["thinking-off", "thinking-on"], tasks >= 3
//   (2) the thinking-on variant records thinking enabled in HarnessConfig.thinking

import { describe, it, expect } from "bun:test";
import { thinkingAblationSession } from "../src/sessions/thinking-ablation.js";
import type { InternalVariant } from "../src/types.js";

describe("thinking-ablation session", () => {
  it("defines thinking-off and thinking-on variants over reasoning-sensitive tasks", () => {
    const s = thinkingAblationSession();
    const names = s.harnessVariants.map((v) => v.id).sort();
    expect(names).toEqual(["thinking-off", "thinking-on"]);
    expect(s.taskIds!.length).toBeGreaterThanOrEqual(3);
  }, 15000);

  it("thinking-on variant enables thinking in HarnessConfig", () => {
    const s = thinkingAblationSession();
    const on = s.harnessVariants.find((v) => v.id === "thinking-on")! as InternalVariant;
    expect(on.config.thinking).toBe(true);
  }, 15000);

  it("thinking-off variant explicitly disables thinking in HarnessConfig", () => {
    const s = thinkingAblationSession();
    const off = s.harnessVariants.find((v) => v.id === "thinking-off")! as InternalVariant;
    expect(off.config.thinking).toBe(false);
  }, 15000);
});
