// Run: bun test packages/reasoning/tests/kernel/trace-root-cause-gaps.test.ts --timeout 20000
//
// Kernel gaps from the 2026-11-03 trace signal confirmation (G2/G3/G4/G5/G6/G9
// + kernel verdict source + exact final kernel iteration). Everything is read
// back THROUGH the normalized trace (`toTraceEvent`) or the result envelope.
// RED-ON-CUT (each verified by a temporary mutation, reverted):
//   G5  drop `iteration` in kernel-hooks onStrategySwitched
//   G6/G4 drop the `verifier` arg at finalizeDeliverableDecision, or `outstanding` in the mint
//   G9  drop `finalStatus` in terminalDecisionMetadata, or the `abstainedRun` override arm
//   G3  drop `posture` at the runner's compileRunContract call
//   G2  drop `describeLlmFailure` at the failed-exchange emit / `errorClass` stamp
//   src drop `source: args.source ?? "kernel"` in emitVerifierVerdict
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option, Ref } from "effect";
import { TestLLMServiceLayer, LLMService } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { succeedingToolLayer, mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";
import { buildKernelHooks } from "../../src/kernel/state/kernel-hooks.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { RunEnvelope, buildRunEnvelope, provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { initialKernelState, transitionState, type KernelRunOptions } from "../../src/kernel/state/kernel-state.js";
import { deriveTerminalOutcome, kernelReconciledStatus } from "../../src/kernel/state/terminal-outcome.js";
import { describeLlmFailure } from "../../src/kernel/utils/llm-failure.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { finalizeStrategyResult } from "../../src/kernel/capabilities/sense/finalize-result.js";

const toTrace = (raw: readonly AgentEvent[]): readonly TraceEvent[] =>
  raw.flatMap((e, i) => {
    const t = toTraceEvent(e, i);
    return t ? [t] : [];
  });
const guards = (t: readonly TraceEvent[], name: string) =>
  t.flatMap((e) => (e.kind === "guard-fired" && e.guard === name ? [e] : []));
const meta = (e: { readonly metadata?: unknown }): Record<string, unknown> => e.metadata as Record<string, unknown>;
type Outcome = {
  status: string; authority: string; outstanding: string[]; errorClass?: string;
  deliverable: { outcome: string; reason: string; accepted: boolean } | null;
  verifierVerdict: { verified: boolean; failedChecks: string[] } | null;
};
const outcomeOf = (r: { metadata: { extensions?: Record<string, unknown> } }): Outcome =>
  r.metadata.extensions?.terminalOutcome as Outcome;

const options: KernelRunOptions = { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "gaps", modelId: "llama3.2:3b" };

// ── G5 ───────────────────────────────────────────────────────────────────────
describe("G5: strategy-switched carries the iteration", () => {
  it("onStrategySwitched stamps state.iteration (was -1)", async () => {
    const raw = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("StrategySwitched", (ev) => Ref.update(events, (xs) => [...xs, ev]));
        const hooks = buildKernelHooks(Option.some(bus));
        const state = transitionState(initialKernelState(options), { iteration: 3 });
        yield* hooks.onStrategySwitched(state, "reactive", "plan-execute-reflect", "loop");
        return yield* Ref.get(events);
      }).pipe(Effect.provide(EventBusLive)),
    );
    const sw = toTrace(raw).find((e) => e.kind === "strategy-switched");
    expect(sw?.iter).toBe(3);
  });
});

