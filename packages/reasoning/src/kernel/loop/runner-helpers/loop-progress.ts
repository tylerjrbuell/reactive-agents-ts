/**
 * runner-helpers/loop-progress.ts — progress-aware loop resolution (Plan 9 item
 * 2f, lift-gated: OFF by default).
 *
 * Loop pattern (a) fires on N identical consecutive tool calls. On a local tier
 * N is 2, so one stutter (re-reading the file just read) is a loop verdict. The
 * first verdict in a run is denied once by the exit gate; the second ends the
 * run. Targeted H3 at 94f0c9ea5 (cogito:8b h3-todo-heavy, runs 1/3/4): each run
 * stuttered once per file, and each SECOND verdict ended the run with 3-5 of 6
 * files written. A write had landed between the two verdicts every time.
 *
 * The rule: a pattern-(a) verdict with new progress since the previous loop
 * verdict redirects (names the outstanding work, the run continues) instead of
 * proposing an exit. A repeat with no progress in between resolves as today.
 * The first verdict in a run has no previous verdict, so it is unchanged.
 *
 * Progress is read from the RunLedger, not step text: an `artifact` entry, or
 * an executed tool result the progress arbiter classifies as substantive (a
 * guard's duplicate note is harness-authored, a tool-gate refusal never ran,
 * META tools and no-op results do not count).
 */
import { Effect } from "effect";
import { makeStep } from "../../capabilities/sense/step-utils.js";
import { authorityOf } from "../../capabilities/decide/authority.js";
import { classifyToolResult } from "../../assessment/progress-arbiter.js";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { transitionState, type KernelState } from "../../state/kernel-state.js";
import { contributeGuidance } from "../../state/guidance-channel.js";
import type { ReasoningStep } from "../../../types/index.js";
import type { LedgerEntry } from "../../ledger/run-ledger.js";

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

/** Does this ledger fact count as progress (new artifact or substantive tool evidence)? */
function isProgressEntry(e: LedgerEntry): boolean {
  if (e.kind === "artifact") return true;
  if (e.kind !== "tool-result" || e.refused === true) return false;
  return classifyToolResult(e.toolName, e.success, e.preview, e.harnessAuthored === true).kind === "substantive";
}

/**
 * True when a previous loop verdict exists and the ledger recorded progress
 * after it. False with no previous verdict, or when the verdict's step is not
 * in the ledger (nothing to measure from: resolve as today).
 */
export function progressSinceLastLoopVerdict(state: KernelState): boolean {
  let markerId: string | undefined;
  for (let i = state.steps.length - 1; i >= 0; i--) {
    if (isLoopVerdictStep(state.steps[i]!)) {
      markerId = state.steps[i]!.id;
      break;
    }
  }
  if (markerId === undefined) return false;
  const ledger = state.ledger ?? [];
  let at = -1;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i]!;
    if (e.kind === "harness-signal" && e.stepId === markerId) {
      at = i;
      break;
    }
  }
  if (at < 0) return false;
  return ledger.slice(at + 1).some(isProgressEntry);
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
