// Run: bun test packages/reasoning/tests/kernel/reason/thinking-runaway-recovery.test.ts --timeout 20000
//
// H3 baseline 2026-11-05, defect 3 (trace 01M6PGRP1VPDDD0ENTKMEKCT1T, qwen rw-7
// run0): a think call stopped at max_tokens with EMPTY content after ~99 s of
// thinking. Stage-1 recovery re-ran it at maxOutputTokensOverride 64_000 for 44 s
// more, and every qwen rw-7 cell hit the 150 s timeout. Empty content with a
// thinking body is a runaway, not a truncated answer: it must not get a bigger
// budget. It gets one retry at the same budget, then an honest failure, and the
// trace records a `thinking-runaway` signal.
//
// RED-ON-CUT: in normalize-think-response.ts, delete the isThinkingRunaway(...)
// early return and the first test fails (override 64_000 is set).
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService, TestLLMService, type CompletionRequest, type StreamEvent } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { TextParseDriver } from "@reactive-agents/tools";
import { handleThinking } from "../../../src/kernel/capabilities/reason/think.js";
import { noopHooks, type KernelContext, type KernelState } from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import { NO_TOOL_EVIDENCE } from "../../../src/kernel/capabilities/verify/requirement-state.js";
import {
  THINKING_RUNAWAY_MESSAGE,
  isThinkingRunaway,
  isThinkingRunawayRetry,
} from "../../../src/kernel/capabilities/reason/thinking-runaway.js";

const LONG_THINKING = "Let me think about this. ".repeat(400);

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "thinking-runaway",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [],
    evidence: NO_TOOL_EVIDENCE,
    ...overrides,
  } as KernelState;
}

const context: KernelContext = {
  input: { task: "Do a task", availableToolSchemas: [] },
  profile: CONTEXT_PROFILES["local"],
  compression: { enabled: false, maxResultChars: 4000, previewLines: 10, arrayPreviewItems: 5 },
  toolService: { _tag: "None" },
  hooks: noopHooks,
  toolCallingDriver: new TextParseDriver(),
} as KernelContext;

function llmLayer(content: string) {
  const events: StreamEvent[] = [
    { type: "thinking_delta", thinking: LONG_THINKING },
    ...(content ? [{ type: "text_delta" as const, text: content }] : []),
    { type: "content_complete", content, stopReason: "max_tokens", thinking: LONG_THINKING },
    { type: "usage", usage: { inputTokens: 10, outputTokens: 7200, totalTokens: 7210, estimatedCost: 0 } },
  ];
  const base = TestLLMService([{ text: "" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      stream: () => Effect.succeed(Stream.fromIterable(events)),
      getModelConfig: () => Effect.map(base.getModelConfig(), (c) => ({ ...c, provider: "ollama" as const, model: "qwen3:4b" })),
    }),
  );
}

async function think(state: KernelState, content: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      const result = yield* handleThinking(state, context);
      const signals = (yield* Ref.get(events)).flatMap((e) =>
        e._tag === "HarnessSignalInjectedEmitted" && e.origin === "thinking-runaway" ? [e] : [],
      );
      return { result, signals };
    }).pipe(Effect.provide(Layer.mergeAll(llmLayer(content), EventBusLive))),
  );
}

describe("thinking runaway at max_tokens", () => {
  it("does not escalate the budget: one retry at the same budget with a recovery turn", async () => {
    const { result, signals } = await think(makeState(), "");
    expect(result.status).not.toBe("failed");
    expect(result.maxOutputTokensOverride).toBeUndefined();
    expect(result.maxOutputTokensRecoveryCount).toBe(1);
    const last = result.messages[result.messages.length - 1];
    expect(last).toMatchObject({ role: "user", content: THINKING_RUNAWAY_MESSAGE });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.metadata).toMatchObject({ attempt: 1, exhausted: false, thinkingChars: LONG_THINKING.length });
  });

  it("a second runaway after the retry fails the run honestly and records it", async () => {
    const { result, signals } = await think(makeState({ maxOutputTokensRecoveryCount: 1 }), "");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("thinking runaway");
    expect(signals[0]!.metadata).toMatchObject({ attempt: 2, exhausted: true });
  });

  it("CONTROL: a truncated answer (content present) still escalates at Stage 1", async () => {
    const { result, signals } = await think(makeState(), "Here is the partial answer that got cut");
    expect(result.maxOutputTokensOverride).toBe(64_000);
    expect(signals).toHaveLength(0);
  });
});

// Plan 9 #9: the one retry drops thinking (CompletionRequest.thinking = false,
// 63efee770). Same budget + thinking still on tends to run away again.
// RED-ON-CUT: drop the `thinking: false` spread in prepare-think-gateway-call.ts
// and the retry assertion fails (request.thinking is undefined).
describe("thinking runaway retry turns thinking off", () => {
  async function thinkRecording(state: KernelState) {
    const requests: CompletionRequest[] = [];
    const base = TestLLMService([{ text: "" }]);
    const events: StreamEvent[] = [
      { type: "thinking_delta", thinking: LONG_THINKING },
      { type: "content_complete", content: "", stopReason: "max_tokens", thinking: LONG_THINKING },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 7200, totalTokens: 7210, estimatedCost: 0 } },
    ];
    const layer = Layer.succeed(
      LLMService,
      LLMService.of({
        ...base,
        stream: (req: CompletionRequest) => {
          requests.push(req);
          return Effect.succeed(Stream.fromIterable(events));
        },
        getModelConfig: () => Effect.map(base.getModelConfig(), (c) => ({ ...c, provider: "ollama" as const, model: "qwen3:4b" })),
      }),
    );
    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(Layer.mergeAll(layer, EventBusLive))),
    );
    return { result, requests };
  }

  it("first call leaves thinking unset; the retry sends thinking: false", async () => {
    const first = await thinkRecording(makeState());
    expect(first.requests).toHaveLength(1);
    expect(first.requests[0]!.thinking).toBeUndefined();
    expect(isThinkingRunawayRetry(first.result)).toBe(true);

    const retry = await thinkRecording(first.result);
    expect(retry.requests).toHaveLength(1);
    expect(retry.requests[0]!.thinking).toBe(false);
  });

  it("CONTROL: a Stage-2 recovery turn (truncated answer) keeps thinking unset", async () => {
    const state = makeState({
      maxOutputTokensOverride: 64_000,
      maxOutputTokensRecoveryCount: 1,
      messages: [{ role: "user", content: "[Harness] Output token limit hit. Resume directly." }],
    });
    expect(isThinkingRunawayRetry(state)).toBe(false);
    const { requests } = await thinkRecording(state);
    expect(requests[0]!.thinking).toBeUndefined();
  });
});

describe("isThinkingRunaway (seam pin)", () => {
  it("needs empty visible content, no tool call and a thinking body", () => {
    expect(isThinkingRunaway("", "thought", 0)).toBe(true);
    expect(isThinkingRunaway("<think>only inline thinking</think>  ", "", 0)).toBe(true);
    expect(isThinkingRunaway("", "thought", 1)).toBe(false);
    expect(isThinkingRunaway("answer", "thought", 0)).toBe(false);
    expect(isThinkingRunaway("", "", 0)).toBe(false);
  });
});
