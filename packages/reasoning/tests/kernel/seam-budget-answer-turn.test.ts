// Run: bun test packages/reasoning/tests/kernel/seam-budget-answer-turn.test.ts --timeout 20000
//
// Cortex runs 01M743KQ5KKKQQ9998SQGW9V66 (reactive, max 10: 23 tool calls, no
// answer) and 01M7447E9X95FGRB3H2RW81EWY: the last think call the iteration
// budget allows went to another tool call, so the run ended "stopped
// (max_iterations) before the model wrote a final answer". With validated
// evidence in hand and only the answer outstanding, that last call is now the
// exit gate's answer turn (no tools). The model writes the answer; the harness
// never does.
//
// Two ways the last call becomes the answer turn:
//   - no guard fires: `reserveBudgetAnswerTurn` (turn-operations.ts `think`)
//     reserves it;
//   - a soft guard (stall, low-delta) proposes an exit at iteration max-1: the
//     gate's answer-turn deny-once fits there (`disposeExit` `answerOnly`),
//     because an answer turn never acts.
//
// RED-ON-CUT: drop the `reserveBudgetAnswerTurn` call in turn-operations.ts:
// (c) distinct-tools goes red. Set `answerOnly` to false in exit-gate.ts
// `proposeExit`: (c) repeated-tool goes red (the stall guard hands off, failed).
// Drop the `budgetAnswerTurnTaken` deferral in `proposeExit`: the deferral case
// goes red (an RI early stop in the answer-turn pass ended the run as
// `dispatcher_early_stop` → `guard_stop` instead of the cap's `max_iterations`).
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent, type TestTurn } from "@reactive-agents/llm-provider";
import { budgetAnswerTurnRecord, isLastThinkCall } from "../../src/kernel/loop/budget-answer-turn.js";
import { budgetAnswerTurnTaken, DISPATCHER_EARLY_STOP, proposeExit } from "../../src/kernel/loop/exit-gate.js";
import { EventBusLive, harnessSynthesisDeliverable } from "@reactive-agents/core";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { failingToolLayer, succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const TASK = "Look up the regional sales figures and tell me which region grew fastest.";
const EVIDENCE = "north=+14%; south=+9%; west=+6%";
const ANSWER = "The north region grew fastest last quarter, at 14%, ahead of the south (9%) and the west (6%).";
const PARAMS = [{ name: "q", type: "string", required: true }];
const schema = (name: string) => ({ name, description: `gather ${name} data`, parameters: PARAMS });

const gathered = [
  makeStep("action", "gather({})", { toolCall: { id: "g1", name: "gather", arguments: { q: "sales" } } }),
  makeStep("observation", EVIDENCE, { toolCallId: "g1", observationResult: makeObservationResult("gather", true, EVIDENCE) }),
];

const stateAt = (iteration: number, steps = gathered): KernelState =>
  makeKernelState({ status: "thinking", iteration, llmCalls: iteration, toolsUsed: new Set(["gather"]), steps } as never);

describe("budgetAnswerTurnRecord: when the last think call is reserved for the answer", () => {
  it("isLastThinkCall: the call at max-1 (either counter) is the last one", () => {
    expect(isLastThinkCall({ iteration: 9, llmCalls: 9 }, 10)).toBe(true);
    expect(isLastThinkCall({ iteration: 3, llmCalls: 9 }, 10)).toBe(true);
    expect(isLastThinkCall({ iteration: 8, llmCalls: 8 }, 10)).toBe(false);
  });

  it("reserves the last call when evidence exists and only the answer is outstanding", () => {
    const record = budgetAnswerTurnRecord(stateAt(9), makeKernelInput({ task: TASK }), 10);
    expect(record?.gateDecision).toBe("deny-once");
    expect(record?.answerTurnAt).toBe(9);
    expect(record?.outstanding.length).toBeGreaterThan(0);
  });

  it("does not reserve an earlier call", () => {
    expect(budgetAnswerTurnRecord(stateAt(8), makeKernelInput({ task: TASK }), 10)).toBeUndefined();
  });

  it("(d) does not reserve without validated evidence", () => {
    expect(budgetAnswerTurnRecord(stateAt(9, []), makeKernelInput({ task: TASK }), 10)).toBeUndefined();
  });

  it("does not reserve while a required tool is uncalled (the last call keeps its tools)", () => {
    const input = makeKernelInput({ task: TASK, requiredTools: ["file-write"] });
    expect(budgetAnswerTurnRecord(stateAt(9), input, 10)).toBeUndefined();
  });
});

describe("after the budget answer turn, only the cap ends the run", () => {
  const reserved = makeStep("harness_signal", "exit gate", {
    exitGate: { proposedBy: "max_iterations", gateDecision: "deny-once", reason: "max_iterations", outstanding: ["write the final answer"], answerTurnAt: 1 },
  });
  const afterAnswerTurn = makeKernelState({ status: "thinking", iteration: 1, llmCalls: 2, steps: [...gathered, reserved] } as never);
  const softExit = (state: KernelState) =>
    Effect.runPromise(
      proposeExit({
        state,
        proposal: { ...DISPATCHER_EARLY_STOP, deliverable: harnessSynthesisDeliverable([], undefined, "") },
        input: makeKernelInput({ task: TASK }),
        maxIterations: 2,
        taskId: "t",
      }).pipe(Effect.provide(EventBusLive)),
    );

  it("budgetAnswerTurnTaken: true once the reserved call was made and no call is left", () => {
    expect(budgetAnswerTurnTaken(afterAnswerTurn, 2)).toBe(true);
    expect(budgetAnswerTurnTaken(makeKernelState({ ...afterAnswerTurn, llmCalls: 1 } as never), 2)).toBe(false);
  });

  it("a soft guard (RI early stop) in that pass is deferred to the cap: the run stays non-terminal", async () => {
    const { decision, state } = await softExit(afterAnswerTurn);
    expect(decision).toBe("deny");
    expect(state.status).toBe("thinking");
    expect(state.steps.length).toBe(afterAnswerTurn.steps.length);
  });
});

/**
 * A model that calls `names[i]` on its i-th tool-offered call and answers only
 * when no tools are offered. Usage grows 1,000 tokens a call so the low-delta
 * guard never fires.
 */
function gatherUntilToolless(names: readonly string[]) {
  const toolTurns: TestTurn[] = names.map((name, i) => ({ toolCall: { id: `g-${i}`, name, args: { q: `q${i}` } } }));
  const tools = TestLLMService(toolTurns);
  const answer = TestLLMService([{ text: ANSWER }]);
  const offered: number[] = [];
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
      complete: (req) => answer.complete(req),
      stream: (req) => {
        const n = req.tools?.length ?? 0;
        offered.push(n);
        return (n === 0 ? answer.stream(req) : tools.stream(req)).pipe(Effect.map((s) => grow(s, offered.length)));
      },
    }),
  );
  return { offered, layer };
}

