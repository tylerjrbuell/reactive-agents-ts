/**
 * A refused call is not a prior call (evidence-wrong-output audit 2026-11-06, item A).
 *
 * Trace 01M6Q2W4XTCW (qwen3:4b, h3-todo-heavy): the tool gate refused a dozen
 * file-read/file-write calls across turns 0-1 (`deferred-required-batch`,
 * `required-first`). Each refusal is recorded as an action step plus a guard
 * observation. `repetitionGuard` counted those steps as calls, so the FIRST
 * real read of notes-3..6 (seq 1076-1100) was replaced by "You have already
 * called file-read 13 times" and never ran.
 *
 * The steps here are built with the production builders (`refusalSteps`,
 * `makeStep`), so the pin reads the same step shape the trace recorded.
 */
import { describe, it, expect } from "bun:test";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { repetitionGuard } from "../../../../src/kernel/capabilities/act/guard.js";
import { refusalSteps } from "../../../../src/kernel/capabilities/decide/tool-call-refusals.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../../src/kernel/utils/observation-helpers.js";
import { initialKernelState, type KernelState, type KernelInput } from "../../../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../../src/types/index.js";
import { withEvidence } from "../../tool-evidence-fixture.js";

const read = (id: string, path: string): ToolCallSpec => ({ id, name: "file-read", arguments: { path } });
const write = (id: string, path: string): ToolCallSpec => ({ id, name: "file-write", arguments: { path, content: "12" } });

/** An executed call: action + its tool observation. */
function ran(call: ToolCallSpec, result: string): ReasoningStep[] {
  return [
    makeStep("action", `${call.name}(${JSON.stringify(call.arguments)})`, { toolCall: call }),
    makeStep("observation", result, {
      toolCallId: call.id,
      observationResult: makeObservationResult(call.name, true, result),
    }),
  ];
}

function stateOf(steps: ReasoningStep[]): KernelState {
  return withEvidence({
    ...initialKernelState({ maxIterations: 10, strategy: "react-kernel", kernelType: "react", taskId: "refused-calls" }),
    steps,
  });
}

const input = { requiredToolQuantities: {}, nextMovesPlanning: { maxBatchSize: 4 } } as KernelInput;

/** Turns 0-1 of 01M6Q2W4XTCW: one read ran, every other read/write was refused. */
function traceShapeSteps(): ReasoningStep[] {
  const notes = [1, 2, 3, 4, 5, 6].map((n) => `notes-${n}.txt`);
  const outs = [1, 2, 3, 4, 5, 6].map((n) => `out-${n}.txt`);
  const turn0Refused = [
    ...notes.slice(1).map((p, i) => ({ call: read(`t0-r${i}`, p), kind: "required-first" as const, reason: "one batch of required-tool calls runs per turn." })),
    ...outs.map((p, i) => ({ call: write(`t0-w${i}`, p), kind: "required-first" as const, reason: "one batch of required-tool calls runs per turn." })),
  ];
  const turn1Refused = notes.slice(1).map((p, i) => ({
    call: read(`t1-r${i}`, p),
    kind: "required-first" as const,
    reason: "required tool(s) file-write are still missing, so only calls to them run this turn.",
  }));
  return [
    ...ran(read("t0-ran", notes[0]!), "value: 7"),
    ...refusalSteps(turn0Refused, 0),
    ...refusalSteps(turn1Refused, 1),
    ...refusalSteps(turn1Refused.map((r, i) => ({ ...r, call: read(`t2-r${i}`, r.call.arguments.path as string) })), 2),
  ];
}

describe("repetitionGuard — a tool-gate refusal is not a prior call (01M6Q2W4XTCW)", () => {
  it("the first real read of a target that was only ever refused executes", () => {
    // notes-2 then ran in turn 2, so the last file-read succeeded (no
    // converging-retry carve-out can let notes-3 through by accident).
    const steps = [...traceShapeSteps(), ...ran(read("t2-ran", "notes-2.txt"), "value: 9")];
    const outcome = repetitionGuard(read("t3-r", "notes-3.txt"), stateOf(steps), input);
    expect(outcome).toEqual({ pass: true });
  });

  it("the first real write of a target that was only ever refused executes", () => {
    const steps = [...traceShapeSteps(), ...ran(write("t3-w1", "out-1.txt"), "ok"), ...ran(write("t3-w2", "out-2.txt"), "ok")];
    const outcome = repetitionGuard(write("t3-w3", "out-1.txt"), stateOf(steps), input);
    // Two writes ran (the file-write ceiling) and out-1 is one of them: a
    // genuine repeat, still blocked. out-3 was only ever refused: it runs.
    expect(outcome.pass).toBe(false);
    const fresh = repetitionGuard(write("t3-w4", "out-3.txt"), stateOf(steps), input);
    expect(fresh).toEqual({ pass: true });
  });

  it("calls that ran still hit the ceiling: same target read past the batch ceiling is blocked", () => {
    const steps = [1, 2, 3, 4].flatMap((n) => ran(read(`ran-${n}`, "notes-1.txt"), `value ${n}`));
    const outcome = repetitionGuard(read("again", "notes-1.txt"), stateOf([...traceShapeSteps(), ...steps]), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) expect(outcome.observation).toContain("already called file-read 5 times");
  });
});
