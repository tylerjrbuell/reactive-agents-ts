// Run: bun test packages/reasoning/tests/kernel/seam-resume-answer-turn.test.ts --timeout 20000
//
// Gate attempt 5, B5 (2026-11-19; runtime resume-iteration-cap.test.ts): a run
// that spent its iteration cap with the budget answer turn on (default) was
// resumed with a raised cap and made ZERO tool calls. Tools were offered again;
// two pieces of the stopped run's budget ended the resumed run on its first
// pass (kernel/state/resume-epoch.ts):
//   1. the low-delta streak carried over, so `low_delta_guard` fired before the
//      first resumed tool call ran;
//   2. the spent cap's answer-turn reservation counted as the run's one exit
//      denial and its one answer turn, so a later soft guard handed off with no
//      answer turn under the raised cap.
//
// RED-ON-CUT (measured 2026-11-19): make `resetResumedStreaks`
// (assessment/guard-adapters.ts) return `state` unchanged: the end-to-end case
// goes red (the resumed tool call never runs). Pass `state.steps` instead of
// `gateHistory(...)` in exit-gate.ts `proposeExit`: the end-to-end case goes
// red (the guard hands off; the last call still carried tools, no answer turn).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMService, type TestTurn } from "@reactive-agents/llm-provider";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { gateHistory, isSpentCapReservation } from "../../src/kernel/state/resume-epoch.js";
import { resetResumedStreaks } from "../../src/kernel/assessment/guard-adapters.js";
import { deserializeKernelState, serializeKernelState } from "../../src/kernel/state/kernel-codec.js";
import { transitionState, type KernelInput } from "../../src/kernel/state/kernel-state.js";
import { gateStep } from "../../src/kernel/loop/exit-gate.js";
import { makeKernelInput, makeKernelRunOptions, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";

const TASK = "Look up the regional sales figures and tell me which region grew fastest.";
const ANSWER = "The north region grew fastest last quarter, at 14%, ahead of the south (9%) and the west (6%).";
const PARAMS = [{ name: "q", type: "string", required: true }];
const SCHEMAS = [{ name: "gather", description: "gather sales data", parameters: PARAMS }];
const gatherCall = (q: string): TestTurn => ({ toolCall: { name: "gather", args: { q } } });

const reservation = (answerTurnAt: number, iteration: number) =>
  gateStep(
    { proposedBy: "max_iterations", gateDecision: "deny-once", reason: "max_iterations", outstanding: ["write the final answer"], answerTurnAt },
    iteration,
  );

describe("resume-epoch helpers", () => {
  it("resetResumedStreaks: a resume restarts the low-delta streak; a fresh run keeps it", () => {
    const state = makeKernelState({ consecutiveLowDeltaCount: 3 });
    expect(resetResumedStreaks(state, {}).consecutiveLowDeltaCount).toBe(3);
    expect(resetResumedStreaks(state, { resumeState: state }).consecutiveLowDeltaCount).toBe(0);
    const zero = makeKernelState({ consecutiveLowDeltaCount: 0 });
    expect(resetResumedStreaks(zero, { resumeState: zero })).toBe(zero);
  });

  it("isSpentCapReservation: only a max_iterations reservation the current cap has outgrown", () => {
    // Reserved at llmCalls 2 / iteration 2 under cap 3: the last call there, not under cap 9.
    expect(isSpentCapReservation(reservation(2, 2), 3)).toBe(false);
    expect(isSpentCapReservation(reservation(2, 2), 9)).toBe(true);
    // Reserved via the iteration counter (iteration max-1): still current.
    expect(isSpentCapReservation(reservation(1, 8), 9)).toBe(false);
    // A guard's answer-turn denial is not a budget reservation.
    const guardDenial = gateStep(
      { proposedBy: "low_delta_guard", gateDecision: "deny-once", reason: "low_delta_guard", outstanding: ["x"], answerTurnAt: 2 },
      2,
    );
    expect(isSpentCapReservation(guardDenial, 9)).toBe(false);
  });

  it("gateHistory drops spent-cap reservations only, and returns steps by identity when there is none", () => {
    const steps = [reservation(2, 2)];
    expect(gateHistory(steps, 3)).toBe(steps);
    expect(gateHistory(steps, 9)).toEqual([]);
  });
});

/** A model that takes `toolTurns` on tool-offered calls and `answerTurns` on tool-less calls; records tools offered per call. */
function scriptedModel(toolTurns: readonly TestTurn[], answerTurns: readonly TestTurn[]) {
  const tools = TestLLMService([...toolTurns]);
  const answer = TestLLMService([...answerTurns]);
  const offered: number[] = [];
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...tools,
      complete: (req) => answer.complete(req),
      stream: (req) => {
        const n = req.tools?.length ?? 0;
        offered.push(n);
        return n === 0 ? answer.stream(req) : tools.stream(req);
      },
    }),
  );
  return { offered, layer };
}

