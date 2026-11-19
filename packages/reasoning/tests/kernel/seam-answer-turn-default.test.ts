// Run: bun test packages/reasoning/tests/kernel/seam-answer-turn-default.test.ts --timeout 20000
//
// Cortex trace 01M7TERZAVP2RS489WEBJ3HY7H (gemini, reactive, maxIterations
// 16 -> 19 by refunds): the model gathered its evidence, then spent the rest of
// the budget re-reading it with `recall` (duplicate_guard replays, three
// loop_guidance no-new-evidence redirects). On the last call it called recall
// again, the dispatcher early-stop ended the run (exit gate: handoff), the five
// pending recalls were dropped and the run FAILED answerless. A continuation
// then wrote a good report from the same results.
//
// Owner decision 2026-11-19: the budget answer turn is ON by default
// (`harness.budgetAnswerTurn`; `false` / `RA_BUDGET_ANSWER_TURN=0` turn it
// off), and a guard stop (early-stop, no-progress) that would end such a run
// answerless gets the same one answer turn even after an earlier denial.
// Structural, not a prompt nudge: the turn ships with no tools.
//
// RED-ON-CUT (measured 2026-11-19):
//   - `budgetAnswerTurnEnabled()` back to `=== "1"`: the default-resolution
//     test and the default-harness reproduction go red (the last call keeps tools).
//   - drop the `answerTurnGiven` branch in `disposeExit`: the "after an
//     earlier denial" disposeExit and proposeExit cases go red.
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent, type TestTurn } from "@reactive-agents/llm-provider";
import { EventBusLive, harnessSynthesisDeliverable } from "@reactive-agents/core";
import { DISPATCHER_EARLY_STOP, disposeExit, proposeExit } from "../../src/kernel/loop/exit-gate.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";

const TASK = "Research the latest trends and news about AI agents and write a short report with sources.";
const EVIDENCE = "1. Databricks agent tells CEO the unvarnished truth: https://techcrunch.com/2026/11/11/databricks-agent";
const ANSWER = "AI agents report: enterprises are adopting agents fast; Databricks shipped one (https://techcrunch.com/2026/11/11/databricks-agent).";
const PARAMS = [{ name: "q", type: "string", required: true }];

describe("budget answer turn: default ON (owner decision 2026-11-19)", () => {
  const saved = process.env.RA_BUDGET_ANSWER_TURN;
  afterEach(() => {
    if (saved === undefined) delete process.env.RA_BUDGET_ANSWER_TURN;
    else process.env.RA_BUDGET_ANSWER_TURN = saved;
  });

  it("resolves on by default; config false or RA_BUDGET_ANSWER_TURN=0 turns it off; config beats env", () => {
    delete process.env.RA_BUDGET_ANSWER_TURN;
    expect(resolveHarnessConfig().budgetAnswerTurn).toBe(true);
    expect(buildRunEnvelope({}).harness.budgetAnswerTurn).toBe(true);
    expect("budgetAnswerTurn" in resolveHarnessConfig({ budgetAnswerTurn: false })).toBe(false);
    process.env.RA_BUDGET_ANSWER_TURN = "0";
    expect("budgetAnswerTurn" in resolveHarnessConfig()).toBe(false);
    expect(resolveHarnessConfig({ budgetAnswerTurn: true }).budgetAnswerTurn).toBe(true);
  });
});

describe("a guard stop after an earlier denial still gets one answer turn", () => {
  const base = {
    proposedBy: "dispatcher_early_stop", kind: "soft", outstanding: ["write the final answer from the gathered tool results"],
    hasMaterial: true, deniedBefore: true, iteration: 6, llmCalls: 6, maxIterations: 10, answerOnly: true, budgetAnswerTurn: true,
  } as const;

  it("disposeExit: deny-once (the answer turn) instead of an answerless handoff", () => {
    expect(disposeExit(base)).toBe("deny-once");
  });

  it("only once per run, only answer-only, only with material, only with the flag, only with room", () => {
    expect(disposeExit({ ...base, answerTurnGiven: true })).toBe("handoff");
    expect(disposeExit({ ...base, answerOnly: false })).toBe("handoff");
    expect(disposeExit({ ...base, hasMaterial: false })).toBe("accept");
    expect(disposeExit({ ...base, budgetAnswerTurn: false })).toBe("handoff");
    expect(disposeExit({ ...base, llmCalls: 10 })).toBe("handoff");
  });

  const gathered = [
    makeStep("action", "web-search({})", { toolCall: { id: "w1", name: "web-search", arguments: { q: "ai agents" } } }),
    makeStep("observation", EVIDENCE, { toolCallId: "w1", observationResult: makeObservationResult("web-search", true, EVIDENCE) }),
  ];
  const denial = (answerTurnAt?: number) =>
    makeStep("harness_signal", "exit gate", {
      exitGate: {
        proposedBy: "loop_detector", gateDecision: "deny-once", reason: "loop", outstanding: ["make progress"],
        ...(answerTurnAt === undefined ? {} : { answerTurnAt }),
      },
    });
  const stateWith = (extra: ReturnType<typeof makeStep>): KernelState =>
    makeKernelState({ status: "thinking", iteration: 6, llmCalls: 6, toolsUsed: new Set(["web-search"]), steps: [...gathered, extra] } as never);
  const earlyStop = (state: KernelState, on = true) =>
    Effect.runPromise(
      proposeExit({
        state,
        proposal: { ...DISPATCHER_EARLY_STOP, deliverable: harnessSynthesisDeliverable([], undefined, "") },
        input: makeKernelInput({ task: TASK, harness: resolveHarnessConfig({ budgetAnswerTurn: on }) }),
        maxIterations: 10,
        taskId: "t",
      }).pipe(Effect.provide(EventBusLive)),
    );

  it("proposeExit (dispatcher early-stop, earlier non-answer denial): an answer turn, not a failed handoff", async () => {
    const { decision, state } = await earlyStop(stateWith(denial()));
    expect(decision).toBe("deny-once");
    expect(state.status).toBe("thinking");
    expect(state.steps.at(-1)?.metadata?.exitGate?.answerTurnAt).toBe(6);
    // Labelled as the answer turn, not as a write-progress re-denial.
    expect(state.steps.at(-1)?.metadata?.exitGate?.reason).toBe(DISPATCHER_EARLY_STOP.reason);
  });

  it("proposeExit: an answer turn already granted, or the flag off: the stop stands (handoff)", async () => {
    expect((await earlyStop(stateWith(denial(4)))).decision).toBe("handoff");
    expect((await earlyStop(stateWith(denial()), false)).decision).toBe("handoff");
  });
});

