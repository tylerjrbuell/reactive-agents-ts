import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ContextSynthesizerService,
  ContextSynthesizerLive,
} from "../../src/context/context-synthesizer.js";
import { LLMService, DEFAULT_CAPABILITIES } from "@reactive-agents/llm-provider";
import type { SynthesisInput } from "../../src/context/synthesis-types.js";
import type { SynthesisStrategy } from "../../src/context/synthesis-types.js";

const mockLLMLayer = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: JSON.stringify({
        accomplished: "Searched for AI trends",
        failed: "",
        remaining: "Write results to file",
        nextAction: "Call file-write with path='./report.md' and synthesized content",
      }),
      stopReason: "end_turn" as const,
      usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150, estimatedCost: 0 },
      model: "test",
      toolCalls: undefined,
    }),
  stream: () => Effect.fail(new Error("stream not used in synthesis")),
  completeStructured: () => Effect.fail(new Error("not used")),
  embed: () => Effect.fail(new Error("not used")),
  countTokens: () => Effect.succeed(100),
  getModelConfig: () =>
    Effect.succeed({
      model: "test",
      provider: "anthropic" as const,
      tier: "mid" as const,
    }),
  getStructuredOutputCapabilities: () => Effect.succeed({ jsonMode: false }),
  capabilities: () => Effect.succeed({ ...DEFAULT_CAPABILITIES, supportsToolCalling: false }),
});

const baseInput: SynthesisInput = {
  transcript: [
    { role: "user", content: "Research AI trends and write to ./report.md" },
    {
      role: "assistant",
      content: "I'll search for AI trends.",
      toolCalls: [{ id: "tc1", name: "web-search", arguments: { query: "AI trends" } }],
    },
    {
      role: "tool_result",
      toolCallId: "tc1",
      toolName: "web-search",
      content: "Results: LangChain, AutoGen...",
    },
  ],
  task: "Research AI trends and write to ./report.md",
  taskPhase: "gather",
  requiredTools: ["web-search", "file-write"],
  toolsUsed: new Set(["web-search"]),
  availableTools: [],
  entropy: undefined,
  iteration: 2,
  maxIterations: 10,
  lastErrors: [],
  tier: "mid",
  tokenBudget: 3000,
  synthesisConfig: { mode: "auto" },
};

const fullLayer = Layer.mergeAll(ContextSynthesizerLive, mockLLMLayer);

describe("ContextSynthesizerLive", () => {
  it("synthesize with fast path returns messages and metadata", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({ ...baseInput, synthesisConfig: { mode: "fast" } });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.synthesisPath).toBe("fast");
    expect(result.taskPhase).toBe("gather");
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.signalsSnapshot.tier).toBe("mid");
    expect(result.signalsSnapshot.requiredTools).toEqual(["web-search", "file-write"]);
  });

  it("synthesize with mode:auto mid tier gather missing required uses fast path (improved templates)", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({ ...baseInput, synthesisConfig: { mode: "auto" } });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    expect(result.synthesisPath).toBe("fast");
    expect(result.synthesisReason).toContain("fast path");
  });

  it("synthesize with mode:off uses fast path and marks reason", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({ ...baseInput, synthesisConfig: { mode: "off" } });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    expect(result.synthesisPath).toBe("fast");
    expect(result.synthesisReason).toContain("off");
  });

  it("synthesize with deep path calls LLM and enriches messages", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({ ...baseInput, synthesisConfig: { mode: "deep" } });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    expect(result.synthesisPath).toBe("deep");
    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(
      typeof lastMsg.content === "string" ? lastMsg.content : JSON.stringify(lastMsg.content),
    ).toBeTruthy();
  });

  it("synthesize with custom strategy calls the provided function", async () => {
    let called = false;
    const customStrategy: SynthesisStrategy = (input) =>
      Effect.sync(() => {
        called = true;
        return [{ role: "user" as const, content: `Custom: ${input.task}` }];
      });

    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({
        ...baseInput,
        synthesisConfig: { mode: "custom", synthesisStrategy: customStrategy },
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    expect(called).toBe(true);
    expect(result.synthesisPath).toBe("custom");
    expect(result.messages[0]!.content).toBe(`Custom: ${baseInput.task}`);
  });

  it("local tier with mode:auto falls back to fast even when deep would trigger", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({
        ...baseInput,
        tier: "local",
        entropy: { composite: 0.8, trajectory: { shape: "stalled" } },
        synthesisConfig: { mode: "auto" },
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    expect(result.synthesisPath).toBe("fast");
    expect(result.synthesisReason).toContain("local");
  });
});