const countingTools = () => {
  const executed: string[] = [];
  const layer = mockToolServiceLayer({
    execute: (req: { toolName: string }) =>
      Effect.sync(() => {
        executed.push(req.toolName);
        return { success: true, result: { finding: `north=+14%; south=+9%; west=+6% (call ${executed.length})` } };
      }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: PARAMS }),
  });
  return { executed, layer };
};

const input = (overrides: Partial<KernelInput> = {}): KernelInput =>
  makeKernelInput({ task: TASK, availableToolSchemas: SCHEMAS, harness: resolveHarnessConfig({ budgetAnswerTurn: true }), ...overrides } as never);

describe("end to end: a run that spent its cap on the budget answer turn resumes with its tools and its own answer turn", () => {
  it("the first resumed call is offered tools and its tool runs; a later guard stop gets the resumed budget's answer turn", async () => {
    // Run 1: cap 3. Two gathers; the third (last) call is the reserved answer
    // turn, and the model calls a tool on it anyway (refused): the run ends at the cap.
    const first = countingTools();
    const firstModel = scriptedModel([gatherCall("a"), gatherCall("b")], [gatherCall("c")]);
    const firstRun = await Effect.runPromise(
      runPass(reactKernel, input(), makeKernelRunOptions({ maxIterations: 3, taskId: "resume-answer-turn" })).pipe(
        Effect.provide(Layer.mergeAll(firstModel.layer, first.layer, EventBusLive)),
      ),
    );
    expect(first.executed).toEqual(["gather", "gather"]);
    expect(firstModel.offered).toEqual([1, 1, 0]); // the last call was the answer turn
    expect(firstRun.state.status).toBe("failed");
    // The spent run's codec round trip (the durable checkpoint the runtime resumes from).
    const restored = deserializeKernelState(serializeKernelState(firstRun.state));
    expect(restored.steps.some((s) => s.metadata?.exitGate?.answerTurnAt !== undefined)).toBe(true);
    expect(restored.consecutiveLowDeltaCount ?? 0).toBeGreaterThanOrEqual(2);

    // Run 2: resume with a raised cap of 9 (the runtime's resumeRun does this).
    const second = countingTools();
    const secondModel = scriptedModel([gatherCall("d"), gatherCall("e"), gatherCall("f")], [{ text: ANSWER }]);
    const resumed = await Effect.runPromise(
      runPass(
        reactKernel,
        input({ resumeState: transitionState(restored, { status: "thinking" }) }),
        makeKernelRunOptions({ maxIterations: 9, taskId: "resume-answer-turn" }),
      ).pipe(Effect.provide(Layer.mergeAll(secondModel.layer, second.layer, EventBusLive))),
    );
    // Tools are back on the first resumed call, and its call runs.
    expect(secondModel.offered[0]).toBeGreaterThan(0);
    expect(second.executed.length).toBeGreaterThanOrEqual(1);
    // The resumed budget's own answer turn: a tool-less call whose text is the output.
    expect(secondModel.offered.at(-1)).toBe(0);
    expect(resumed.state.status).toBe("done");
    expect(resumed.state.output ?? "").toContain("north region grew fastest");
  });
});