// ── G6 / G4 / G9 on the stall shape (gate refuses a harness deliverable) ─────
const GATHER = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};
async function stalledRun() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      const result = yield* executeReactive({
        taskDescription: "Research the topic and summarize it.", taskType: "research", memoryContext: "",
        availableTools: ["gather"], availableToolSchemas: [GATHER], config: defaultReasoningConfig, maxIterations: 8,
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

describe("G6/G4/G9: outcome names the gate decision, the verifier verdict and what is outstanding", () => {
  it("refused deliverable: decision block + verifier failed checks + outstanding ids, on outcome AND override", async () => {
    const { result, trace } = await stalledRun();
    const o = outcomeOf(result);
    expect(o.status).toBe("partial");
    expect(o.deliverable).toMatchObject({ outcome: "block", accepted: false });
    expect(o.verifierVerdict?.verified).toBe(false);
    expect(o.verifierVerdict?.failedChecks).toContain("output-is-model-authored");
    expect(o.outstanding).toContain("answer");
    expect(o.outstanding).toContain("output-is-model-authored");
    const [ov] = guards(trace, "terminal_status_override");
    expect(meta(ov!).outstanding).toEqual(o.outstanding);
    expect(meta(ov!).deliverable).toEqual(o.deliverable);
    expect(meta(ov!).verifierVerdict).toEqual(o.verifierVerdict);
  });

  it("terminal_decision carries the reconciled final status beside done/failed", async () => {
    const { trace } = await stalledRun();
    const m = meta(guards(trace, "terminal_decision")[0]!);
    expect(m.status).toBe("done");
    expect(m.finalStatus).toBe("partial");
  });

  it("kernelReconciledStatus: failed | abstained | partial | completed", () => {
    const base = initialKernelState(options);
    expect(kernelReconciledStatus(transitionState(base, { status: "failed" }))).toBe("failed");
    expect(kernelReconciledStatus(transitionState(base, { status: "done", meta: { ...base.meta, terminatedBy: "abstained" } }))).toBe("abstained");
    expect(kernelReconciledStatus(transitionState(base, { status: "done", meta: { ...base.meta, budgetTerminalPartial: true } }))).toBe("partial");
    expect(kernelReconciledStatus(transitionState(base, { status: "done" }))).toBe("completed");
  });

  it("an ACCEPTED deliverable over a failing verifier reads as overridden by the decision, not as a lie", () => {
    const o = deriveTerminalOutcome({
      status: "completed",
      meta: {
        terminatedBy: "harness_deliverable",
        deliverableDecision: {
          chosen: "tool-artifact", accepted: true, why: "harness-authored-verified-artifact",
          verdictSummary: "final-answer: failed at output-is-model-authored", rejected: [],
          verifier: { verified: false, failedChecks: ["output-is-model-authored"] },
        },
      },
      ledger: undefined,
    });
    expect(o.deliverable).toEqual({ outcome: "pass", reason: "harness-authored-verified-artifact", accepted: true });
    expect(o.verifierVerdict).toEqual({ verified: false, failedChecks: ["output-is-model-authored"] });
    expect(o.outstanding).toEqual([]); // accepted: nothing held the status back
    expect(o.success).toBe(true);
  });
});

describe("G9: an abstained run the kernel minted `done` discloses itself", () => {
  it("terminal_status_override fires with reason abstention", async () => {
    const meta0 = { terminatedBy: "abstained", terminalDecision: { taskId: "ab", iteration: 2, status: "done", authority: "abstention", finalStatus: "abstained" } };
    const { result, trace } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
        const result = yield* finalizeStrategyResult({
          strategy: "reactive", steps: [], output: "cannot ground an answer", status: "partial", start: 0, totalTokens: 1, totalCost: 0,
          kernelMeta: { ...initialKernelState(options).meta, ...meta0 },
          extraMetadata: { terminatedBy: "abstained", rawTerminatedBy: "abstained", abstention: { reason: "no data", missing: [] } },
        });
        return { result, trace: toTrace(yield* Ref.get(events)) };
      }).pipe(Effect.provide(EventBusLive), provideTestEnvelope),
    );
    expect(outcomeOf(result)).toMatchObject({ status: "abstained", authority: "abstention" });
    const [ov] = guards(trace, "terminal_status_override");
    expect(ov?.reason).toBe("abstention");
    expect(meta(ov!)).toMatchObject({ terminalDecisionStatus: "done", finalStatus: "abstained", abstained: true });
    // exact final kernel iteration rides the result for the runtime to read
    expect(result.metadata.extensions?.kernelIteration).toBe(2);
  });
});

// ── G3 plan posture x contract ───────────────────────────────────────────────
describe("G3: plan posture does not demand what it withholds", () => {
  const TASK = "Write the three lines alpha, beta, gamma into notes.txt using file-write.";
  it("compileRunContract under plan drops the artifact + derived writer requirements; execute keeps them", () => {
    const ids = (posture?: "plan") =>
      compileRunContract(TASK, { ...(posture ? { posture } : {}) }).requirements.map((r) => r.id);
    expect(ids()).toContain("tool:file-write");
    expect(ids()).toContain("artifact:./notes.txt");
    expect(ids("plan")).toEqual(["answer"]);
  });

  it("plan tools stay required under plan; a withheld required tool does not", () => {
    const ids = compileRunContract("t", { posture: "plan", requiredTools: ["file-write", "todo"] }).requirements.map((r) => r.id);
    expect(ids).toContain("tool:todo");
    expect(ids).not.toContain("tool:file-write");
  });

  const SCHEMAS = [
    { name: "file-write", description: "write", parameters: [{ name: "path", type: "string", required: true }] },
    { name: "todo", description: "checklist", parameters: [{ name: "action", type: "string", required: true }, { name: "items", type: "array", required: false }] },
  ];
  const planTurn = (posture: "plan" | undefined) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
        const result = yield* executeReactive({
          taskDescription: TASK, taskType: "query", memoryContext: "", availableTools: ["file-write", "todo"],
          availableToolSchemas: SCHEMAS, config: defaultReasoningConfig, maxIterations: 6,
          metaTools: { todo: true },
        } as never);
        return { result, trace: toTrace(yield* Ref.get(events)) };
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([
              { text: "planning", toolCalls: [{ name: "todo", args: { action: "add", items: ["write alpha", "write beta", "write gamma"] } }] },
              { text: "FINAL ANSWER: Plan: 1) write alpha 2) write beta 3) write gamma. Say go to start." },
            ]),
            mockToolServiceLayer({
              execute: () => Effect.succeed({ success: true, result: { ok: 1 } }),
              getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [{ name: "q", type: "string", required: true }] }),
            }),
            EventBusLive,
          ),
        ),
        (eff) => provideTestEnvelope(eff, buildRunEnvelope({ ...(posture ? { posture } : {}) })),
      ),
    );

  it("a plan turn on a task naming file-write ends completed with the plan recorded, not vetoed by contract-coverage", async () => {
    const { result, trace } = await planTurn("plan");
    expect(result.status).toBe("completed");
    expect(outcomeOf(result)).toMatchObject({ status: "completed", authority: "model-final", outstanding: [] });
    expect(guards(trace, "terminal_status_override")).toEqual([]);
    const posture = guards(trace, "posture-applied");
    expect(meta(posture[posture.length - 1]!).planRecorded).toBe(true);
  });

  it("CONTROL: the same task in execute posture still carries the file-write requirement", async () => {
    const { result } = await planTurn(undefined);
    expect(outcomeOf(result).outstanding).toContain("artifact:./notes.txt");
  });
});

