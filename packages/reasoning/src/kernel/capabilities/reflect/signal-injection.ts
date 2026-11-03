/**
 * reflect/signal-injection.ts — the ONE way a harness signal is injected.
 *
 * Before this module each `emitHarnessSignalInjected` site either opened a
 * ledger entry by hand (4 sites) or emitted with a content-derived fallback
 * id that no `signal-rendered` / `signal-effect` event could ever pair with
 * (the census's 14-of-20 "untraceable" signals). `injectSignal` closes the
 * loop in one call: open the ledger entry, emit `harness-signal-injected`
 * with the LEDGER id, and (when the signal rides a `PendingGuidance` field)
 * hand back the `pendingSignals` list the caller must carry so think.ts can
 * stamp `signal-rendered` and classify the next act's effect.
 *
 * Deterministic (golden rule 5): ids come from `openSignal` (`sig-<iter>-<n>`),
 * no LLM, no clock.
 */
import { Effect } from "effect";
import { openSignal, type PendingSignalRef, type SignalTarget } from "../../state/signal-ledger.js";
import { transitionState, type KernelState, type PendingGuidance } from "../../state/kernel-state.js";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";

type InjectedSignalKind = Parameters<typeof emitHarnessSignalInjected>[0]["signalKind"];

export interface InjectSignalArgs {
  /** Defaults to `state.taskId`; runner seams pass `currentOptions.taskId ?? state.taskId`. */
  readonly taskId?: string;
  readonly signalKind: InjectedSignalKind;
  readonly origin: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
  readonly target?: SignalTarget;
  /**
   * The `PendingGuidance` field that carries this signal's text to the model.
   * Present ⇒ a pending ref is produced so the render stamp + effect pair up.
   * Absent ⇒ the signal is trace/step-only: it is ledgered and emitted but can
   * never be stamped rendered (honestly `unobserved`, not silently untracked).
   */
  readonly field?: keyof PendingGuidance;
}

export interface InjectedSignal {
  /** State with the opened ledger entry. `pendingGuidance` is NOT touched. */
  readonly state: KernelState;
  readonly signalId: string;
  /** Prior pending refs plus this signal's ref (when `field` was given). Carry onto the `pendingGuidance` you set. */
  readonly pendingSignals: readonly PendingSignalRef[];
}

/** Open a ledger entry and emit `harness-signal-injected` with its id. */
export function injectSignal(state: KernelState, args: InjectSignalArgs): Effect.Effect<InjectedSignal, never> {
  const opened = openSignal(state.signalLedger ?? [], {
    signalKind: args.signalKind,
    origin: args.origin,
    ...(args.target ? { target: args.target } : {}),
    iter: state.iteration,
    content: args.content,
  });
  const ref: PendingSignalRef | undefined =
    args.field !== undefined
      ? { signalId: opened.signalId, field: args.field, ...(args.target ? { target: args.target } : {}) }
      : undefined;
  const pendingSignals = [...(state.pendingGuidance?.pendingSignals ?? []), ...(ref ? [ref] : [])];
  return emitHarnessSignalInjected({
    taskId: args.taskId ?? state.taskId,
    iteration: state.iteration,
    signalKind: args.signalKind,
    origin: args.origin,
    content: args.content,
    signalId: opened.signalId,
    ...(args.target?.tool !== undefined ? { targetTool: args.target.tool } : {}),
    ...(args.target?.policy !== undefined ? { targetPolicy: args.target.policy } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
  }).pipe(
    Effect.as({
      state: transitionState(state, { signalLedger: opened.ledger }),
      signalId: opened.signalId,
      pendingSignals,
    } satisfies InjectedSignal),
  );
}

/**
 * Effect-classifier target for a tool-failure recovery steer: an offered
 * alternative when one exists, else a retry of the failed tool. The tool name
 * is REQUIRED by `classifySignalEffect` for both policies — without it the
 * effect degrades to ambiguous/ignored regardless of what the model did.
 */
export function recoveryTarget(recovery: {
  readonly failedUnresolved: readonly string[];
  readonly alternativeCandidates: readonly string[];
  readonly policyBlocked?: readonly string[];
}): SignalTarget {
  // A policy refusal never names an alternate (recovery-steering fix B): the
  // steer asks for a retry of the SAME tool, so that is what to classify.
  const blocked = recovery.policyBlocked?.[0];
  if (blocked !== undefined) return { policy: "denied-tool-retry", tool: blocked };
  const alternate = recovery.alternativeCandidates[0];
  if (alternate !== undefined) return { policy: "alternate-tool", tool: alternate };
  const failed = recovery.failedUnresolved[0];
  return failed !== undefined ? { policy: "denied-tool-retry", tool: failed } : { policy: "other" };
}

/** Effect-classifier target for a missing-required-tool nudge (first missing tool). */
export function requiredToolTarget(missing: readonly string[]): SignalTarget {
  const tool = missing[0];
  return tool !== undefined ? { policy: "required-tool", tool } : { policy: "other" };
}
