/**
 * max-output-tokens-recovery.test.ts
 *
 * TDD tests for two-stage max_output_tokens recovery in the kernel think phase.
 *
 * Stage 1: When stop_reason === "max_tokens" and no prior override, set
 *          maxOutputTokensOverride = 64_000, re-run same request.
 * Stage 2: When override already set, inject recovery message and continue.
 *          Maximum 3 Stage 2 attempts.
 * Exhausted: After 3 Stage 2 attempts, surface status "failed".
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { handleThinking } from "../../../../src/kernel/capabilities/reason/think.js";
import {
  transitionState,
  noopHooks,
  type KernelState,
  type KernelContext,
} from "../../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../../src/context/context-profile.js";
import { TextParseDriver } from "@reactive-agents/tools";

// ── Minimal state factory ─────────────────────────────────────────────────────

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "test-task",
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
    ...overrides,
  } as KernelState;
}

// ── Minimal KernelContext factory ─────────────────────────────────────────────

function makeContext(overrides: Partial<KernelContext["input"]> = {}): KernelContext {
  return {
    input: {
      task: "Do a task",
      availableToolSchemas: [],
      ...overrides,
    },
    profile: CONTEXT_PROFILES["mid"],
    compression: {
      enabled: false,
      maxResultChars: 4000,
      previewLines: 10,
      arrayPreviewItems: 5,
    },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

// ── Custom LLM mock that returns max_tokens stop reason ───────────────────────

/**
 * Creates a Layer for LLMService where stream() emits a content_complete
 * event with stopReason: "max_tokens" (i.e. LLM hit its output limit).
 */
