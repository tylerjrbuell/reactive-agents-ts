// Run: bun test packages/reasoning/tests/strategies/non-reactive-terminal-signals.test.ts --timeout 20000
//
// 2026-11-03 signal-gap closure, residuals R1-R4/R6/R8: non-reactive strategies
// emit the same decisive, self-consistent terminal signals as the reactive path.
// Read back THROUGH the normalized trace (`toTraceEvent`) + result.metadata.
// RED-ON-CUT (each pin names its cut):
//   - strategy-terminal-decision.ts / the emit call in finalize-result  -> terminal_decision absent
//   - `iteration: ctx.iteration` on tool-observe ToolCallStarted        -> iter -1
//   - `attempted = Math.max(attempted, observed)` in summarizeAttempts  -> M > N
//   - exhausted-exit view in runner-helpers/terminal-decision.ts        -> status "thinking"
//   - `deciderVerdictSummary` in terminal-outcome.ts                    -> accepted:true + "failed at"
//   - forwardedOutstanding in finalize-result                           -> outstanding []
//   - `kernelMeta: execState.meta` in ToT                               -> deliverable null
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { finalizeStrategyResult } from "../../src/kernel/capabilities/sense/finalize-result.js";
import { summarizeAttempts } from "../../src/kernel/capabilities/sense/abstention-synthesis.js";
import { emitTerminalDecision } from "../../src/kernel/loop/runner-helpers/terminal-decision.js";
import { deriveTerminalOutcome } from "../../src/kernel/state/terminal-outcome.js";
import { initialKernelState } from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import type { DeliverableDecision } from "../../src/kernel/loop/runner-helpers/deliverable-decision.js";

const toTrace = (raw: readonly AgentEvent[]): readonly TraceEvent[] =>
  raw.flatMap((e, i) => {
    const t = toTraceEvent(e, i);
    return t ? [t] : [];
  });
const guards = (t: readonly TraceEvent[], name: string) =>
  t.flatMap((e) => (e.kind === "guard-fired" && e.guard === name ? [e] : []));
const md = (e: { readonly metadata?: unknown }): Record<string, unknown> => e.metadata as Record<string, unknown>;

/** Run an effect under a live EventBus, returning its value + the normalized trace. */
const traced = <A>(eff: Effect.Effect<A, never, EventBus | RunEnvelopeR>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      const value = yield* eff;
      return { value, trace: toTrace(yield* Ref.get(events)) };
    }).pipe(Effect.provide(EventBusLive), provideTestEnvelope) as Effect.Effect<{ value: A; trace: readonly TraceEvent[] }, never, never>,
  );
type RunEnvelopeR = import("../../src/kernel/envelope/run-envelope.js").RunEnvelope;

const finalizeBase = {
  strategy: "plan-execute-reflect" as const,
  steps: [makeStep("thought", "t")],
  output: "an answer",
  start: Date.now(),
  totalTokens: 1,
  totalCost: 0,
};

describe("R2 — every strategy result records a valid terminal_decision", () => {
  it("a kernel-less strategy terminal emits one, with legacy status + finalStatus + authority", async () => {
    const { value, trace } = await traced(
      finalizeStrategyResult({
        ...finalizeBase,
        taskId: "td-1",
        status: "completed",
        extraMetadata: { terminatedBy: "final_answer" },
      }),
    );
    const tds = guards(trace, "terminal_decision");
    expect(tds).toHaveLength(1);
    expect(md(tds[0]!)).toMatchObject({ status: "done", finalStatus: "completed", terminatedBy: "final_answer", authority: "model-final" });
    expect(value.metadata.extensions?.terminalOutcome).toMatchObject({ status: "completed" });
  });

  it("a partial/failed strategy terminal is truthful: finalStatus partial, failed -> status failed", async () => {
    const partial = await traced(finalizeStrategyResult({ ...finalizeBase, taskId: "td-2", status: "partial", extraMetadata: { terminatedBy: "end_turn" } }));
    expect(md(guards(partial.trace, "terminal_decision")[0]!)).toMatchObject({ finalStatus: "partial", intent: "deliver-partial" });
    const failed = await traced(finalizeStrategyResult({ ...finalizeBase, taskId: "td-3", status: "failed", output: null, extraMetadata: { terminatedBy: "max_iterations" } }));
    expect(md(guards(failed.trace, "terminal_decision")[0]!)).toMatchObject({ status: "failed", finalStatus: "failed", authority: "strategy-exhausted" });
  });

  // A delegated result (adaptive) is relayed untouched by the substrate and never
  // re-finalized (strategy-run.test.ts "a Delegated end relays ..."), so the
  // only fence left here is the pause: a paused run is not yet terminal.
  it("a paused strategy terminal does not record a decision", async () => {
    const { trace } = await traced(
      finalizeStrategyResult({
        ...finalizeBase,
        taskId: "td-4",
        status: "completed",
        pause: { reason: "awaiting-approval", output: "awaiting approval" },
      }),
    );
    expect(guards(trace, "terminal_decision")).toHaveLength(0);
  });

  it("an exhausted kernel exit (status thinking, no terminatedBy) is recorded as a cap exhaustion", async () => {
    const state = { ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 4 }), iteration: 4 };
    expect(state.status).not.toBe("done");
    const { value, trace } = await traced(emitTerminalDecision({ state, taskId: "td-5" }));
    expect(md(guards(trace, "terminal_decision")[0]!)).toMatchObject({
      status: "failed",
      terminatedBy: "max_iterations",
      authority: "strategy-exhausted",
      finalStatus: "failed",
    });
    expect(value.meta.terminalDecision).toMatchObject({ status: "failed", finalStatus: "failed", authority: "strategy-exhausted" });
    expect(value.meta.terminatedBy).toBeUndefined(); // stamp is a view: no downstream gate sees a changed terminator
  });
});

