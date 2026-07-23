// Run: bun test packages/runtime/tests/metadata-run-ledger-boundary.test.ts --timeout 15000
//
// DEBT-REGISTER §3 (2026-07-23) — `normalizeReasoningResult` (engine/util.ts) is
// a SECOND hand-enumerated whitelist boundary, upstream of the execution-engine
// literal, sitting between the raw `ReasoningService.execute()` return and
// `ctx.metadata.reasoningResult`.
//
// `runtime/src/types.ts` DECLARED `runLedger` on that slot and two engine sites
// read it — the empty-output deliverable scan and the `TaskResult.metadata`
// forward — but the rebuild never COPIED it. Two types describing one slot, one
// narrower in fact: no compile error, total data loss. Every real strategy run
// through `ExecutionEngine` landed `TaskResult.metadata.runLedger === undefined`,
// so Wave C1's "receipts read the ledger" guarantee held only for tests calling
// the receipt helpers directly.
//
// Exercises the REAL production path: a probe strategy on the actual
// `ReasoningService`/`StrategyRegistry`, minted through the real
// `finalizeStrategyResult` terminal, normalized by the real
// `normalizeReasoningResult`, forwarded by the real `ExecutionEngine`.
//
// RED-ON-CUT: delete the `runLedger:` copy in `normalizeReasoningResult`
// (engine/util.ts) and the first test fails — `runLedger` comes back undefined.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import type { Task } from "@reactive-agents/core";
import {
  ReasoningService,
  createReasoningLayer,
  defaultReasoningConfig,
  finalizeStrategyResult,
  type StrategyFn,
} from "@reactive-agents/reasoning";
import type { RunLedger } from "@reactive-agents/reasoning";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { normalizeReasoningResult } from "../src/engine/util.js";

const mockTask: Task = {
  id: "task-ledger-001" as Task["id"],
  agentId: "agent-ledger-001" as Task["agentId"],
  type: "query",
  input: { question: "What is 2+2?" },
  priority: "medium",
  status: "pending",
  metadata: { tags: [] },
  createdAt: new Date(),
};

// A ledger the way strategies actually emit one: an invocation/result pair plus
// the artifact entry carrying the declared write path (the shape
// `deriveReceiptDeliverables` consumes to mark a deliverable produced).
// Typed as the real `RunLedger` so a drift in the entry union breaks this
// fixture at compile time rather than passing a fictional shape through.
const PROBE_LEDGER: RunLedger = [
  {
    kind: "tool-invocation",
    seq: 0,
    iteration: 0,
    toolName: "file-write",
    toolCallId: "call-1",
    args: { path: "out.json" },
  },
  {
    kind: "tool-result",
    seq: 1,
    iteration: 0,
    toolName: "file-write",
    toolCallId: "call-1",
    success: true,
    preview: "wrote out.json",
  },
  { kind: "artifact", seq: 2, iteration: 0, path: "out.json", op: "write" },
];

describe("runLedger crosses the normalizeReasoningResult boundary (DEBT-REGISTER §3)", () => {
  const config = defaultReactiveAgentsConfig("agent-ledger-001");
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
  const llmLayer = TestLLMServiceLayer([
    { match: ".*", text: "unused — probe strategy short-circuits before any LLM call" },
  ]);
  const reasoningLayer = createReasoningLayer(defaultReasoningConfig).pipe(
    Layer.provide(llmLayer),
  );
  const testLayer = Layer.mergeAll(hookLayer, engineLayer, llmLayer, reasoningLayer);

  const probe: StrategyFn = () =>
    finalizeStrategyResult({
      strategy: "reactive",
      steps: [],
      output: "probe output",
      status: "completed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
      // Mirrors what every real strategy does (e.g. reactive.ts:313 + :333):
      // the ledger is BOTH a judgment input to the terminal mint AND a metadata
      // forward. `FinalizeExtras.runLedger` feeds `judgeContractSatisfied`; it
      // is deliberately not auto-written to metadata, so the strategy states the
      // forward explicitly.
      runLedger: PROBE_LEDGER,
      extraMetadata: { runLedger: PROBE_LEDGER },
    });

  it("forwards rr.metadata.runLedger onto TaskResult.metadata.runLedger through the real engine", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reasoning = yield* ReasoningService;
        yield* reasoning.registerStrategy("reactive", probe);
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    const metadata = result.metadata as {
      runLedger?: ReadonlyArray<{ kind: string; toolName?: string; path?: string }>;
    };
    // The assertion that was FALSE before this fix: undefined, not a ledger.
    expect(metadata.runLedger).toBeDefined();
    expect(metadata.runLedger?.length).toBe(3);
    expect(metadata.runLedger?.[0]?.toolName).toBe("file-write");
    expect(metadata.runLedger?.[2]?.path).toBe("out.json");
  });

  it("normalizeReasoningResult copies runLedger verbatim", () => {
    const normalized = normalizeReasoningResult({
      output: "x",
      status: "completed",
      metadata: { cost: 0, tokensUsed: 0, stepsCount: 0, runLedger: PROBE_LEDGER },
    });

    expect(normalized?.metadata.runLedger).toEqual(PROBE_LEDGER);
  });

  it("tolerates a non-array runLedger without corrupting the rebuild", () => {
    // The whitelist rebuild is defensive by contract — every other field guards
    // its type. A malformed ledger must degrade to undefined, not throw and not
    // pass a non-array through to consumers that call .filter on it.
    const normalized = normalizeReasoningResult({
      output: "x",
      status: "completed",
      metadata: { cost: 0, tokensUsed: 0, stepsCount: 0, runLedger: "not-an-array" },
    });

    expect(normalized).toBeDefined();
    expect(normalized?.metadata.runLedger).toBeUndefined();
  });
});
