import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  HarnessPipeline,
  RegistrationHarness,
  type KernelStateLike,
  type BaseCtx,
  type NudgeCtx,
  type ToolResultCtx,
  type LifecycleFailurePayload,
  type ObservationStepLike,
} from "@reactive-agents/core";
import { emitToCompose } from "../../src/kernel/loop/compose-bridge.js";

// HS-112 — Compose bridge helper. The kernel emits previously-dead tags
// (`nudge.healing-failure`, `observation.tool-result`, `lifecycle.failure`,
// `control.strategy-evaluated`) through this helper so user-supplied taps
// can observe them. The helper guarantees three invariants:
//   1. always-success (observers can't crash the kernel)
//   2. no-op when no pipeline is attached
//   3. correct payload + ctx threading

const MOCK_STATE: KernelStateLike = {
  taskId: "t-test",
  strategy: "react",
  kernelType: "fc",
  steps: [],
  toolsUsed: new Set(),
  iteration: 1,
  tokens: 0,
  status: "thinking",
  output: null,
  error: null,
  meta: {},
};

const BASE_CTX: BaseCtx = {
  iteration: 1,
  phase: "act",
  state: MOCK_STATE,
  strategy: "react",
};

const TOOL_CTX: ToolResultCtx = {
  ...BASE_CTX,
  toolName: "shell-execute",
  callId: "call-1",
  healed: false,
  durationMs: 12,
};

const NUDGE_CTX: NudgeCtx = {
  ...BASE_CTX,
  trigger: "healing-failure",
  severity: "warn",
};

describe("emitToCompose", () => {
  it("is a no-op when no pipeline is provided", async () => {
    // No throw, returns undefined. The dead-tag emit sites pass
    // `state.harnessPipeline` directly without guarding, so the helper must
    // handle the no-harness-registered case without surfacing an error.
    const result = await Effect.runPromise(
      emitToCompose(undefined, "lifecycle.failure", {
        reason: "tool-error",
        errorMessage: "boom",
        attemptNumber: 1,
        failureStreak: 1,
        currentStrategy: "react",
      } satisfies LifecycleFailurePayload, BASE_CTX),
    );
    expect(result).toBeUndefined();
  });

  it("fires registered taps with payload and ctx", async () => {
    const h = new RegistrationHarness();
    const captured: Array<{ payload: unknown; ctx: unknown }> = [];
    h.tap("observation.tool-result", (payload, ctx) => {
      captured.push({ payload, ctx });
    });
    const pipeline = new HarnessPipeline(h._collected);

    const obs: ObservationStepLike = {
      type: "observation",
      content: "tool returned 'ok'",
      metadata: { toolCallId: "call-1" },
    };

    await Effect.runPromise(
      emitToCompose(pipeline, "observation.tool-result", obs, TOOL_CTX),
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.payload).toEqual(obs);
    expect((captured[0]?.ctx as ToolResultCtx).toolName).toBe("shell-execute");
  });

  it("fires taps for the 4 previously-dead tags", async () => {
    const h = new RegistrationHarness();
    const seen: string[] = [];
    h.tap("nudge.healing-failure", () => { seen.push("nudge.healing-failure"); });
    h.tap("observation.tool-result", () => { seen.push("observation.tool-result"); });
    h.tap("lifecycle.failure", () => { seen.push("lifecycle.failure"); });
    h.tap("control.strategy-evaluated", () => { seen.push("control.strategy-evaluated"); });
    const pipeline = new HarnessPipeline(h._collected);

    const obs: ObservationStepLike = { type: "observation", content: "x" };

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* emitToCompose(pipeline, "nudge.healing-failure", "heal failed", NUDGE_CTX);
        yield* emitToCompose(pipeline, "observation.tool-result", obs, TOOL_CTX);
        yield* emitToCompose(pipeline, "lifecycle.failure", {
          reason: "verifier-rejection",
          errorMessage: "claim not grounded",
          attemptNumber: 1,
          failureStreak: 0,
          currentStrategy: "react",
        }, BASE_CTX);
        yield* emitToCompose(pipeline, "control.strategy-evaluated", {
          currentStrategy: "react",
          score: 0.4,
          failureStreak: 2,
          recommendedAction: "switch",
          availableStrategies: ["react", "reflexion"],
        }, BASE_CTX);
      }),
    );

    expect(seen).toEqual([
      "nudge.healing-failure",
      "observation.tool-result",
      "lifecycle.failure",
      "control.strategy-evaluated",
    ]);
  });

  it("never propagates a throw from a user-registered transform", async () => {
    // Invariant 1: observers cannot crash the kernel. A transform that throws
    // must be swallowed so the calling Effect succeeds with void.
    const h = new RegistrationHarness();
    h.on("lifecycle.failure", () => {
      throw new Error("user transform bug — must not bubble");
    });
    const pipeline = new HarnessPipeline(h._collected);

    const result = await Effect.runPromise(
      emitToCompose(pipeline, "lifecycle.failure", {
        reason: "tool-error",
        errorMessage: "x",
        attemptNumber: 1,
        failureStreak: 1,
        currentStrategy: "react",
      }, BASE_CTX),
    );
    expect(result).toBeUndefined();
  });

  it("never propagates a throw from a user-registered tap", async () => {
    const h = new RegistrationHarness();
    h.tap("observation.tool-result", () => {
      throw new Error("tap bug — must not bubble");
    });
    const pipeline = new HarnessPipeline(h._collected);

    const result = await Effect.runPromise(
      emitToCompose(pipeline, "observation.tool-result", {
        type: "observation",
        content: "x",
      }, TOOL_CTX),
    );
    expect(result).toBeUndefined();
  });
});