/** A run budget of 4 iterations, user-declared (so no tier hint overrides it). */
const BUDGET_4 = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 4, maxIterationsExplicit: true },
  },
};

const DISTINCT = ["gather_north", "gather_south", "gather_west", "gather_east", "gather_misc"];
const REPEATED = ["gather", "gather", "gather", "gather", "gather"];

const run = (names: readonly string[], toolLayer: ReturnType<typeof succeedingToolLayer>) => {
  const llm = gatherUntilToolless(names);
  const schemas = [...new Set(names)].map(schema);
  return Effect.runPromise(
    executeReactive({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: schemas.map((s) => s.name),
      availableToolSchemas: schemas,
      config: BUDGET_4,
    } as never).pipe(Effect.provide(Layer.merge(llm.layer, toolLayer)), provideTestEnvelope),
  ).then((result) => ({ result, offered: llm.offered }));
};

const evidenceLayer = () => succeedingToolLayer({ finding: EVIDENCE }, PARAMS);

describe("end to end: the run's last think call is the model's answer turn", () => {
  for (const [label, names] of [["distinct tools (reservation)", DISTINCT], ["repeated tool (stall guard at max-1)", REPEATED]] as const) {
    it(`(c) ${label}: the final call ships no tools and the model's text is the output`, async () => {
      const { result, offered } = await run(names, evidenceLayer());
      expect(offered.length).toBe(4);
      expect(offered.at(-1)).toBe(0);
      expect(offered.slice(0, -1).every((n) => n > 0)).toBe(true);
      expect(["completed", "partial"]).toContain(result.status);
      expect(String(result.output ?? "")).toContain(ANSWER);
    }, 20000);
  }

  it("(d) without evidence (every tool call failed): tools stay offered and the run fails honestly", async () => {
    const { result, offered } = await run(DISTINCT, failingToolLayer("upstream unavailable"));
    expect(offered.every((n) => n > 0)).toBe(true);
    expect(result.status).toBe("failed");
    expect(String(result.output ?? "")).not.toContain(ANSWER);
  }, 20000);
});
