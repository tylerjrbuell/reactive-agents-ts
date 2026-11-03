// Run: bun test packages/reasoning/tests/kernel/trace-decisive-feedback.test.ts --timeout 20000
//
// Trace-feedback items 2-4 (debuggability audit 2026-11-03), MEASUREMENT ONLY:
//   2. the terminal status has a recorded authority; `terminal_decision` and the
//      TerminalOutcome come from one derivation; a finalization arm that moves the
//      status emits a `terminal_status_override` diagnostic.
//   3. `tool-call-end.iter` is the real iteration (was -1 in 131/131 events);
//      the kernel's verifier iteration never exceeds the run's LLM turns.
//   4. terminal-capable guards record {counter, observed, threshold}.
// Everything is read back THROUGH the normalized trace (`toTraceEvent`).
// RED-ON-CUT: drop `iteration` in kernel-hooks onObservation, `authority` in
// terminalDecisionMetadata, the `terminalSite` stamps, the `arm` join in
// finalize-result, or any `guardEvidence(...)` spread, and the matching test fails.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { mockToolServiceLayer, succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { RunEnvelope, buildRunEnvelope, provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { resolveDetectedLoop } from "../../src/kernel/loop/runner-helpers/loop-resolution.js";
import { detectLoopPattern } from "../../src/kernel/capabilities/reflect/loop-detector.js";
import { lowDeltaEvidence, oracleForcedEvidence } from "../../src/kernel/loop/runner-helpers/tier-guards.js";
import { deriveTerminalAuthority } from "../../src/kernel/state/terminal-authority.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { handleDispatcherEarlyStop } from "../../src/kernel/loop/iterate-early-stop-seam.js";
import { zeroEvidenceStandDownWithEvidence } from "../../src/kernel/loop/iterate-assessment-seam.js";
import { forceTerminalSynthesis } from "../../src/kernel/loop/runner-helpers/pace-terminal.js";
import {
  initialKernelState,
  transitionState,
  type KernelInput,
  type KernelRunOptions,
} from "../../src/kernel/state/kernel-state.js";
import {
  makeKernelInput,
  makeKernelRunOptions,
  makeRunAssessment,
  makeRunContract,
} from "../../src/testing/kernel-fixtures.js";

const SCHEMAS = [{ name: "my-tool", description: "user tool", parameters: [{ name: "q", type: "string", required: true }] }];
const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: { ok: 1 } }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "t", parameters: [{ name: "q", type: "string", required: true }] }),
});

const toTrace = (raw: readonly AgentEvent[]): readonly TraceEvent[] =>
  raw.flatMap((e, i) => {
    const t = toTraceEvent(e, i);
    return t ? [t] : [];
  });

const guards = (t: readonly TraceEvent[], name: string) =>
  t.flatMap((e) => (e.kind === "guard-fired" && e.guard === name ? [e] : []));
const meta = (e: { readonly metadata?: unknown }): Record<string, unknown> => e.metadata as Record<string, unknown>;

/** A clean scripted run: two tool turns then a model-authored final answer. */
async function cleanRun(): Promise<readonly TraceEvent[]> {
  const opts: KernelRunOptions = { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "decisive", modelId: "llama3.2:3b" };
  const raw = await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      const input: KernelInput = {
        task: "Look up the BTC thing with my-tool.",
        availableToolSchemas: SCHEMAS,
        providerName: "ollama",
        contextProfile: { tier: "local", maxTokens: 8192 },
      };
      yield* runPass(reactKernel, input, opts);
      return yield* Ref.get(events);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeObservableLLM().pipe(
            Layer.provide(
              TestLLMServiceLayer([
                { text: "thinking one", toolCalls: [{ name: "my-tool", args: { q: "a" } }] },
                { text: "thinking two", toolCalls: [{ name: "my-tool", args: { q: "b" } }] },
                { text: "done now." },
              ]),
            ),
          ),
          toolLayer,
          EventBusLive,
          Layer.succeed(RunEnvelope, buildRunEnvelope({})),
        ),
      ),
    ),
  );
  return toTrace(raw);
}

