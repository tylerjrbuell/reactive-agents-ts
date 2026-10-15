// Run: bun test packages/reasoning/tests/kernel/head-truncation-guard.test.ts --timeout 15000
/**
 * W2e (plan 2.5) — head-truncation guard: Review Focus #6 pin.
 *
 * Live-verified failure class: corrected prompt tokens + outputBudget can
 * exceed the model's num_ctx while every budget gate reads green — the
 * chars/4-family estimator undercounts dense content (~35%), and the FC
 * `tools:` array was never in ANY estimate. Ollama head-truncates the SYSTEM
 * PROMPT on overflow: the agent runs lobotomized, silently. Even
 * compactHistoryStage's own thread budget is a ×4 chars proxy — the whole
 * assembly path can believe a thread fits while the tokenizer disagrees.
 *
 * Engineered 8K overflow (local tier, 12 task-named tools, dense-JSON wire
 * history): asserts (1) the guard fires PRE-REQUEST with a harness-signal
 * (origin 'head-truncation-guard') + ledger-grammar harness_signal step;
 * (2) the SHRINK ORDER structurally — history may only drop once the
 * droppable schema pool is exhausted; (3) the system-prompt HEAD survives
 * byte-present; (4) the shipped wire content actually fits. Exact ladder
 * arithmetic (protection, tail-first drop order, stillOverflowing) is
 * pinned deterministically in head-truncation-guard-units.test.ts.
 * Cut-test (sever the think.ts wiring) recorded in w2e-report.md.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import {
  LLMService,
  estimateTokenCount,
  type CompletionRequest,
  type CompletionResponse,
  type LLMMessage,
  type StreamEvent,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { NativeFCDriver } from "@reactive-agents/tools";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import {
  noopHooks,
  type KernelContext,
  type KernelState,
} from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES, mergeProfile } from "../../src/context/context-profile.js";

const WINDOW = 8192;
const HEAD_PIN = "You are a research agent. CORE IDENTITY SECTION — NEVER TRUNCATE.";

// ── 12 tools; the task text NAMES every one so the free keyword-heuristic
//    seed (unclassified run — NO input.requiredTools here, which would flip
//    the surface into classifier mode and starve the wire of droppable
//    schemas) keeps all 12 on the FC array deterministically. ───────────────

// Wire weight rides ENUM values + param names (W2d strips descriptions from
// the wire at local tier, so prose cannot inflate this fixture). ~1.2KB JSON
// per data-source tool makes the schema term the dominant corrected cost.
const ENUM_VALUES = Array.from({ length: 95 }, (_, k) => `record-set-filter-option-${k}`);

function toolFixture(i: number): ToolSchema {
  return {
    name: `data-source-${i}`,
    description: `Fetch records from data source number ${i}.`,
    parameters: [
      { name: "query", type: "string", description: "Query string", required: true },
      { name: "record_set_selector_filter_mode", type: "string", enum: ENUM_VALUES, required: true },
      { name: "max_records_return_depth_limit", type: "number", description: "depth" },
      { name: "correlation_trace_span_parent_id", type: "string", description: "id" },
    ],
  };
}

const TOOLS: readonly ToolSchema[] = [
  {
    name: "web-search",
    description: "Search the web.",
    parameters: [{ name: "q", type: "string", description: "Query", required: true }],
  },
  {
    name: "file-write",
    description: "Write a file.",
    parameters: [{ name: "path", type: "string", description: "Target path", required: true }],
  },
  ...Array.from({ length: 10 }, (_, i) => toolFixture(i + 1)),
];

// ── Dense-JSON history on the WIRE's own truth source: state.messages.
//    tool_result turns project as previews; the latest gets the generous
//    attention budget. USER_ROLE_EXTRA user turns seed the goal;
//    ROW_PAD/HISTORY_LENGTH/USER_ROLE_EXTRA tune the corrected overflow to
//    land inside the droppable schema pool (measured against the real
//    estimator via the probe loop — see w2e-report.md). ───────────────────────

function denseChunk(seed: number): string {
  const rows: string[] = [];
  for (let r = 0; r < 12; r++) {
    rows.push(
      `{"id":"rec-${seed}-${r}","value":"${"x".repeat(ROW_PAD)}","nested":{"a":${seed + r},"b":[1,2,3],"c":{"d":"${"y".repeat(60)}"}}}`,
    );
  }
  return rows.join(",");
}

const HISTORY_LENGTH = 3;
const ROW_PAD = 60;

function makeState(): KernelState {
  const results = Array.from({ length: HISTORY_LENGTH }, (_, i) => ({
    role: "tool_result" as const,
    toolCallId: `call_seed_${i}`,
    toolName: `data-source-${i + 1}`,
    content: `{ "records": [${denseChunk(i * 10)}] }`,
  }));
  return {
    taskId: "w2e-guard-test",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: HISTORY_LENGTH,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [
      {
        role: "user",
        content:
          "Query data-source-1, data-source-2, data-source-3, data-source-4, data-source-5, data-source-6, data-source-7, data-source-8, data-source-9, data-source-10, web-search corroboration, then file-write the digest.",
      },
      ...results,
    ],
  };
}

function makeContext(): KernelContext {
  return {
    input: {
      task:
        "Query data-source-1, data-source-2, data-source-3, data-source-4, data-source-5, data-source-6, data-source-7, data-source-8, data-source-9, data-source-10, web-search corroboration, then file-write the digest.",
      availableToolSchemas: TOOLS,
      providerName: "ollama",
      modelId: "qwen3:4b",
      systemPrompt: HEAD_PIN + " " + "standing rule; obey the identity block above on every turn. ".repeat(40),
    },
    profile: mergeProfile(CONTEXT_PROFILES.local, {
      maxTokens: WINDOW,
      toolDisclosureMode: "full",
    }),
    compression: {
      enabled: false,
      maxResultChars: 4000,
      previewLines: 10,
      arrayPreviewItems: 5,
    },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new NativeFCDriver(),
  };
}

const CANNED_EVENTS: readonly StreamEvent[] = [
  { type: "text_delta", text: "Digest complete — see the written file for all records." },
  { type: "content_complete", content: "Digest complete — see the written file for all records." },
  {
    type: "usage",
    usage: { inputTokens: 6000, outputTokens: 40, totalTokens: 6040, estimatedCost: 0 },
  },
];

interface RunResult {
  readonly request: CompletionRequest;
  readonly state: KernelState;
  readonly signals: readonly { readonly origin: string; readonly contentPreview: string }[];
}

async function runGuardScenario(): Promise<RunResult> {
  const captured: CompletionRequest[] = [];
  const llmLayer = Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_request: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({
          content: "",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
          model: "test",
        }),
      stream: (request: CompletionRequest) => {
        captured.push(request);
        return Effect.succeed(Stream.fromIterable(CANNED_EVENTS));
      },
      completeStructured: <A>(_request: StructuredCompletionRequest<A>) =>
        Effect.die("unused in head-truncation guard test"),
      embed: (texts: readonly string[]) =>
        Effect.succeed(texts.map(() => new Array<number>(8).fill(0))),
      countTokens: (messages: readonly unknown[]) => Effect.succeed(messages.length),
      getModelConfig: () => Effect.succeed({ provider: "ollama", model: "qwen3:4b" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: false,
          jsonSchemaEnforcement: false,
          prefillSupport: false,
          grammarConstraints: false,
        }),
      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: true,
          supportsStreaming: true,
          supportsSystemPrompt: true,
          supportsLogprobs: false,
          supportsNativeStreaming: true,
          supportsPromptCaching: false,
        }),
    }),
  );

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const signalSink = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("HarnessSignalInjectedEmitted", (ev) =>
        Ref.update(signalSink, (xs) => [...xs, ev]),
      );
      const state = yield* handleThinking(makeState(), makeContext());
      return { state, signals: yield* Ref.get(signalSink) };
    }).pipe(Effect.provide(Layer.merge(llmLayer, EventBusLive))),
  );

  const request = captured[0];
  if (request === undefined) throw new Error("no wire request captured");
  const signals = result.signals.flatMap((ev) =>
    ev._tag === "HarnessSignalInjectedEmitted"
      ? [{ origin: ev.origin, contentPreview: ev.contentPreview }]
      : [],
  );
  return { request, state: result.state, signals };
}

/** Recompute the corrected wire cost EXACTLY as the guard defines it
 *  (estimateWireTokens mirror — kept independent on purpose so a bug in the
 *  guard's own arithmetic cannot hide behind this test). */
