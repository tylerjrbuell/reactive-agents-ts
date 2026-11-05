// #281 — direct-import behavioral pins for iterate-guard-seams.ts (extracted
// verbatim from iterate-pass.ts, #222). The lane stamp decides gather vs
// synthesize for every pass; the ICS step must be a strict no-op when the
// caller disallows the nudge.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  applyExecutionLane,
  runAutoCheckpointStep,
  runIcsNudgeStep,
} from "../../../src/kernel/loop/iterate-guard-seams.js";
import { initialKernelState, type KernelInput } from "../../../src/kernel/state/kernel-state.js";
import type { ContextProfile } from "../../../src/context/context-profile.js";

const baseState = () => initialKernelState({ maxIterations: 5, strategy: "reactive", kernelType: "react" });

describe("applyExecutionLane", () => {
  it("stamps gather + the missing required tools while required tools are unmet", () => {
    const input: KernelInput = { task: "t", requiredTools: ["web-search"] };
    const { state, laneDecision } = applyExecutionLane({ state: baseState(), currentInput: input });
    expect(laneDecision.lane).toBe("gather");
    expect(state.meta.executionLane).toBe("gather");
    expect(state.meta.missingRequiredTools).toEqual(["web-search"]);
  });

  it("stamps synthesize with nothing missing when no tools are required", () => {
    const { state, laneDecision } = applyExecutionLane({ state: baseState(), currentInput: { task: "t" } });
    expect(laneDecision.lane).toBe("synthesize");
    expect(state.meta.executionLane).toBe("synthesize");
    expect(state.meta.missingRequiredTools).toEqual([]);
  });

  it("preserves unrelated meta already on the state", () => {
    const seeded = initialKernelState({
      maxIterations: 5,
      strategy: "reactive",
      kernelType: "react",
      meta: { keepMe: 1 },
    });
    const { state } = applyExecutionLane({ state: seeded, currentInput: { task: "t" } });
    expect(state.meta.keepMe).toBe(1);
  });
});

describe("runIcsNudgeStep", () => {
  const profile: ContextProfile = { tier: "mid" };

  it("is a strict no-op when the nudge is not allowed", async () => {
    const state = baseState();
    const out = await Effect.runPromise(
      runIcsNudgeStep({
        state,
        currentInput: { task: "t" },
        effectiveToolsUsed: new Set<string>(),
        profile,
        shouldAllowIcsNudge: false,
      }),
    );
    expect(out).toBe(state);
  });
});

describe("runAutoCheckpointStep", () => {
  it("does nothing (flag stays false, no log) far below the pressure gate", async () => {
    const logged: unknown[] = [];
    const out = await Effect.runPromise(
      runAutoCheckpointStep({
        state: baseState(),
        profile: { tier: "mid", maxTokens: 1_000_000 },
        autoCheckpointed: false,
        emitLog: (e) => Effect.sync(() => void logged.push(e)),
      }),
    );
    expect(out).toEqual({ autoCheckpointed: false });
    expect(logged).toEqual([]);
  });

  it("an already-checkpointed pass is never re-checkpointed", async () => {
    const out = await Effect.runPromise(
      runAutoCheckpointStep({
        state: baseState(),
        profile: { tier: "mid", maxTokens: 1 },
        autoCheckpointed: true,
        emitLog: () => Effect.void,
      }),
    );
    expect(out).toEqual({ autoCheckpointed: true });
  });
});
