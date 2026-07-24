// Run: bun test packages/runtime/tests/run-scoped-ledger.test.ts --timeout 15000
//
// Wave C.2 slice 1 — a RUN is not a PASS.
//
// The engine executes reasoning up to three ways (terminal pass, verification
// retry, post-think continuation). Each is a separate kernel execution whose
// ledger starts at seq 0, and each auxiliary pass OVERWRITES
// `ctx.metadata.reasoningResult`. The engine forwarded `rr.metadata.runLedger`
// — whichever pass happened to finish last — so on any multi-pass run the
// terminal pass's facts were silently discarded before the receipt ever saw
// them.
//
// This exercises the REAL production path (real ReasoningService + real
// ExecutionEngine + real normalizeReasoningResult) with a probe strategy that
// records a DIFFERENT tool per pass, so a lost pass is visible as a missing
// tool name rather than as a count that could be explained away.
//
// RED-ON-CUT: drop the `absorbedLedgerMetadata(...)` spread from the
// continuation sites in `reasoning-harness-hooks.ts`, or point the engine's
// forward back at `rr?.metadata?.runLedger` alone, and the first test fails —
// the second pass's tool is gone from the ledger.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ExecutionEngine, ExecutionEngineLive, LifecycleHookRegistryLive } from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import type { Task } from "@reactive-agents/core";
import {
  ReasoningService,
  createReasoningLayer,
  defaultReasoningConfig,
  finalizeStrategyResult,
  type RunLedger,
  type StrategyFn,
} from "@reactive-agents/reasoning";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const mockTask: Task = {
  id: "task-runscope-001" as Task["id"],
  agentId: "agent-runscope-001" as Task["agentId"],
  type: "query",
  input: { question: "What is 2+2?" },
  priority: "medium",
  status: "pending",
  metadata: { tags: [] },
  createdAt: new Date(),
};

/** One pass's ledger: a tool-invocation naming the pass that recorded it. */
const passLedger = (toolName: string): RunLedger => [
  { kind: "tool-invocation", seq: 0, iteration: 0, toolName, toolCallId: `call-${toolName}` },
];

type LedgerMetadata = { runLedger?: RunLedger };

/** The tool-invocation entries, narrowed off the real union so `toolName` is typed. */
const invocations = (ledger: RunLedger | undefined) =>
  (ledger ?? []).filter((e): e is Extract<RunLedger[number], { kind: "tool-invocation" }> =>
    e.kind === "tool-invocation");

describe("the run-scoped ledger spans every pass of a run", () => {
  const runWith = async (minIterations: number | undefined) => {
    const config = {
      ...defaultReactiveAgentsConfig("agent-runscope-001"),
      ...(minIterations !== undefined ? { minIterations } : {}),
    };
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
    const llmLayer = TestLLMServiceLayer([
      { match: ".*", text: "unused — the probe strategy short-circuits before any LLM call" },
    ]);
    const reasoningLayer = createReasoningLayer(defaultReasoningConfig).pipe(Layer.provide(llmLayer));
    const testLayer = Layer.mergeAll(hookLayer, engineLayer, llmLayer, reasoningLayer);

    // Each invocation records a distinct tool, so which passes survived is
    // readable off the ledger rather than inferred from a count.
    let passIndex = 0;
    const probe: StrategyFn = () => {
      const ledger = passLedger(`tool-pass-${passIndex++}`);
      return finalizeStrategyResult({
        strategy: "reactive",
        steps: [],
        output: "probe output",
        status: "completed",
        start: Date.now(),
        totalTokens: 0,
        totalCost: 0,
        // Both, exactly as every real strategy does (reactive.ts:313 + :333):
        // a judgment input to the terminal mint AND an explicit metadata forward.
        runLedger: ledger,
        extraMetadata: { runLedger: ledger },
      });
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reasoning = yield* ReasoningService;
        yield* reasoning.registerStrategy("reactive", probe);
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );
    return { result, passes: passIndex, ledger: (result.metadata as LedgerMetadata).runLedger };
  };

  it("keeps the terminal pass's facts when a continuation pass runs after it", async () => {
    const { result, passes, ledger } = await runWith(2);

    expect(result.success).toBe(true);
    // CONTROL: if the continuation never fired, this probe proves nothing about
    // multi-pass behaviour — fail loudly rather than pass vacuously.
    expect(passes).toBeGreaterThan(1);

    const tools = invocations(ledger).map((e) => e.toolName);
    // The assertion that was FALSE before: only the LAST pass's tool survived.
    expect(tools).toContain("tool-pass-0");
    expect(tools).toContain("tool-pass-1");
  }, 15_000);

  it("re-bases seq across passes and stamps the auxiliary pass's provenance", async () => {
    const { ledger } = await runWith(2);

    // Dense and monotonic across the merge — two passes both minted seq 0.
    expect(ledger?.map((e) => e.seq)).toEqual(ledger?.map((_e, i) => i));
    // The terminal pass is the run's primary: unstamped. The continuation is
    // attributable, so a reader can tell which pass produced which fact.
    expect(invocations(ledger).find((e) => e.toolName === "tool-pass-0")?.pass).toBeUndefined();
    expect(invocations(ledger).find((e) => e.toolName === "tool-pass-1")?.pass).toBe("continuation");
  }, 15_000);

  it("leaves a single-pass run byte-identical to what Wave C.1 forwarded", async () => {
    const { passes, ledger } = await runWith(undefined);

    expect(passes).toBe(1);
    expect(ledger).toEqual([
      { kind: "tool-invocation", seq: 0, iteration: 0, toolName: "tool-pass-0", toolCallId: "call-tool-pass-0" },
    ]);
  }, 15_000);
});