async function correctedWireTokens(request: CompletionRequest): Promise<number> {
  const msgs: LLMMessage[] = [
    { role: "system", content: request.systemPrompt ?? "" },
    ...(request.messages as readonly LLMMessage[]),
  ];
  const promptTerm = await Effect.runPromise(estimateTokenCount(msgs, "llama"));
  const tools = (request.tools ?? []) as readonly Record<string, unknown>[];
  const schemaTerm =
    tools.length === 0
      ? 0
      : await Effect.runPromise(
          estimateTokenCount([{ role: "user", content: JSON.stringify(tools) }], "llama"),
        );
  return promptTerm + schemaTerm;
}

describe("W2e head-truncation guard — engineered 8K overflow (Review Focus #6)", () => {
  it("guard fires pre-request: harness-signal origin + ledger-grammar step; shipped wire fits the window", async () => {
    const { request, state, signals } = await runGuardScenario();

    // (1) the guard fired observably. At HEAD (no guard) this is [] — RED.
    const guardSignals = signals.filter((s) => s.origin === "head-truncation-guard");
    expect(guardSignals.length).toBe(1);

    // (1b) ledger grammar: the harness_signal STEP rode state.steps — the
    // existing step-projection maps it to the `harness-signal` ledger kind
    // through growRunLedger at the pass boundary (no new kinds).
    const ledgerStep = state.steps.find(
      (s) => s.type === "harness_signal" && s.content.includes("head-truncation-guard"),
    );
    expect(ledgerStep).toBeDefined();

    // (4) the wire that actually shipped fits: corrected + local think
    // budget (1200) ≤ the 8K window. At HEAD the oversized request goes
    // out — RED.
    const wire = await correctedWireTokens(request);
    expect(wire + 1200).toBeLessThanOrEqual(WINDOW);
  }, 30000);

  it("shrink ORDER holds structurally: history untouched while schemas were still droppable; head byte-present", async () => {
    const { request, state, signals } = await runGuardScenario();
    const tools = (request.tools ?? []) as readonly { name: string }[];

    // The overflow lands inside the droppable schema pool by fixture design
    // (measured), so the guard must pay it entirely from the surface:
    // tools shrank from 12 — and NO history dropped.
    expect(tools.length).toBeLessThan(TOOLS.length);

    // The emitted fact self-describes the bill (ORDER pin): schemas dropped
    // (non-empty list) while the history rung paid ZERO. Asserted against
    // the full harness_signal STEP content (the bus event preview is capped
    // at PREVIEW_MAX).
    const ledgerStep = state.steps.find(
      (s) => s.type === "harness_signal" && s.content.includes("head-truncation-guard"),
    );
    const content = ledgerStep?.content ?? "";
    expect(content).toContain("shrank tool surface (dropped ");
    expect(content).not.toContain("dropped none");
    expect(content).toContain("then history (0 oldest message(s))");

    // Signals ride the same fact on the bus.
    expect(signals.some((s) => s.origin === "head-truncation-guard")).toBe(true);

    // (3) system-prompt HEAD survives byte-PRESENT in the final request.
    expect(request.systemPrompt ?? "").toContain(HEAD_PIN);
  }, 30000);
});