function makeMaxTokensLLMLayer() {
  const events: StreamEvent[] = [
    { type: "text_delta", text: "Partial response that got cut off" },
    { type: "content_complete", content: "Partial response that got cut off", stopReason: "max_tokens" } as unknown as StreamEvent,
    { type: "usage", usage: { inputTokens: 10, outputTokens: 50, totalTokens: 60, estimatedCost: 0 } },
  ];

  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: () => Effect.succeed({ content: "", stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 }, model: "test" }),
      stream: (_req) => Effect.succeed(Stream.fromIterable(events) as any),
      embed: (texts) => Effect.succeed(texts.map(() => new Array(768).fill(0))),
      countTokens: (msgs) => Effect.succeed(msgs.length * 10),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
      getStructuredOutputCapabilities: () => Effect.succeed({ nativeJsonMode: true, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
      completeStructured: () => Effect.succeed({} as any),
      capabilities: () => Effect.succeed({ supportsToolCalling: true, supportsStreaming: true, supportsSystemPrompt: true, supportsLogprobs: false, supportsNativeStreaming: true, supportsPromptCaching: false }),
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("max_output_tokens recovery — think phase", () => {
  const layer = makeMaxTokensLLMLayer();

  // ── Stage 1 ──────────────────────────────────────────────────────────────

  it("Stage 1: sets maxOutputTokensOverride=64_000 when max_tokens first encountered", async () => {
    const state = makeState(); // no prior override
    const context = makeContext();

    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(layer)),
    );

    // Should not be failed
    expect(result.status).not.toBe("failed");
    // Override should be set to 64_000
    expect(result.maxOutputTokensOverride).toBe(64_000);
    // Recovery count should still be undefined or 0 (Stage 1 doesn't bump it)
    expect(result.maxOutputTokensRecoveryCount ?? 0).toBe(0);
    // Iteration should NOT be incremented (recovery is not a reasoning step)
    expect(result.iteration).toBe(state.iteration);
  });

  // ── Stage 2 ──────────────────────────────────────────────────────────────

  it("Stage 2: injects recovery message when override is already set", async () => {
    const state = makeState({
      maxOutputTokensOverride: 64_000, // Stage 1 already fired
      maxOutputTokensRecoveryCount: 0,
    } as any);
    const context = makeContext();

    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(layer)),
    );

    // Should not be failed
    expect(result.status).not.toBe("failed");
    // Recovery count should be incremented to 1
    expect((result as any).maxOutputTokensRecoveryCount).toBe(1);
    // A recovery message should be injected into messages
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg).toBeDefined();
    expect(lastMsg.role).toBe("user");
    expect((lastMsg as any).content).toContain("Output token limit hit");
    expect((lastMsg as any).content).toContain("Resume directly");
    // Iteration should NOT be incremented
    expect(result.iteration).toBe(state.iteration);
  });

  it("Stage 2: increments recoveryCount on each attempt", async () => {
    const state = makeState({
      maxOutputTokensOverride: 64_000,
      maxOutputTokensRecoveryCount: 1, // already had 1 attempt
    } as any);
    const context = makeContext();

    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(layer)),
    );

    expect(result.status).not.toBe("failed");
    expect((result as any).maxOutputTokensRecoveryCount).toBe(2);
    // Iteration should NOT be incremented
    expect(result.iteration).toBe(state.iteration);
  });

  it("Stage 2: third attempt still injects recovery message (count goes to 3)", async () => {
    const state = makeState({
      maxOutputTokensOverride: 64_000,
      maxOutputTokensRecoveryCount: 2, // 2 prior attempts
    } as any);
    const context = makeContext();

    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(layer)),
    );

    expect(result.status).not.toBe("failed");
    expect((result as any).maxOutputTokensRecoveryCount).toBe(3);
  });

  // ── Exhausted ─────────────────────────────────────────────────────────────

  it("Exhausted: returns status=failed after 3 Stage 2 attempts", async () => {
    const state = makeState({
      maxOutputTokensOverride: 64_000,
      maxOutputTokensRecoveryCount: 3, // all 3 attempts used up
    } as any);
    const context = makeContext();

    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("max_output_tokens");
  });

  // ── Normal flow unaffected ─────────────────────────────────────────────────

  it("Normal flow: end_turn stop reason is unaffected", async () => {
    const normalEvents: StreamEvent[] = [
      { type: "text_delta", text: "Here is my answer to the task." },
      { type: "content_complete", content: "Here is my answer to the task." },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 30, totalTokens: 40, estimatedCost: 0 } },
    ];

    const normalLayer = Layer.succeed(
      LLMService,
      LLMService.of({
        complete: () => Effect.succeed({ content: "", stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 }, model: "test" }),
        stream: (_req) => Effect.succeed(Stream.fromIterable(normalEvents) as any),
        embed: (texts) => Effect.succeed(texts.map(() => new Array(768).fill(0))),
        countTokens: (msgs) => Effect.succeed(msgs.length * 10),
        getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
        getStructuredOutputCapabilities: () => Effect.succeed({ nativeJsonMode: true, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
        completeStructured: () => Effect.succeed({} as any),
        capabilities: () => Effect.succeed({ supportsToolCalling: true, supportsStreaming: true, supportsSystemPrompt: true, supportsLogprobs: false, supportsNativeStreaming: true, supportsPromptCaching: false }),
      }),
    );

    const state = makeState();
    const context = makeContext();

    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(normalLayer)),
    );

    // Normal end_turn should work fine — no failed, no maxOutputTokensOverride
    expect(result.status).not.toBe("failed");
    expect((result as any).maxOutputTokensOverride).toBeUndefined();
    expect((result as any).maxOutputTokensRecoveryCount ?? 0).toBe(0);
  });

  // ── Recovery state cleared after successful response ─────────────────────

  it("Recovery cleared: maxOutputTokensOverride and maxOutputTokensRecoveryCount are undefined after a successful end_turn response when override was previously set", async () => {
    const normalEvents: StreamEvent[] = [
      { type: "text_delta", text: "Here is my answer to the task after recovery." },
      { type: "content_complete", content: "Here is my answer to the task after recovery." },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 30, totalTokens: 40, estimatedCost: 0 } },
    ];

    const normalLayer = Layer.succeed(
      LLMService,
      LLMService.of({
        complete: () => Effect.succeed({ content: "", stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 }, model: "test" }),
        stream: (_req) => Effect.succeed(Stream.fromIterable(normalEvents) as any),
        embed: (texts) => Effect.succeed(texts.map(() => new Array(768).fill(0))),
        countTokens: (msgs) => Effect.succeed(msgs.length * 10),
        getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
        getStructuredOutputCapabilities: () => Effect.succeed({ nativeJsonMode: true, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
        completeStructured: () => Effect.succeed({} as any),
        capabilities: () => Effect.succeed({ supportsToolCalling: true, supportsStreaming: true, supportsSystemPrompt: true, supportsLogprobs: false, supportsNativeStreaming: true, supportsPromptCaching: false }),
      }),
    );

    // Simulate post-Stage-1 state: override was set in a prior recovery iteration
    const state = makeState({
      maxOutputTokensOverride: 64_000,
      maxOutputTokensRecoveryCount: 1,
    } as any);
    const context = makeContext();

    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(normalLayer)),
    );

    // Recovery state must be cleared — the override persisting would silently
    // inflate billing for all remaining iterations.
    expect((result as any).maxOutputTokensOverride).toBeUndefined();
    expect((result as any).maxOutputTokensRecoveryCount).toBeUndefined();
  });

  // ── Recovery message verbatim check ──────────────────────────────────────

  it("Stage 2: recovery message matches exact required text", async () => {
    const state = makeState({
      maxOutputTokensOverride: 64_000,
      maxOutputTokensRecoveryCount: 0,
    } as any);
    const context = makeContext();

    const result = await Effect.runPromise(
      handleThinking(state, context).pipe(Effect.provide(layer)),
    );

    const lastMsg = result.messages[result.messages.length - 1];
    const expectedText = "[Harness] Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.";
    expect((lastMsg as any).content).toBe(expectedText);
  });
});