// ── G2 failed LLM call ───────────────────────────────────────────────────────
describe("G2: a failed LLM call records its error class + message", () => {
  it("describeLlmFailure reads _tag | kind | name structurally, one level down `cause`, skipping generic Error", () => {
    expect(describeLlmFailure({ _tag: "LLMRateLimitError", message: "slow down" })).toEqual({ errorClass: "LLMRateLimitError", message: "slow down" });
    expect(describeLlmFailure({ kind: "auth", message: "bad key" }).errorClass).toBe("auth");
    expect(describeLlmFailure({ name: "TimeoutError", message: "t" }).errorClass).toBe("TimeoutError");
    expect(describeLlmFailure({ message: "wrapped", cause: { _tag: "LLMError" } }).errorClass).toBe("LLMError");
    expect(describeLlmFailure({ name: "Error", message: "x" }).errorClass).toBe("unknown");
    expect(describeLlmFailure("boom")).toEqual({ errorClass: "unknown", message: "boom" });
  });

  const failingLlm = (err: unknown) =>
    Layer.succeed(LLMService, {
      complete: () => Effect.fail(err),
      stream: () => Effect.fail(err),
      completeStructured: () => Effect.fail(err),
      embed: () => Effect.succeed([]),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "ollama", model: "bad-model" }),
      getStructuredOutputCapabilities: () => Effect.succeed({}),
      capabilities: () => Effect.succeed({}),
    } as never);

  it("the failed llm-exchange carries stopReason error + response.error {class,message}", async () => {
    const { raw } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
        const llm = yield* LLMService;
        yield* llm.complete({ messages: [{ role: "user", content: "hi" }], model: "bad-model" } as never).pipe(Effect.either);
        return { raw: yield* Ref.get(events) };
      }).pipe(
        Effect.provide(Layer.mergeAll(makeObservableLLM().pipe(Layer.provide(failingLlm({ _tag: "LLMModelNotFound", message: "model 'bad-model' not found" }))), EventBusLive)),
      ),
    );
    const ex = toTrace(raw).find((e) => e.kind === "llm-exchange");
    expect(ex?.kind === "llm-exchange" && ex.response.stopReason).toBe("error");
    expect(ex?.kind === "llm-exchange" && ex.response.error).toEqual({ class: "LLMModelNotFound", message: "model 'bad-model' not found" });
  });

  it("the run ends authority error with the errorClass on terminal_decision and the outcome", async () => {
    const { result, trace } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
        const result = yield* executeReactive({
          taskDescription: "What is 2 + 2?", taskType: "query", memoryContext: "", availableTools: [],
          availableToolSchemas: [], config: defaultReasoningConfig, maxIterations: 4,
        } as never);
        return { result, trace: toTrace(yield* Ref.get(events)) };
      }).pipe(
        Effect.provide(Layer.mergeAll(makeObservableLLM().pipe(Layer.provide(failingLlm({ _tag: "LLMModelNotFound", message: "model not found" }))), EventBusLive)),
        provideTestEnvelope,
      ),
    );
    expect(result.status).toBe("failed");
    const td = meta(guards(trace, "terminal_decision")[0]!);
    expect(td).toMatchObject({ authority: "error", terminatedBy: "llm_error", errorClass: "LLMModelNotFound", finalStatus: "failed" });
    expect(outcomeOf(result)).toMatchObject({ authority: "error", errorClass: "LLMModelNotFound" });
    const ex = trace.find((e) => e.kind === "llm-exchange");
    expect(ex?.kind === "llm-exchange" && ex.response.error?.class).toBe("LLMModelNotFound");
  });
});

// ── kernel verdict source ────────────────────────────────────────────────────
describe("kernel verifier verdicts name their source", () => {
  it("every kernel verifier-verdict carries source:kernel", async () => {
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
      }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer([{ text: "FINAL ANSWER: 4." }]), EventBusLive)), provideTestEnvelope),
    );
    const verdicts = trace.flatMap((e) => (e.kind === "verifier-verdict" ? [e] : []));
    expect(verdicts.length).toBeGreaterThan(0);
    for (const v of verdicts) expect(v.source).toBe("kernel");
  });
});