describe("item 3: iteration stamps", () => {
  it("tool-call-end.iter is the real iteration and pairs with its tool-call-start", async () => {
    const trace = await cleanRun();
    const starts = trace.flatMap((e) => (e.kind === "tool-call-start" ? [e.iter] : []));
    const ends = trace.flatMap((e) => (e.kind === "tool-call-end" ? [e.iter] : []));
    expect(ends.length).toBe(2);
    expect(ends).toEqual(starts);
    for (const i of ends) expect(i).toBeGreaterThanOrEqual(0);
    expect([...ends].sort((a, b) => a - b)).toEqual(ends); // monotonic
  });

  it("kernel verifier-verdict iteration never exceeds the run's LLM turns; llm-exchange names a real provider", async () => {
    const trace = await cleanRun();
    const llmTurns = trace.filter((e) => e.kind === "llm-exchange").length;
    const verdicts = trace.flatMap((e) => (e.kind === "verifier-verdict" ? [e.iter] : []));
    expect(verdicts.length).toBeGreaterThan(0);
    for (const i of verdicts) expect(i).toBeLessThanOrEqual(llmTurns);
    for (const e of trace) if (e.kind === "llm-exchange") expect(e.provider).not.toBe("unknown");
  });
});

describe("item 2: terminal authority", () => {
  it("terminal_decision records authority + the iteration-cap counter vs its threshold", async () => {
    const trace = await cleanRun();
    const [td] = guards(trace, "terminal_decision");
    expect(td).toBeDefined();
    const m = meta(td!);
    expect(m.authority).toBe("model-final");
    expect(m.iterationCap).toMatchObject({ counter: "iteration", threshold: 6, capped: false });
    expect(typeof (m.iterationCap as Record<string, unknown>).observed).toBe("number");
    expect(typeof (m.iterationCap as Record<string, unknown>).llmCalls).toBe("number");
  });

  it("deriveTerminalAuthority: pure table over terminatedBy + gate decision + site stamp", () => {
    const a = deriveTerminalAuthority;
    expect(a({ terminatedBy: "final_answer_tool" })).toBe("model-final");
    expect(a({ terminatedBy: "end_turn" })).toBe("model-final");
    expect(a({ terminatedBy: "abstained" })).toBe("abstention");
    expect(a({ terminatedBy: "low_delta_guard" })).toBe("guard:low_delta");
    expect(a({ terminatedBy: "oracle_forced" })).toBe("guard:oracle_forced");
    expect(a({ terminatedBy: "dispatcher-early-stop" })).toBe("guard:dispatcher_early_stop");
    expect(a({ terminatedBy: "budget_terminal" })).toBe("budget");
    expect(a({ terminatedBy: "max_iterations" })).toBe("strategy-exhausted");
    expect(a({ terminatedBy: "loop_graceful" })).toBe("loop-resolution");
    expect(a({ terminatedBy: "harness_deliverable", terminalSite: "stall-deliverable" })).toBe("stall-deliverable");
    expect(a({ terminatedBy: "harness_deliverable" })).toBe("harness-deliverable");
    expect(a({ terminatedBy: "end_turn", deliverableDecision: { accepted: false } })).toBe("gate-verdict");
    expect(a({})).toBe("none-recorded");
  });
});

const GATHER = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

/** The stall shape (see terminal-outcome-reconcile.integration.test.ts), observed through the bus. */
async function stalledRun() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      const result = yield* executeReactive({
        taskDescription: "Research the topic and summarize it.",
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER],
        config: defaultReasoningConfig,
        maxIterations: 8,
      } as never);
      return { result, trace: toTrace(yield* Ref.get(events)) };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestLLMServiceLayer([
            ...Array.from({ length: 5 }, () => ({ toolCall: { name: "gather", args: { q: "a" } } })),
            { text: "FINAL ANSWER: unsynthesized guess." },
          ]),
          succeedingToolLayer({ finding: "KEY FACT: the core metric rose 12% last quarter." }, GATHER.parameters),
          EventBusLive,
        ),
      ),
      provideTestEnvelope,
    ),
  );
}

