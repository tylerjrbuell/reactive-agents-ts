// Run: bun test packages/reasoning/tests/kernel/head-truncation-output-clamp.test.ts --timeout 15000
/**
 * Head-truncation guard — OUTPUT-FIRST clamp (gemma4:e4b trace, iter 3).
 *
 * A ~1.1k-token prompt in an 8192 window with a 7200 output budget used to
 * shrink the TOOL SURFACE (dropped todo, crypto-price) because the ladder
 * billed the full 7200 reserve. Law: clamp the OUTPUT (maxTokens) to
 * numCtx − prompt − margin first; shrink tools/history only when the prompt
 * itself cannot fit beside a minimal reserve. Used tools + todo/final-answer
 * are protected even then.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  LLMService,
  type CompletionRequest,
  type CompletionResponse,
  type LLMMessage,
  type StreamEvent,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import {
  estimateWireTokens,
  preflightHeadTruncation,
  type WireToolPayload,
} from "../../src/kernel/capabilities/reason/head-truncation-guard.js";
import { noopHooks, type KernelContext, type KernelState } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES, mergeProfile } from "../../src/context/context-profile.js";
import type { ResolvedHarness } from "../../src/harness-config.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";

const SYS = "You are an agent. " + "identity rule. ".repeat(60);
const TASK = "Use web-search, http-get and crypto-price. Record steps with todo add, reply with a numbered plan, wait for go-ahead. " + "context detail. ".repeat(150);

const TOOLS: readonly ToolSchema[] = ["web-search", "http-get", "crypto-price"].map((name) => ({
  name,
  description: `${name} tool.`,
  parameters: [{ name: "query", type: "string", description: "q", required: true }],
}));

const harness: ResolvedHarness = {
  lazyDisclosure: false,
  toolDiscovery: false,
  toolIndex: false,
  verboseRules: false,
  auditRationale: false,
  treeOfThoughtExploreBudgetMs: 120_000,
  assemblyDebug: false,
  numCtxPolicy: "fixed",
  actOrAnswer: false,
};

const events: readonly StreamEvent[] = [
  { type: "text_delta", text: "ok" },
  { type: "content_complete", content: "ok" },
  { type: "usage", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 } },
];

function makeState(over: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "clamp-1",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 3,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [{ role: "user", content: TASK }],
    maxOutputTokensOverride: 7200,
    ...over,
  };
}

async function shipped(state: KernelState): Promise<CompletionRequest> {
  const captured: CompletionRequest[] = [];
  const llmLayer = Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_r: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({
          content: "",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
          model: "test",
        }),
      stream: (request: CompletionRequest) => {
        captured.push(request);
        return Effect.succeed(Stream.fromIterable(events));
      },
      completeStructured: <A>(_r: StructuredCompletionRequest<A>) => Effect.die("unused"),
      embed: (t: readonly string[]) => Effect.succeed(t.map(() => [0])),
      countTokens: (m: readonly unknown[]) => Effect.succeed(m.length),
      getModelConfig: () => Effect.succeed({ provider: "ollama", model: "gemma4:e4b" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({ nativeJsonMode: false, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
      capabilities: () =>
        Effect.succeed({ supportsToolCalling: true, supportsStreaming: true, supportsSystemPrompt: true, supportsLogprobs: false, supportsNativeStreaming: true, supportsPromptCaching: false }),
    }),
  );
  const context: KernelContext = {
    input: {
      task: TASK,
      availableToolSchemas: TOOLS,
      providerName: "ollama",
      modelId: "gemma4:e4b",
      systemPrompt: SYS,
      harness,
    },
    profile: mergeProfile(CONTEXT_PROFILES.local, { maxTokens: 8192, toolDisclosureMode: "full" }),
    compression: { enabled: false, maxResultChars: 4000, previewLines: 10, arrayPreviewItems: 5 },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new NativeFCDriver(),
  };
  await Effect.runPromise(handleThinking(state, context).pipe(Effect.provide(llmLayer)));
  const request = captured[0];
  if (request === undefined) throw new Error("no wire request captured");
  return request;
}

describe("head-truncation guard — output clamped before tools shrink", () => {
  it("seam: ~1.1k prompt, num_ctx 8192, budget 7200 → all tools intact, maxTokens clamped to fit", async () => {
    const request = await shipped(makeState());
    const names = (request.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(["crypto-price", "http-get", "web-search"]);
    const billed = await Effect.runPromise(
      estimateWireTokens(
        request.systemPrompt ?? "",
        request.messages as readonly LLMMessage[],
        (request.tools ?? []) as readonly WireToolPayload[],
        "llama",
      ),
    );
    // Fixture sanity: prompt is in the trace's ~1k range, so 7200 + prompt overflows.
    expect(billed).toBeGreaterThan(900);
    expect(billed).toBeLessThan(2500);
    expect(request.maxTokens).toBeDefined();
    expect(request.maxTokens!).toBeLessThan(7200);
    // Fits the window beside the prompt (tokenizer-family tolerance: 5%).
    expect(billed + request.maxTokens!).toBeLessThanOrEqual(8192 + Math.ceil(billed * 0.05));
    expect(request.maxTokens!).toBeGreaterThan(4000);
  }, 15000);

  it("unit: ladders do not fire on a fitting prompt; outputBudget clamped", async () => {
    const wireTools: WireToolPayload[] = [{ name: "web-search" }, { name: "todo" }];
    const out = await Effect.runPromise(
      preflightHeadTruncation({
        systemPrompt: SYS,
        messages: [{ role: "user", content: "hi" }] as LLMMessage[],
        wireTools,
        outputBudget: 7200,
        numCtx: 7000,
        tokenizerFamily: "llama",
        requiredTools: [],
        relevantTools: [],
      }),
    );
    expect(out.fired).toBe(false);
    expect(out.wireTools).toBe(wireTools);
    expect(out.outputClamped).toBe(true);
    expect(out.outputBudget).toBeLessThan(7200);
    expect(out.outputBudget).toBeGreaterThan(5000);
  }, 15000);

  it("unit: when the prompt cannot fit beside a minimal reserve, used + meta tools survive the drop", async () => {
    const wireTools: WireToolPayload[] = [
      { name: "used-tool", description: "x".repeat(2000) },
      { name: "todo", description: "x".repeat(2000) },
      { name: "final-answer", description: "x".repeat(2000) },
      { name: "spare", description: "x".repeat(2000) },
    ];
    const out = await Effect.runPromise(
      preflightHeadTruncation({
        systemPrompt: SYS,
        messages: [{ role: "user", content: "hi" }] as LLMMessage[],
        wireTools,
        outputBudget: 7200,
        numCtx: 3200,
        tokenizerFamily: "llama",
        requiredTools: [],
        relevantTools: [],
        protectedTools: ["used-tool", "todo", "final-answer"],
      }),
    );
    expect(out.fired).toBe(true);
    expect(out.droppedToolNames).toEqual(["spare"]);
  }, 15000);
});