/**
 * A model that plays `script[i]` on its i-th tool-offered call and `answer`
 * when no tools are offered; records how many tools each call was offered.
 */
function scriptedModel(script: readonly TestTurn[], answer: TestTurn = { text: ANSWER }) {
  const tools = TestLLMService([...script]);
  const toolless = TestLLMService([answer]);
  const offered: number[] = [];
  // Usage grows 1,000 tokens a call so the low-delta guard never ends the run early.
  const grow = (stream: Stream.Stream<StreamEvent, LLMErrors>, call: number) =>
    Stream.map(stream, (ev): StreamEvent =>
      ev.type === "usage"
        ? { type: "usage", usage: { inputTokens: 1000 * call, outputTokens: 50, totalTokens: 1000 * call + 50, estimatedCost: 0 } }
        : ev,
    );
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...tools,
      complete: (req) => toolless.complete(req),
      stream: (req) => {
        const n = req.tools?.length ?? 0;
        offered.push(n);
        return (n === 0 ? toolless.stream(req) : tools.stream(req)).pipe(Effect.map((s) => grow(s, offered.length)));
      },
    }),
  );
  return { offered, layer };
}

const BUDGET = (maxIterations: number) => ({
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations, maxIterationsExplicit: true },
  },
});

const schemas = [
  { name: "web-search", description: "search the web", parameters: PARAMS },
  { name: "lookup", description: "re-read a gathered source", parameters: [{ name: "key", type: "string", required: true }] },
];

const evidenceTools = mockToolServiceLayer({
  execute: (req) => Effect.succeed({ success: true, result: req.toolName === "web-search" ? EVIDENCE : { key: "src-1", content: EVIDENCE } }),
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: PARAMS }),
});

const runDefault = (script: readonly TestTurn[], maxIterations: number, harness = {}) => {
  const llm = scriptedModel(script);
  return Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: TASK,
        taskType: "research",
        memoryContext: "",
        availableTools: schemas.map((s) => s.name),
        availableToolSchemas: schemas,
        config: BUDGET(maxIterations),
      } as never).pipe(Effect.provide(Layer.merge(llm.layer, evidenceTools))),
      buildRunEnvelope({ harness }),
    ),
  ).then((result) => ({ result, offered: llm.offered }));
};

describe("scripted reproduction of trace 01M7TERZAVP2RS489WEBJ3HY7H (default harness, no flag set)", () => {
  // Gather once, then keep re-reading the same source (no new evidence) to the cap.
  const reread: TestTurn[] = [
    { toolCall: { id: "s1", name: "web-search", args: { q: "ai agents news" } } },
    // Distinct keys, same content back: no guard ends the run early, so it runs to the cap.
    ...Array.from({ length: 12 }, (_, i): TestTurn => ({ toolCall: { id: `r${i}`, name: "lookup", args: { key: `src-${i}` } } })),
  ];

  it("the last call ships no tools and the run ends with the model's answer from the gathered results", async () => {
    const { result, offered } = await runDefault(reread, 5);
    expect(offered.at(-1)).toBe(0);
    expect(offered.slice(0, -1).every((n) => n > 0)).toBe(true);
    expect(result.status).not.toBe("failed");
    expect(String(result.output ?? "")).toContain(ANSWER);
  }, 20000);

  it("opt-out (harness budgetAnswerTurn: false): every call keeps its tools and the run fails answerless (the trace)", async () => {
    const { offered, result } = await runDefault(reread, 5, { budgetAnswerTurn: false });
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((n) => n > 0)).toBe(true);
    expect(result.status).toBe("failed");
    expect(String(result.output ?? "")).not.toContain(ANSWER);
  }, 20000);

  it("a run whose model already answered gets no extra turn", async () => {
    const { result, offered } = await runDefault(
      [{ toolCall: { id: "s1", name: "web-search", args: { q: "ai agents news" } } }, { text: ANSWER }],
      5,
    );
    expect(offered.every((n) => n > 0)).toBe(true);
    expect(offered.length).toBe(2);
    expect(String(result.output ?? "")).toContain(ANSWER);
  }, 20000);
});