describe("items 2+4 on the stall shape (harness deliverable the gate refused)", () => {
  it("stall guard records counter/observed/threshold; terminal authority and the override diagnostic agree", async () => {
    const { result, trace } = await stalledRun();
    const stall = guards(trace, "stall_deliverable");
    expect(stall.length).toBeGreaterThan(0);
    const sm = meta(stall[0]!);
    expect(sm.counter).toBeDefined();
    expect(typeof sm.observed).toBe("number");
    expect(typeof sm.threshold).toBe("number");
    expect(sm.observed as number).toBeGreaterThanOrEqual(sm.threshold as number);

    // One derivation: the gate refused the deliverable, so the gate owns the label.
    const [td] = guards(trace, "terminal_decision");
    expect(meta(td!).authority).toBe("gate-verdict");
    const outcome = (result.metadata.extensions as Record<string, unknown>).terminalOutcome as { authority: string; status: string };
    expect(outcome.authority).toBe("gate-verdict");
    expect(outcome.status).toBe("partial");

    // kernel said done; the finalization arm made it partial: say so, with who.
    const [ov] = guards(trace, "terminal_status_override");
    expect(ov).toBeDefined();
    expect(meta(ov!)).toMatchObject({
      terminalDecisionStatus: "done",
      finalStatus: "partial",
      authority: "gate-verdict",
      labelsDisagree: true,
    });
  });

  it("CONTROL: a clean completion emits no override diagnostic", async () => {
    const { trace } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
        yield* executeReactive({
          taskDescription: "What is 2 + 2?", taskType: "query", memoryContext: "", availableTools: [],
          availableToolSchemas: [], config: defaultReasoningConfig, maxIterations: 4,
        } as never);
        return { trace: toTrace(yield* Ref.get(events)) };
      }).pipe(
        Effect.provide(Layer.mergeAll(TestLLMServiceLayer([{ text: "FINAL ANSWER: 4." }]), EventBusLive)),
        provideTestEnvelope,
      ),
    );
    expect(guards(trace, "terminal_status_override")).toEqual([]);
    expect(meta(guards(trace, "terminal_decision")[0]!).authority).toBe("model-final");
  });
});

describe("item 2: a finalization arm that flips the status names itself", () => {
  it("give-up gate: kernel done -> abstained records authority give-up-gate in the outcome and the override event", async () => {
    const { result, trace } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
        const result = yield* executeReactive({
          taskDescription: "Send the report to the board.", taskType: "query", memoryContext: "", availableTools: [],
          availableToolSchemas: [], config: defaultReasoningConfig, maxIterations: 4,
        } as never);
        return { result, trace: toTrace(yield* Ref.get(events)) };
      }).pipe(
        Effect.provide(Layer.mergeAll(TestLLMServiceLayer([{ text: "FINAL ANSWER: I am unable to do that, I do not have access to any tools." }]), EventBusLive)),
        provideTestEnvelope,
      ),
    );
    const outcome = (result.metadata.extensions as Record<string, unknown>).terminalOutcome as { authority: string; status: string };
    expect(outcome).toMatchObject({ status: "abstained", authority: "give-up-gate" });
    const [ov] = guards(trace, "terminal_status_override");
    expect(meta(ov!)).toMatchObject({ terminalDecisionStatus: "done", finalStatus: "abstained", authority: "give-up-gate", labelsDisagree: false });
  });
});

describe("item 4: terminal-capable guards record {counter, observed, threshold}", () => {
  it("loop-detector patterns carry evidence", () => {
    const act = (n: number) => makeStep("action", `{"tool":"t","input":{}}`, { toolCall: { id: `c${n}`, name: "t", arguments: {} } });
    const d = detectLoopPattern([act(1), act(2), act(3)], 3, 3, 3);
    expect(d?.pattern.id).toBe("a");
    expect(d?.evidence).toEqual({ counter: "sameToolCallRun", observed: 3, threshold: 3 });
    const th = detectLoopPattern(
      [makeStep("thought", "a"), makeStep("thought", "b"), makeStep("thought", "c"), makeStep("thought", "d")],
      9, 9, 3,
    );
    expect(th?.pattern.id).toBe("c");
    expect(th?.evidence).toEqual({ counter: "consecutiveThoughts", observed: 4, threshold: 3 });
  });

  it("loop_resolution terminal (incl. the failure branch that emitted nothing before) carries pattern + evidence", async () => {
    const options = makeKernelRunOptions({ strategy: "react" });
    const steps = [
      makeStep("action", "call", { toolCall: { id: "1", name: "web-search", arguments: {} } }),
      makeStep("observation", "ENOENT", { observationResult: makeObservationResult("web-search", false, "ENOENT not found") }),
    ];
    const state = transitionState(initialKernelState(options), { steps });
    const detection = { message: "loop", pattern: { id: "c" as const, name: "consecutive-thoughts" }, evidence: { counter: "consecutiveThoughts", observed: 4, threshold: 3 } };
    const { trace, outcome } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("GuardFiredEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
        const r = yield* resolveDetectedLoop({
          state, currentInput: makeKernelInput({ task: "t" }), currentOptions: options, loopMsg: "loop", detection,
          failureRecoveryRedirects: 0, requiredToolNudgeCount: 0, maxFailureRecoveryRedirects: 0, maxRequiredToolNudges: 2,
          emitLog: () => Effect.void,
        });
        return { trace: toTrace(yield* Ref.get(events)), outcome: r.state.status };
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(outcome).toBe("failed");
    const [g] = guards(trace, "loop_resolution");
    expect(meta(g!)).toMatchObject({ pattern: "c", patternName: "consecutive-thoughts", counter: "consecutiveThoughts", observed: 4, threshold: 3 });
  });

  it("low-delta and oracle-forced evidence quote the live comparison operands", () => {
    expect(lowDeltaEvidence({ tokenDelta: 120, consecutiveLowDeltaCount: 2, tier: "local" })).toMatchObject({
      counter: "consecutiveLowDeltaCount", observed: 2, threshold: 2, tokenDelta: 120, minIteration: 3,
    });
    expect(typeof lowDeltaEvidence({ tokenDelta: 1, consecutiveLowDeltaCount: 2 }).tokenDeltaThreshold).toBe("number");
    expect(oracleForcedEvidence(3, 2)).toEqual({ counter: "readyToAnswerNudgeCount", observed: 3, threshold: 2 });
  });
});

/** Run `eff` with a bus and return the trace of its `guard-fired` events. */
const guardTrace = <A>(eff: Effect.Effect<A, never, EventBus>): Promise<readonly TraceEvent[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
      yield* eff;
      return toTrace(yield* Ref.get(events));
    }).pipe(Effect.provide(EventBusLive)),
  );

