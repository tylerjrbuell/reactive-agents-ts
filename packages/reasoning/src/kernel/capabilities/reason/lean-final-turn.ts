/**
 * Think phase — lean final turn (harness switch `leanFinalTurn`, default OFF).
 *
 * Golden-run diagnosis 2026-11-18 (wiki/Research/Harness-Reports/2026-11-18-extra-iterations):
 * the final-answer turn after the last write cost 26% of tokens and 34% of LLM
 * time, while still shipping every tool schema and a thinking chain. Once the
 * tool work is done, that turn only has to write the answer.
 *
 * A think call is a lean final turn when ALL of these hold (deterministic, read
 * from state the harness already computed, no LLM call):
 *  - the switch is on, native function calling, not plan posture;
 *  - the run contract DECLARED tool work: a requirement of a tool-work kind
 *    (`artifact-produced`, `tool-coverage`, `action-required`, `input-coverage`,
 *    `write-coverage`). A contract with only answer requirements never
 *    qualifies: there "nothing left" cannot be told from "nothing started";
 *  - that tool work is settled ({@link toolWorkSettled}, shared with the budget
 *    answer turn): validated tool evidence, no blocking contract item, no
 *    requested action undone;
 *  - no lean turn was taken since the last tool call (`leanFinalTurnAtActions`).
 *
 * Such a call ships with NO tools (the same withhold as the exit gate's answer
 * turn, so a stray tool call is refused, never run), `thinking: false`
 * (providers that support the switch turn reasoning off), and the think output
 * budget WITHOUT the thinking allowance (a bounded `maxTokens`; for a
 * non-thinking model the budget is unchanged). If the reply is not accepted as
 * the final answer, the next call has its tools again; another lean turn needs
 * another tool call first.
 *
 * Record: one `guard-fired` event per lean turn (`guard: "lean_final_turn"`,
 * outcome `redirect`, activity key `guard:lean_final_turn:redirect`).
 */
import { Effect } from "effect";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { transitionState, type KernelContext, type KernelState } from "../../state/kernel-state.js";
import type { PendingGuidance } from "../../state/guidance-channel.js";
import type { RequirementKind } from "../../contract/run-contract.js";
import { isPlanPosture } from "../../policy/run-posture.js";
import { toolWorkSettled } from "../../loop/budget-answer-turn.js";
import { guidanceForAnswerTurn } from "./answer-turn.js";

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched.
declare module "../../state/kernel-state.js" {
  interface KernelMeta {
    /** Lean final turn: the run's action-step count when the last lean turn was taken. */
    readonly leanFinalTurnAtActions?: number;
  }
}

/** Guard name on every lean-final-turn record. */
export const LEAN_FINAL_TURN_GUARD = "lean_final_turn";

/** The guidance line the lean turn renders (the turn has no tools). */
export const LEAN_FINAL_TURN_HINT =
  "The tool work this task needs is done, so tools are not available on this turn. Write the final answer now from the results you have.";

/** Contract requirement kinds that declare TOOL work (not answer shape). */
const TOOL_WORK_KINDS: ReadonlySet<RequirementKind> = new Set<RequirementKind>([
  "artifact-produced",
  "tool-coverage",
  "action-required",
  "input-coverage",
  "write-coverage",
]);

/** The deterministic facts {@link shouldTakeLeanFinalTurn} decides from. */
export interface LeanFinalTurnFacts {
  readonly enabled: boolean;
  readonly nativeFC: boolean;
  readonly planPosture: boolean;
  readonly declaresToolWork: boolean;
  readonly toolWorkSettled: boolean;
  readonly actions: number;
  readonly takenAtActions: number | undefined;
}

/** True when this think call is a lean final turn. Pure. */
export function shouldTakeLeanFinalTurn(t: LeanFinalTurnFacts): boolean {
  return (
    t.enabled &&
    t.nativeFC &&
    !t.planPosture &&
    t.declaresToolWork &&
    t.toolWorkSettled &&
    t.takenAtActions !== t.actions
  );
}

/**
 * The guidance a lean turn renders: the answer turn's allowlist (nothing that
 * steers toward a tool call), plus {@link LEAN_FINAL_TURN_HINT} when no gate
 * hint is already there.
 */
export function guidanceForLeanFinalTurn(g: PendingGuidance): PendingGuidance {
  return guidanceForAnswerTurn({ ...g, qualityGateHint: g.qualityGateHint ?? LEAN_FINAL_TURN_HINT });
}

/** What {@link decideLeanFinalTurn} returns: the state (stamped when taken) and the decision. */
export interface LeanFinalTurnDecision {
  readonly state: KernelState;
  readonly taken: boolean;
}

/**
 * Decide, before the call, whether this think call is a lean final turn. When
 * taken: stamps `meta.leanFinalTurnAtActions` and emits the guard record.
 * Cheap gates first: the contract check runs only when the switch is on.
 */
export function decideLeanFinalTurn(args: {
  readonly state: KernelState;
  readonly context: KernelContext;
  readonly enabled: boolean;
}): Effect.Effect<LeanFinalTurnDecision, never> {
  return Effect.gen(function* () {
    const { state, context } = args;
    const input = context.input;
    if (!args.enabled || context.toolCallingDriver.mode !== "native-fc" || isPlanPosture(input)) {
      return { state, taken: false };
    }
    const actions = state.steps.filter((s) => s.type === "action").length;
    const taken = shouldTakeLeanFinalTurn({
      enabled: true,
      nativeFC: true,
      planPosture: false,
      declaresToolWork: (state.meta.runContract?.requirements ?? []).some((r) => TOOL_WORK_KINDS.has(r.kind)),
      toolWorkSettled: toolWorkSettled(state, input) !== undefined,
      actions,
      takenAtActions: state.meta.leanFinalTurnAtActions,
    });
    if (!taken) return { state, taken: false };
    yield* emitGuardFired({
      taskId: state.taskId,
      iteration: state.iteration,
      guard: LEAN_FINAL_TURN_GUARD,
      outcome: "redirect",
      reason: "only-answer-outstanding",
      metadata: { tools: 0, thinking: false, actions },
    });
    return {
      state: transitionState(state, { meta: { ...state.meta, leanFinalTurnAtActions: actions } }),
      taken: true,
    };
  });
}
