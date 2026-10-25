/**
 * signal-ledger.ts — pure, deterministic ledger for harness signals.
 *
 * Part of the signal consumption edge (2026-10-25): every harness signal
 * (steer, verdict redirect, guard redirect, completion-gap nudge, ...) gets a
 * stable `signalId` at open time, a render stamp when it actually enters the
 * model's prompt, and an effect classification on the following action. This
 * module owns the ledger's state transitions; it has NO Effect dependency and
 * NO LLM call — golden rule 5 (deterministic over LLM-driven).
 *
 * The ledger is carried on `KernelState.signalLedger` and persists with the
 * run (it rides crash-resume alongside the event log). All ops are immutable:
 * each returns a new ledger array; callers assign it back to state.
 */

/** Why a signal targets a tool — the family the effect classifier dispatches on. */
export type SignalTargetPolicy =
  | "denied-tool-retry"
  | "alternate-tool"
  | "synthesize"
  | "required-tool"
  | "other";

export interface SignalTarget {
  readonly tool?: string;
  readonly policy?: SignalTargetPolicy;
}

/** Lifecycle of a single signal. */
export type SignalLedgerState = "open" | "rendered" | "closed";

export type SignalEffectResponse =
  | "remediated"
  | "ignored"
  | "contradicted"
  | "ambiguous";

export interface SignalLedgerEntry {
  readonly signalId: string;
  readonly signalKind: string;
  readonly origin: string;
  readonly target?: SignalTarget;
  readonly openedIter: number;
  readonly content: string;
  readonly contentHash: string;
  state: SignalLedgerState;
  renderedIter?: number;
  effect?: SignalEffectResponse;
  observedTool?: string;
  observedSubject?: string;
  detail?: string;
}

export type SignalLedger = readonly SignalLedgerEntry[];

/** A pending-signal ref riding alongside a `PendingGuidance` field. */
export interface PendingSignalRef {
  readonly signalId: string;
  /** Which PendingGuidance field carries this signal's rendered text. */
  readonly field: keyof import("./kernel-state.js").PendingGuidance;
  readonly target?: SignalTarget;
}

/** Deterministic 8-char content hash (djb2) — used by the render stamp. */
export function contentHash(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

export interface OpenSignalArgs {
  readonly signalKind: string;
  readonly origin: string;
  readonly target?: SignalTarget;
  readonly iter: number;
  readonly content: string;
}

/** Open a new signal. Returns the new ledger (entry appended) and its id. */
export function openSignal(
  ledger: SignalLedger,
  args: OpenSignalArgs,
): { readonly ledger: SignalLedger; readonly signalId: string } {
  const id = `sig-${args.iter}-${ledger.length + 1}`;
  const entry: SignalLedgerEntry = {
    signalId: id,
    signalKind: args.signalKind,
    origin: args.origin,
    target: args.target,
    openedIter: args.iter,
    content: args.content,
    contentHash: contentHash(args.content),
    state: "open",
  };
  return { ledger: [...ledger, entry], signalId: id };
}

/** Generate the next signal id without opening (counter derived from ledger length). */
export function nextSignalId(ledger: SignalLedger, iter: number): string {
  return `sig-${iter}-${ledger.length + 1}`;
}

/** Mark a signal rendered. Idempotent: a second call on an already-rendered
 *  signal is a no-op (R-S2 budget: one SignalRendered per signal/run). */
export function markRendered(
  ledger: SignalLedger,
  signalId: string,
  renderedIter: number,
): SignalLedger {
  return ledger.map((e) => {
    if (e.signalId !== signalId) return e;
    if (e.state === "rendered" || e.state === "closed") return e;
    return { ...e, state: "rendered", renderedIter };
  });
}

/** Close a signal with an optional effect classification. */
export function closeSignal(
  ledger: SignalLedger,
  signalId: string,
  effect?: SignalEffectResponse,
  observed?: { observedTool?: string; observedSubject?: string; detail?: string },
): SignalLedger {
  return ledger.map((e) => {
    if (e.signalId !== signalId) return e;
    return {
      ...e,
      state: "closed",
      ...(effect !== undefined ? { effect } : {}),
      ...(observed?.observedTool !== undefined ? { observedTool: observed.observedTool } : {}),
      ...(observed?.observedSubject !== undefined ? { observedSubject: observed.observedSubject } : {}),
      ...(observed?.detail !== undefined ? { detail: observed.detail } : {}),
    };
  });
}

/** Convenience: open signals still awaiting render/effect. */
export function openSignals(ledger: SignalLedger): readonly SignalLedgerEntry[] {
  return ledger.filter((e) => e.state !== "closed");
}

/** Tally the ledger into the run-completed shape. */
export function tallySignals(ledger: SignalLedger): {
  opened: number;
  rendered: number;
  remediated: number;
  ignored: number;
  contradicted: number;
  ambiguous: number;
  unobserved: number;
} {
  let rendered = 0;
  let remediated = 0;
  let ignored = 0;
  let contradicted = 0;
  let ambiguous = 0;
  let unobserved = 0;
  for (const e of ledger) {
    if (e.state === "rendered" || e.state === "closed") {
      if (e.state === "rendered" && e.effect === undefined) {
        // rendered but never classified
        unobserved++;
      } else if (e.state === "closed") {
        if (e.effect === "remediated") remediated++;
        else if (e.effect === "ignored") ignored++;
        else if (e.effect === "contradicted") contradicted++;
        else if (e.effect === "ambiguous") ambiguous++;
        else unobserved++;
        if (e.renderedIter !== undefined) rendered++;
      }
    }
  }
  // rendered count = entries that were ever stamped
  rendered = ledger.filter((e) => e.renderedIter !== undefined).length;
  return {
    opened: ledger.length,
    rendered,
    remediated,
    ignored,
    contradicted,
    ambiguous,
    unobserved,
  };
}
