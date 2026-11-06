// Run: bun test packages/reasoning/src/kernel/loop/runner-helpers/loop-progress.test.ts --timeout 20000
//
// Plan 9 item 2f — progress-aware loop resolution (lift-gated, default OFF).
// Live shape (targeted H3 at 94f0c9ea5, cogito:8b h3-todo-heavy runs 1/3/4):
// read(n2), read(n2) [dup] → verdict 1 (gate denies once) → write(out-2) lands
// → read(n3), read(n3) [dup] → verdict 2 ended the run with files unwritten.
// With the switch ON, verdict 2 redirects because progress landed since
// verdict 1. A repeat with no progress in between still ends the run.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeStep } from "../../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { artifactProduced } from "../../capabilities/verify/post-conditions.js";
import { GUARD_OBSERVATION_TAG } from "../../state/kernel-constants.js";
import { initialKernelState, transitionState, type KernelState } from "../../state/kernel-state.js";
import { appendEntry } from "../../ledger/run-ledger.js";
import { resolveHarnessConfig } from "../../../harness-config.js";
import { makeKernelInput, makeKernelRunOptions } from "../../../testing/kernel-fixtures.js";
import type { ReasoningStep } from "../../../types/index.js";
import type { LoopDetection } from "../../capabilities/reflect/loop-detector.js";
import { resolveDetectedLoop } from "./loop-resolution.js";
import { isExitDenial, proposeGuardExit } from "../exit-gate.js";
import { assembleDeliverable } from "./deliverable.js";
import { LOOP_PROGRESS_ACTOR, loopProgressAwareEnabled, progressSinceLastLoopVerdict } from "./loop-progress.js";

const LOOP_MSG = "Loop detected: same tool call repeated 2 times";
const DETECTION_A: LoopDetection = { message: LOOP_MSG, pattern: { id: "a", name: "repeated-tool-call" } };
const DETECTION_D: LoopDetection = { message: LOOP_MSG, pattern: { id: "d", name: "no-new-evidence" } };

let n = 0;
const call = (
  name: string,
  args: Record<string, unknown>,
  out: string,
  opts: { dup?: boolean; failed?: boolean } = {},
): ReasoningStep[] => {
  const id = `c${++n}`;
  return [
    makeStep("action", `${name}(${JSON.stringify(args)})`, { toolCall: { id, name, arguments: args } }),
    makeStep("observation", out, {
      toolCallId: id,
      ...(opts.dup ? { frameworkInstrumentation: GUARD_OBSERVATION_TAG } : {}),
      observationResult: makeObservationResult(name, opts.failed !== true, out),
    }),
  ];
};
const read = (p: string, dup = false) =>
  call("file-read", { path: p }, dup ? "42 [Already done — do NOT repeat.]" : `value of ${p}`, { dup });
const write = (p: string) => call("file-write", { path: p, content: "x" }, `✓ Written to ${p}`);

const options = makeKernelRunOptions({ strategy: "reactive", maxIterations: 14 });
const OUTPUTS = ["./out-1.txt", "./out-2.txt", "./out-3.txt", "./out-4.txt"];
const harnessOn = { ...resolveHarnessConfig(), loopProgressAware: true };
const inputOn = makeKernelInput({ task: "Read notes-1..4 and write out-1..4.", harness: harnessOn });
const inputOff = makeKernelInput({ task: "Read notes-1..4 and write out-1..4." });

const add = (state: KernelState, steps: ReasoningStep[], iteration: number, artifactPath?: string): KernelState =>
  transitionState(state, {
    iteration,
    steps: [...state.steps, ...steps],
    ...(artifactPath !== undefined
      ? { ledger: appendEntry(state.ledger, { kind: "artifact", iteration, path: artifactPath, op: "write" }) }
      : {}),
  });

const resolve = (state: KernelState, input = inputOn, detection: LoopDetection = DETECTION_A) =>
  Effect.runPromise(
    resolveDetectedLoop({
      state, currentInput: input, currentOptions: options, loopMsg: LOOP_MSG, detection,
      failureRecoveryRedirects: 0, requiredToolNudgeCount: 0,
      maxFailureRecoveryRedirects: 2, maxRequiredToolNudges: 2, emitLog: () => Effect.void,
    }),
  );

/** read(n1), write(out-1), read(n2), read(n2)[dup] → verdict 1 (denied once by the gate). */
async function afterFirstVerdict(input = inputOn) {
  const base = initialKernelState(options);
  let s = transitionState(base, { meta: { ...base.meta, postConditions: OUTPUTS.map(artifactProduced) } });
  s = add(s, read("notes-1.txt"), 1);
  s = add(s, write("out-1.txt"), 2, "out-1.txt");
  s = add(s, [...read("notes-2.txt"), ...read("notes-2.txt", true)], 4);
  const first = await resolve(s, input);
  expect(first.outcome).toBe("next");
  expect(first.state.steps.some((st) => st.metadata?.exitGate?.gateDecision === "deny-once")).toBe(true);
  return first.state;
}