describe("item 4: guards that terminated with no record before", () => {
  const options = makeKernelRunOptions({ strategy: "react", maxIterations: 9, taskId: "g" });

  it("dispatcher early-stop records the evaluator's reason + the iteration corridor", async () => {
    const base = initialKernelState(options);
    const state = transitionState(base, {
      iteration: 4,
      meta: {
        ...base.meta, maxIterations: 9, terminatedBy: "dispatcher-early-stop", evidenceGraceGiven: true,
        dispatcherEarlyStop: { reason: "Entropy converging for 2 iterations (composite: 0.200, threshold: 0.3)", iteration: 4 },
      },
    });
    const trace = await guardTrace(
      handleDispatcherEarlyStop({ state, input: makeKernelInput({ task: "t" }), effectiveInput: makeKernelInput({ task: "t" }) }),
    );
    const [g] = guards(trace, "dispatcher_early_stop");
    expect(meta(g!)).toMatchObject({
      evaluatorReason: expect.stringContaining("composite: 0.200"), counter: "iteration", observed: 4, threshold: 9,
    });
  });

  it("zero-evidence stand-down records staleness vs its threshold (and stays silent when it does not fire)", async () => {
    const thought = (c: string) => makeStep("thought", c);
    const refusals = Array.from({ length: 3 }, () => thought("I keep thinking about how to approach this request but I am not getting anywhere with it at all, the same idea again."));
    const base = initialKernelState(options);
    const state = transitionState(base, { tokens: 500, iteration: 3, steps: refusals });
    const assessment = makeRunAssessment({ requirements: { outstanding: ["answer"] } });
    const fire = (stale: number) =>
      guardTrace(
        Effect.gen(function* () {
          const r = yield* zeroEvidenceStandDownWithEvidence({
            state, assessment, evidenceStaleIterations: stale, requiredTools: [], currentOptions: options,
          });
          expect(r === null).toBe(stale < 2);
        }),
      );
    const [g] = guards(await fire(3), "zero_evidence_stand_down");
    expect(meta(g!)).toMatchObject({ counter: "evidenceStaleIterations", observed: 3, threshold: 2, outstandingRequirements: 1 });
    expect(guards(await fire(1), "zero_evidence_stand_down")).toEqual([]);
  });

  it("pace_terminal records burnRatio vs the terminal-band threshold and the inputs it came from", async () => {
    const base = initialKernelState(options);
    const state = transitionState(base, { tokens: 970, iteration: 6, meta: { ...base.meta, maxIterations: 9 } });
    const assessment = makeRunAssessment({ pace: { band: "terminal", burnRatio: 0.97 }, requirements: { outstanding: [] }, deliverables: { missing: [] } });
    const contract = makeRunContract();
    const trace = await guardTrace(
      forceTerminalSynthesis({ state, task: "t", llm: undefined, contract, assessment, taskId: "g", emitLog: () => Effect.void }),
    );
    const [g] = guards(trace, "pace_terminal");
    expect(meta(g!)).toMatchObject({
      counter: "burnRatio", observed: 0.97, threshold: 0.95, band: "terminal", tokensUsed: 970, iteration: 6, maxIterations: 9,
    });
  });
});
