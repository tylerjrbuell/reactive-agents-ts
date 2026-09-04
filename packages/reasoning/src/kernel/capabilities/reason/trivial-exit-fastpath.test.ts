// Run: bun test packages/reasoning/src/kernel/capabilities/reason/trivial-exit-fastpath.test.ts
//
// Root fix 2026-09-04 (halopedia-agent trace investigation). The "FAST-PATH:
// trivial task exit" branch in think.ts (a substantive end_turn reply, no
// tool call, no ACTION:/FINAL ANSWER: marker, no required tools) used to be
// gated to `state.iteration === 0` only. A run that missed the fast-path on
// its first pass (the model chose to "think" once before answering, or the
// model's very first end_turn reply happened to be vetoed) had NO equivalent
// short-circuit on any later iteration — every subsequent pass fell through
// the full tool-oriented arbitrator pipeline with no path to recognize "the
// model is just talking, not acting" until the loop-detector's
// maxConsecutiveThoughts grace period (default 3-5) forcibly rescued it.
//
// Observed live: a Halopedia demo agent's banter/opinion chat turn
// re-generated near-identical conversational replies for 6 iterations before
// `graceful_thought` finally delivered iteration 0's answer verbatim (trace
// 01M1N9KCTCKZ1A3TNSCQJTQCHE — 6 consecutive "thinking" snapshots).
//
// This pins: the fast-path now fires identically on iteration 0 and on a
// later iteration, given the same qualifying reply.

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option, Stream } from "effect";
import { LLMService, type StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { handleThinking } from "./think.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";

const REPLY = "Anytime! Happy to dive into the deepest corners of the lore with you.";

const cannedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: REPLY },
  { type: "content_complete", content: REPLY },
  { type: "usage", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 } },
];

// stopReason "end_turn", no tool_calls — a plain, substantive conversational
// reply with nothing for the model to act on.
const stubLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: REPLY,
      stopReason: "end_turn",
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 },
      model: "test-model",
    }) as never,
  stream: () => Effect.succeed(Stream.fromIterable(cannedStreamEvents) as never),
  completeStructured: () => Effect.succeed({ ok: true }) as never,
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({} as never),
  getStructuredOutputCapabilities: () => Effect.succeed({} as never),
  capabilities: () => Effect.succeed({} as never),
} as never);

const input: KernelInput = {
  task: "Thanks, that's really cool!",
  availableToolSchemas: [
    { name: "halopedia-search", description: "Search Halopedia.", parameters: [] },
  ],
};

const runThink = (iteration: number): Promise<KernelState> => {
  const state: KernelState = {
    ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 12 }),
    iteration,
    messages: [{ role: "user" as const, content: input.task }],
  };
  const context: KernelContext = {
    input,
    profile: CONTEXT_PROFILES.local,
    compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
    toolService: Option.none(),
    hooks: noopHooks,
    toolCallingDriver: new NativeFCDriver(),
    memoryService: Option.none(),
  };
  return Effect.runPromise(handleThinking(state, context).pipe(Effect.provide(stubLLM)));
};

describe("trivial-exit fast-path fires beyond iteration 0", () => {
  it("terminates on iteration 0 (control — pre-existing behavior)", async () => {
    const result = await runThink(0);
    expect(result.status).toBe("done");
    expect(result.output).toContain("Anytime!");
  });

  it("terminates on iteration 2 — no longer stuck re-thinking (the root fix)", async () => {
    const result = await runThink(2);
    expect(result.status).toBe("done");
    expect(result.output).toContain("Anytime!");
  });

  it("terminates on iteration 5 too", async () => {
    const result = await runThink(5);
    expect(result.status).toBe("done");
    expect(result.output).toContain("Anytime!");
  });
});