describe("progress-aware loop resolution (switch ON)", () => {
  it("a second pattern-(a) verdict after a write landed redirects instead of ending the run", async () => {
    let s = await afterFirstVerdict();
    s = add(s, write("out-2.txt"), 5, "out-2.txt");
    s = add(s, [...read("notes-3.txt"), ...read("notes-3.txt", true)], 7);
    expect(progressSinceLastLoopVerdict(s)).toBe(true);
    const second = await resolve(s);
    expect(second.outcome).toBe("next");
    expect(second.state.status).toBe("thinking");
    const redirect = second.state.steps.at(-1)!;
    expect(redirect.metadata?.intervention?.actor).toBe(LOOP_PROGRESS_ACTOR);
    expect(redirect.content).toContain("out-3.txt");
    expect(redirect.content).toContain("out-4.txt");
    expect(second.state.pendingGuidance?.errorRecovery).toContain("Still outstanding:");
  });

  it("a repeat with NO progress since the previous verdict still ends the run", async () => {
    let s = await afterFirstVerdict();
    s = add(s, read("notes-2.txt", true), 5); // same dup again, nothing landed
    expect(progressSinceLastLoopVerdict(s)).toBe(false);
    const second = await resolve(s);
    expect(second.outcome).toBe("break");
  });

  it("measures from the LAST verdict: progress before the redirect does not carry over", async () => {
    let s = await afterFirstVerdict();
    s = add(s, write("out-2.txt"), 5, "out-2.txt");
    s = add(s, [...read("notes-3.txt"), ...read("notes-3.txt", true)], 7);
    const second = await resolve(s);
    expect(second.outcome).toBe("next");
    const third = await resolve(add(second.state, read("notes-3.txt", true), 8));
    expect(third.outcome).toBe("break");
  });

  it("only pattern (a) is progress-aware", async () => {
    let s = await afterFirstVerdict();
    s = add(s, write("out-2.txt"), 5, "out-2.txt");
    s = add(s, [...read("notes-3.txt"), ...read("notes-3.txt", true)], 7);
    expect((await resolve(s, inputOn, DETECTION_D)).outcome).toBe("break");
  });

  it("the first verdict in a run has no previous verdict: unchanged", () => {
    let s = initialKernelState(options);
    s = add(s, [...write("out-1.txt"), ...read("notes-2.txt"), ...read("notes-2.txt", true)], 3, "out-1.txt");
    expect(progressSinceLastLoopVerdict(s)).toBe(false);
  });

  it("a duplicate note, a failed call or a META call is not progress", async () => {
    let s = await afterFirstVerdict();
    s = add(s, [
      ...read("notes-2.txt", true),
      ...call("brief", {}, "tools: 3 available"),
      ...call("file-read", { path: "missing.txt" }, "ENOENT", { failed: true }),
    ], 5);
    expect(progressSinceLastLoopVerdict(s)).toBe(false);
  });
});

// Task #43 (2026-11-06). The 2f ablation (wiki/Research/Ablations/2026-11-05-
// loop-progress-aware) read every first loop verdict as run-ending. The traces
// say otherwise: the `loop_resolution` guard-fired event (outcome "terminate")
// was emitted BEFORE the gate disposed, and the gate denied every one of them.
// (Since 2026-11-06 the gate emits it with an outcome from its decision.)
// What ends the run is the NEXT soft exit of ANY guard, because the deny-once
// nudge is one per run, shared by all guards. 2f only changes a second LOOP
// verdict, so it cannot act when the next exit is a stall guard, or when a
// stall guard spent the nudge before the first loop verdict.
describe("the gate's one nudge is shared by all guards (where 2f can act)", () => {
  const stall = (state: KernelState, input = inputOn) =>
    Effect.runPromise(
      proposeGuardExit(state, "stall_deliverable", "harness_deliverable", assembleDeliverable(state), input, options),
    );

  it("trace cogito a1 lh-debug-green run2: loop (a) is denied once, the next stall exit hands off", async () => {
    // iter 6: loop_resolution pattern a -> exit_gate deny-once (run continues).
    let s = await afterFirstVerdict();
    expect(s.status).toBe("thinking");
    // iter 7: a write landed (progress), then stall_deliverable proposes -> handoff.
    s = add(s, write("out-2.txt"), 5, "out-2.txt");
    // (The live run had validated evidence, so it was `handoff`; this fixture
    // has none, so the gate lets the exit stand as `accept`. Either way: ended.)
    const ended = await stall(s);
    expect(isExitDenial(ended.decision)).toBe(false);
    expect(["done", "failed"]).toContain(ended.state.status);
  });

  it("trace cogito a0 lh-pipeline-stages run1: a stall nudge first, so the FIRST loop verdict ends the run, 2f on", async () => {
    const base = initialKernelState(options);
    let s = transitionState(base, { meta: { ...base.meta, postConditions: OUTPUTS.map(artifactProduced) } });
    s = add(s, read("notes-1.txt"), 1);
    const nudged = await stall(s);
    expect(nudged.decision).toBe("deny-once");
    s = add(nudged.state, write("out-1.txt"), 2, "out-1.txt");
    s = add(s, [...read("notes-2.txt"), ...read("notes-2.txt", true)], 4);
    // Progress landed, but there is no previous LOOP verdict to measure from.
    expect(progressSinceLastLoopVerdict(s)).toBe(false);
    const first = await resolve(s);
    expect(first.outcome).toBe("break");
    expect(isExitDenial(first.exit!.decision)).toBe(false);
    expect(first.state.steps.some((st) => st.metadata?.intervention?.actor === LOOP_PROGRESS_ACTOR)).toBe(false);
  });
});

describe("progress-aware loop resolution (switch OFF = current behavior)", () => {
  it("is off by default and when the field is absent", () => {
    expect(loopProgressAwareEnabled(undefined)).toBe(false);
    expect(loopProgressAwareEnabled(resolveHarnessConfig())).toBe(false);
    expect(loopProgressAwareEnabled(harnessOn)).toBe(true);
  });

  it("the second verdict ends the run even after a write landed", async () => {
    let s = await afterFirstVerdict(inputOff);
    s = add(s, write("out-2.txt"), 5, "out-2.txt");
    s = add(s, [...read("notes-3.txt"), ...read("notes-3.txt", true)], 7);
    const second = await resolve(s, inputOff);
    expect(second.outcome).toBe("break");
  });
});
