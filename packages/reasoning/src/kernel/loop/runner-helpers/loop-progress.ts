/**
 * runner-helpers/loop-progress.ts — progress-aware loop resolution (Plan 9 item
 * 2f, lift-gated: OFF by default).
 *
 * Loop pattern (a) fires on N identical consecutive tool calls. On a local tier
 * N is 2, so one stutter (re-reading the file just read) is a loop verdict.
 * Each verdict proposes an exit to the gate (`../exit-gate.ts`). The gate's
 * deny-once nudge is ONE per run, shared by every soft guard: the first soft
 * exit of any guard (loop, stall, low-delta, ...) is denied, and the next one
 * ends the run. So the first loop verdict is denied only when no other guard
 * spent the nudge first. Targeted H3 at 94f0c9ea5 (cogito:8b h3-todo-heavy,
 * runs 1/3/4): each run stuttered once per file, and each SECOND loop verdict
 * ended the run with 3-5 of 6 files written. A write had landed between the two
 * verdicts every time.
 *
 * The rule: a pattern-(a) verdict with new progress since the previous loop
 * verdict redirects (names the outstanding work, the run continues) instead of
 * proposing an exit. A repeat with no progress in between resolves as today.
 * The first loop verdict in a run has no previous verdict, so it is unchanged.
 *
 * Reach (task #43, 2026-11-06): 2f changes only a SECOND loop verdict. It does
 * not act when the exit after a denied loop verdict comes from another guard
 * (2f ablation, cogito a1 lh-debug-green run2: loop deny-once at iteration 6,
 * stall_deliverable handoff at iteration 7), nor when another guard spent the
 * nudge before the first loop verdict. Traces before 2026-11-06 carry the
 * `loop_resolution` guard-fired event with outcome "terminate" emitted BEFORE
 * the gate disposed; since then the gate emits it with an outcome from its
 * decision. Either way the `exit_gate` event's `gateDecision` is what happened.
 *
 * Progress is read from the RunLedger, not step text: an `artifact` entry, or
 * an executed tool result the progress arbiter classifies as substantive (a
 * guard's duplicate note is harness-authored, a tool-gate refusal never ran,
 * META tools and no-op results do not count).
 */
import { Effect } from "effect";
import { makeStep } from "../../capabilities/sense/step-utils.js";
import { authorityOf } from "../../capabilities/decide/authority.js";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { transitionState, type KernelState } from "../../state/kernel-state.js";
import { contributeGuidance } from "../../state/guidance-channel.js";
import type { ReasoningStep } from "../../../types/index.js";
import { ledgerProgressAfterStep } from "../progress-exit-grant.js";

/** Intervention actor of the redirect step this module appends. */
export const LOOP_PROGRESS_ACTOR = "loop-progress";

/**
 * The harness switch (`HarnessConfig.loopProgressAware`, `.withHarness({ loopProgressAware })`).
 * Read structurally so a harness object without the field reads OFF.
 */
export function loopProgressAwareEnabled(harness: object | undefined): boolean {
  return harness !== undefined && "loopProgressAware" in harness && harness.loopProgressAware === true;
}

/** A step that records a loop verdict: the exit gate's loop record, or a loop redirect/nudge. */
function isLoopVerdictStep(step: ReasoningStep): boolean {
  if (step.metadata?.exitGate?.proposedBy === "loop_resolution") return true;
  const actor = step.metadata?.intervention?.actor;
  return actor === LOOP_PROGRESS_ACTOR || actor === "loop-missing-tools";
}

/**
 * True when a previous loop verdict exists and the ledger recorded progress
 * after it. False with no previous verdict, or when the verdict's step is not
 * in the ledger (nothing to measure from: resolve as today). The progress
 * measure is shared with the gate's progress grant (`../progress-exit-grant.ts`).
 */
export function progressSinceLastLoopVerdict(state: KernelState): boolean {
  for (let i = state.steps.length - 1; i >= 0; i--) {
    if (isLoopVerdictStep(state.steps[i]!)) return ledgerProgressAfterStep(state, state.steps[i]!.id);
  }
  return false;
}

/**
 * Redirect a repeat that came after progress: append a `loop-progress` step
 * naming the outstanding work and keep the run going. `outstanding` must be
 * non-empty (with nothing outstanding the caller resolves as today).
 */
export function redirectRepeatAfterProgress(args: {
  readonly state: KernelState;
  readonly taskId: string;
  readonly outstanding: readonly string[];
  readonly loopMeta: Readonly<Record<string, unknown>>;
}): Effect.Effect<KernelState, never, never> {
  return Effect.gen(function* () {
    const { state, outstanding } = args;
    yield* emitGuardFired({
      taskId: args.taskId,
      iteration: state.iteration,
      guard: "loop_resolution",
      outcome: "block",
      reason: "progress_since_last_loop",
      metadata: { trigger: "repeat_after_progress", outstanding, ...args.loopMeta },
    });
    const guidance =
      "You repeated an identical tool call; its result is already above, so do not make it again. " +
      `Work has landed since the last loop warning, so the run continues. Still outstanding:\n` +
      outstanding.map((o) => `- ${o}`).join("\n") +
      "\nDo the next outstanding item now.";
    return transitionState(state, {
      status: "thinking",
      steps: [
        ...state.steps,
        makeStep("harness_signal", `⚠️ ${guidance}`, {
          intervention: {
            actor: LOOP_PROGRESS_ACTOR,
            authorityClass: authorityOf(LOOP_PROGRESS_ACTOR),
            evidence: `identical repeat after new ledger progress; outstanding: ${outstanding.join("; ")}`.slice(0, 200),
            whatChanged: "loop-progress: redirected a repeat that followed progress instead of ending the run",
            iter: state.iteration,
          },
        }),
      ],
      pendingGuidance: contributeGuidance(state.pendingGuidance, [{ kind: "errorRecovery", text: guidance }]),
      error: null,
    });
  });
}
