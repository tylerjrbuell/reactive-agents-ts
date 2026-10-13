// Run: bun test packages/reasoning/tests/kernel/head-truncation-guard-review-fixes.test.ts --timeout 15000
/**
 * W2e review round 1 — three Important findings, RED-first.
 *
 *  #1 (spec-binding): rung 2 must drop by COHERENT FC UNIT — an assistant
 *     tool-call turn travels with its tool_result answers (assembly/
 *     compaction.ts block model: "a kept tool_result is never orphaned and
 *     a dropped tool_use never leaves a dangling answer"). Naive
 *     oldest-first `slice(1)` can stop mid-exchange, stranding a result
 *     whose call was dropped (or vice versa) → invalid native-FC wire on
 *     the exact paths rung 2 exists for. The fixture sizes capacity so the
 *     naive slice STOPS with one orphaned result.
 *  #2 (demand-policy leak): demandNumCtx must size from the SAME
 *     schema-inclusive estimate the guard bills.
 *  #3 (conservative reserve): provider-default budget mode
 *     (resolveOutputBudget → undefined = unbounded) reserves
 *     THINKING_SAFE_MIN_TOKENS — the documented framework minimum the
 *     gateway itself cites (stream-parser.ts, pinned 2048) — never 0
 *     (ruling #1: conservative direction = fire).
 *
 * Module-level import of `guardOutputReserve` (nonexistent at dispatch HEAD)
 * makes every arm RED before the fix; GREEN after.
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
  guardOutputReserve,
  preflightHeadTruncation,
} from "../../src/kernel/capabilities/reason/head-truncation-guard.js";
import { THINKING_SAFE_MIN_TOKENS } from "../../src/kernel/utils/stream-parser.js";
import {
  noopHooks,
  type KernelContext,
  type KernelState,
} from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES, mergeProfile } from "../../src/context/context-profile.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import type { ResolvedHarness } from "../../src/harness-config.js";

const SYS = "You are an agent. " + "identity rule. ".repeat(50);
const BUDGET = 1200;

function toolCallAssistant(tag: string, ids: readonly string[]): LLMMessage {
  return {
    role: "assistant",
    content: ids.map((id) => ({
      type: "tool_use" as const,
      id,
      name: `tool-${tag}`,
      input: { q: `query-${id}` },
    })),
  };
}

function toolResult(id: string, size: number): LLMMessage {
  return { role: "tool", toolCallId: id, content: `result-${id}-` + "r".repeat(size) };
}

function denseTail(i: number): LLMMessage {
  const pairs: string[] = [];
  for (let k = 0; k < 40; k++) pairs.push(`"f${i}-${k}":"v${i}-${k}"`);
  return { role: "user", content: `{${pairs.join(",")}}`.repeat(5) };
}

/** Provider wire validity: every tool_result answers a preceding assistant
 *  tool_use; every tool_use has its answer on the thread. Both directions. */
function assertNoOrphans(messages: readonly LLMMessage[]): void {
  const useIds = new Set<string>();
  const resultIds: string[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && typeof m.content !== "string") {
      for (const b of m.content) if (b.type === "tool_use") useIds.add(b.id);
    }
    if (m.role === "tool") resultIds.push(m.toolCallId);
  }
  for (const id of resultIds) {
    expect(useIds.has(id)).toBe(true); // result stranded without its call
  }
  for (const id of useIds) {
    expect(resultIds.includes(id)).toBe(true); // call dangling without answer
  }
}

// ── #1 pair-safe rung 2 ──────────────────────────────────────────────────────

describe("W2e review #1 — rung 2 drops coherent FC units, never orphans", () => {
  it("capacity sized so a naive slice stops with an orphan: pair-safe drop keeps the wire valid", async () => {
    // Thread: goal, [assistant(c1,c2) + BIG result c1 + TINY result c2],
    // [assistant(c3) + result c3], newest dense turn.
    // Capacity = survivor thread + the tiny c2 result: a per-message
    // oldest-first slice drops goal → assistant(c1,c2) → BIG c1 … and then
    // FITS with the tiny c2 orphaned. A pair-safe unit drop removes the
    // whole [assistant, c1, c2] exchange and lands on the same survivors
    // with no orphans.
    const goal: LLMMessage = {
      role: "user",
      content: "goal: fetch records a, b then c and summarize " + "g".repeat(400),
    };
    const msgA = toolCallAssistant("ab", ["c1", "c2"]);
    const rBig = toolResult("c1", 2400);
    const rTiny = toolResult("c2", 8);
    const survivors: LLMMessage[] = [toolCallAssistant("c", ["c3"]), toolResult("c3", 600), denseTail(9)];
    const messages = [goal, msgA, rBig, rTiny, ...survivors];

    const survivorEst = await Effect.runPromise(estimateWireTokens(SYS, survivors, [], "llama"));
    const rTinyEst = await Effect.runPromise(estimateWireTokens(SYS, [rTiny, ...survivors], [], "llama"));

    const out = await Effect.runPromise(
      preflightHeadTruncation({
        systemPrompt: SYS,
        messages,
        wireTools: [],
        outputBudget: BUDGET,
        // capacity admits the survivors + the tiny result ⇒ naive slicing
        // stops orphaned; pair-safety must remove c2 WITH its exchange.
        numCtx: BUDGET + rTinyEst,
        tokenizerFamily: "llama",
        requiredTools: [],
        relevantTools: [],
      }),
    );

    expect(out.fired).toBe(true);
    expect(survivorEst).toBeLessThan(rTinyEst); // fixture sanity
    assertNoOrphans(out.messages);
    expect(out.droppedMessageCount).toBeGreaterThan(1);
    // Newest turn always survives.
    expect(out.messages[out.messages.length - 1]).toBe(messages[messages.length - 1]);
  }, 15000);
});