describe("R2 — plan-execute tool events carry the iteration", () => {
  it("tool-call-start is never stamped iter -1", async () => {
    const tool = mockToolServiceLayer({
      execute: () => Effect.succeed({ success: true, result: { ok: 1 } }),
      getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
    });
    const llm = TestLLMServiceLayer([
      { match: "planning agent", text: JSON.stringify({ steps: [
        { title: "Search", instruction: "search", type: "tool_call", toolName: "web-search", toolArgs: { query: "x" } },
        { title: "Summarize", instruction: "summarize", type: "analysis" },
      ] }) },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: done." },
      { match: "GOAL:", text: "SATISFIED: complete." },
      { match: "Synthesize", text: "Final synthesized answer." },
    ]);
    const { trace } = await traced(
      executePlanExecute({
        taskDescription: "Find test data", taskType: "simple", memoryContext: "", taskId: "pe-iter",
        availableTools: ["web-search"],
        availableToolSchemas: [{ name: "web-search", description: "s", parameters: [{ name: "query", type: "string", required: true }] }],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.mergeAll(llm, tool))) as Effect.Effect<unknown, never, never>,
    );
    const starts = trace.filter((e) => e.kind === "tool-call-start");
    expect(starts.length).toBeGreaterThan(0);
    for (const s of starts) expect(s.iter).toBeGreaterThanOrEqual(0);
    // and the plan-execute run recorded its own terminal_decision
    expect(guards(trace, "terminal_decision").length).toBeGreaterThan(0);
  });
});

const deliberate = (over: Partial<DeliverableDecision>): DeliverableDecision => ({
  chosen: "tool-artifact", accepted: true, why: "harness-authored-verified-artifact",
  verdictSummary: "final-answer: failed at output-is-model-authored", rejected: [],
  verifier: { verified: false, failedChecks: ["output-is-model-authored"] }, ...over,
});

describe("R4 — outcome.verdict summary comes from the deciding gate", () => {
  it("accepted over a failing verifier never reads accepted:true + 'failed at'", () => {
    const o = deriveTerminalOutcome({ status: "completed", meta: { terminatedBy: "end_turn", deliverableDecision: deliberate({}) }, ledger: undefined });
    expect(o.verdict).toEqual({ accepted: true, summary: "overridden by deliverable decision: harness-authored-verified-artifact" });
    expect(o.verifierVerdict?.verified).toBe(false);
  });
  it("control: verifier agrees -> its own summary stands", () => {
    const o = deriveTerminalOutcome({ status: "completed", meta: { terminatedBy: "end_turn", deliverableDecision: deliberate({ verdictSummary: "final-answer: 10 checks passed", verifier: { verified: true, failedChecks: [] } }) }, ledger: undefined });
    expect(o.verdict?.summary).toBe("final-answer: 10 checks passed");
  });
});

describe("R1/R3 — outcome agrees with the veto the runtime will apply", () => {
  it("forwarded outstandingCriteria are recorded on the outcome and block its success claim", async () => {
    const { value } = await traced(
      finalizeStrategyResult({ ...finalizeBase, taskId: "r3", status: "completed", extraMetadata: { terminatedBy: "final_answer", outstandingCriteria: ["artifact:./a.txt"] } }),
    );
    const o = value.metadata.extensions?.terminalOutcome as { outstanding: string[]; success: boolean; authority: string };
    expect(o.outstanding).toEqual(["artifact:./a.txt"]);
    expect(o.success).toBe(false);
    expect(o.authority).toBe("envelope-outstanding");
  });

  it("a kernel terminal whose gate REFUSED the deliverable caps the strategy result (ToT shares the reactive gate)", async () => {
    const meta = { ...initialKernelState({ strategy: "tree-of-thought", kernelType: "react", maxIterations: 4 }).meta, terminatedBy: "harness_deliverable", deliverableDecision: deliberate({ accepted: false, why: "unauthored", verifier: { verified: false, failedChecks: ["output-is-model-authored"] } }) };
    const { value } = await traced(
      finalizeStrategyResult({ ...finalizeBase, strategy: "tree-of-thought", taskId: "tot", status: "completed", kernelMeta: meta, extraMetadata: { terminatedBy: "end_turn" } }),
    );
    expect(value.status).toBe("partial");
    expect(value.metadata.extensions?.terminalOutcome).toMatchObject({ status: "partial", success: false, deliverable: { outcome: "block" } });
  });
});

describe("R6 — budget-cap summary never reports more successes than attempts", () => {
  it("observations without surviving action steps still count as attempted", () => {
    const obs = (n: string) => makeStep("observation", "ok", { observationResult: makeObservationResult(n, true, "ok") });
    const text = summarizeAttempts([obs("a"), obs("b"), obs("c")]);
    expect(text).toContain("3 tool call(s) attempted");
    expect(text).toContain("3 succeeded");
  });
});
