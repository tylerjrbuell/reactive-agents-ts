/**
 * reflect/environment-update.ts — one-shot "what changed since your last turn"
 * notice (inferred-progress-and-environment-updates plan, Part B items 2/4).
 *
 * The chat runtime renders the notice and hands it over as
 * `RunEnvelope.rails.environmentUpdate` (already capped, key absent when there
 * is nothing to say). This module owns the kernel half:
 *  - seed: the first think of a pass lifts it into `PendingGuidance` so it
 *    renders in the `Guidance:` block (never a stray USER message — pitfall #9);
 *  - once: a signal-ledger entry of kind `environment-update` marks it consumed,
 *    so later iterations (and resumed passes) never repeat it;
 *  - observable: `harness-signal-injected` (origin "environment-update") plus a
 *    rendered ledger signal so `signal-rendered` / `signal-effect` fire.
 * Deterministic (golden rule 5); no LLM.
 */
import { Effect } from "effect";
import { markRendered, openSignal, type SignalLedger } from "../../state/signal-ledger.js";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched.
declare module "../../state/kernel-state.js" {
  interface PendingGuidance {
    /** One-shot between-turn environment notice, rendered in the `Guidance:` block. */
    readonly environmentUpdate?: string;
  }
  interface KernelInput {
    /** Between-turn environment notice (from `RunEnvelope.rails.environmentUpdate`). */
    readonly environmentUpdate?: string;
  }
}

export const ENVIRONMENT_UPDATE_SIGNAL_KIND = "environment-update";

export interface EnvironmentUpdateStep {
  readonly notice?: string;
  readonly signalLedger?: SignalLedger;
}

/**
 * Think-time seeding. Returns the notice to render this turn (pending field
 * wins, else the input's notice if not yet consumed) and the updated signal
 * ledger. Inert (`{}`) once consumed or when there is no notice.
 */
export function stepEnvironmentUpdate(args: {
  readonly pending: string | undefined;
  readonly inputNotice: string | undefined;
  readonly signalLedger: SignalLedger | undefined;
  readonly taskId: string;
  readonly iteration: number;
  readonly stepCount: number;
  /**
   * True when the caller will NOT render the notice (e.g. plan posture replaces
   * the whole `Guidance:` block). The notice is still consumed (opened +
   * injected, never repeated) but is not stamped rendered: it never reached the model.
   */
  readonly suppressed?: boolean;
}): Effect.Effect<EnvironmentUpdateStep> {
  const signals = args.signalLedger ?? [];
  const consumed = signals.some((s) => s.signalKind === ENVIRONMENT_UPDATE_SIGNAL_KIND);
  const notice = args.pending ?? (consumed ? undefined : args.inputNotice);
  if (notice === undefined || notice.trim().length === 0 || consumed) return Effect.succeed({});
  const opened = openSignal(signals, {
    signalKind: ENVIRONMENT_UPDATE_SIGNAL_KIND,
    origin: "environment-update",
    target: { policy: "other" },
    iter: args.iteration,
    content: notice,
  });
  return emitHarnessSignalInjected({
    taskId: args.taskId,
    iteration: args.iteration,
    signalKind: "other",
    origin: "environment-update",
    content: notice,
    signalId: opened.signalId,
  }).pipe(
    Effect.as({
      notice,
      signalLedger: args.suppressed
        ? opened.ledger
        : markRendered(opened.ledger, opened.signalId, args.iteration, args.stepCount),
    } satisfies EnvironmentUpdateStep),
  );
}

/** Fold the notice into the rendered `Guidance:` block (identity when absent). */
export function appendEnvironmentUpdate(guidanceText: string | null, notice: string | undefined): string | null {
  if (!notice) return guidanceText;
  return guidanceText ? `${guidanceText}\n- ${notice}` : `Guidance:\n- ${notice}`;
}