// ── #2 demand sizing sees the schema term ─────────────────────────────────────

describe("W2e review #2 — demand num_ctx sizing is schema-inclusive", () => {
  function fatTool(i: number): ToolSchema {
    return {
      name: `bulk-source-${i}`,
      description: `Bulk source ${i}.`,
      parameters: [
        { name: "query", type: "string", description: "q", required: true },
        {
          name: "selector",
          type: "string",
          enum: Array.from({ length: 150 }, (_, k) => `bulk-selector-option-${k}`),
        },
      ],
    };
  }
  const TOOLS: readonly ToolSchema[] = Array.from({ length: 12 }, (_, i) => fatTool(i));
  const TASK =
    "Fan out with bulk-source-1, bulk-source-2, bulk-source-3, bulk-source-4, bulk-source-5, " +
    "bulk-source-6, bulk-source-7, bulk-source-8, bulk-source-9, bulk-source-10, bulk-source-11, " +
    "bulk-source-12 and summarize";

  const harness: ResolvedHarness = {
    lazyDisclosure: false,
    toolDiscovery: false,
    toolIndex: false,
    verboseRules: false,
    auditRationale: false,
    treeOfThoughtExploreBudgetMs: 120_000,
    assemblyDebug: false,
    numCtxPolicy: "demand",
  };

  const events: readonly StreamEvent[] = [
    { type: "text_delta", text: "All twelve bulk sources are summarized into the digest now." },
    { type: "content_complete", content: "All twelve bulk sources are summarized into the digest now." },
    { type: "usage", usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, estimatedCost: 0 } },
  ];

  function makeState(): KernelState {
    return {
      taskId: "w2e-review-2",
      strategy: "reactive",
      kernelType: "react",
      steps: [],
      toolsUsed: new Set<string>(),
      scratchpad: new Map<string, string>(),
      iteration: 1,
      tokens: 0,
      cost: 0,
      status: "thinking",
      output: null,
      error: null,
      llmCalls: 0,
      meta: { maxIterations: 10 },
      controllerDecisionLog: [],
      messages: [{ role: "user", content: TASK }],
    };
  }

  it("demand bucket covers the guard's own arithmetic (prompt + schema + output reserve) on the shipped wire", async () => {
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
        getModelConfig: () => Effect.succeed({ provider: "ollama", model: "qwen3:4b" }),
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
        modelId: "qwen3:4b",
        systemPrompt: SYS,
        harness,
      },
      // 32K ceiling: the guard stays silent here (its capacity ~31.5K exceeds
      // this wire's bill) — the arm isolates demand BUCKET SIZING.
      profile: mergeProfile(CONTEXT_PROFILES.local, { maxTokens: 32_768, toolDisclosureMode: "full" }),
      compression: { enabled: false, maxResultChars: 4000, previewLines: 10, arrayPreviewItems: 5 },
      toolService: { _tag: "None" },
      hooks: noopHooks,
      toolCallingDriver: new NativeFCDriver(),
    };

    await Effect.runPromise(handleThinking(makeState(), context).pipe(Effect.provide(llmLayer)));

    const request = captured[0];
    if (request === undefined) throw new Error("no wire request captured");
    expect(request.numCtx).toBeTypeOf("number");

    // The guard's own billed arithmetic on the SHIPPED wire. At HEAD the
    // bucket is sized from a schema-blind, family-blind estimate → red.
    const billed = await Effect.runPromise(
      estimateWireTokens(
        request.systemPrompt ?? "",
        request.messages as readonly LLMMessage[],
        (request.tools ?? []) as Parameters<typeof estimateWireTokens>[2],
        "llama",
      ),
    );
    expect(request.numCtx!).toBeGreaterThanOrEqual(billed + 2000 + 1024);
  }, 30000);
});

// ── #3 conservative reserve under provider-default budget ────────────────────

describe("W2e review #3 — provider-default budget reserves the thinking-safe minimum", () => {
  it("undefined resolved budget (provider-default / unbounded) reserves THINKING_SAFE_MIN_TOKENS, not 0", () => {
    expect(
      guardOutputReserve({ purpose: "classify", budgetClass: "provider-default" }),
    ).toBe(THINKING_SAFE_MIN_TOKENS);
  }, 15000);

  it("resolved numeric budgets pass through (tier arithmetic untouched)", () => {
    expect(guardOutputReserve({ purpose: "think", tier: "local" })).toBe(1200);
    expect(guardOutputReserve({ purpose: "think", tier: "local", budgetTokens: 777 })).toBe(777);
  }, 15000);
});
