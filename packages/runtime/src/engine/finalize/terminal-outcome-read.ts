/**
 * Plan 8 K1 reader: the kernel's reconciled `TerminalOutcome` rides the
 * strategy result as `metadata.extensions.terminalOutcome` (an opaque
 * `unknown` slot). This is the single validated read of that slot, shared by
 * the success derivation (veto) and run finalization (trace publish) so the
 * two cannot disagree about what was supplied.
 */
import type { AgentEvent } from "@reactive-agents/core";

/** The reconciled outcome, as carried on `AgentCompleted.outcome`. */
export type ReconciledOutcome = NonNullable<
  Extract<AgentEvent, { _tag: "AgentCompleted" }>["outcome"]
>;

const STATUSES: readonly string[] = ["completed", "partial", "abstained", "failed"];
const PROVENANCES: readonly string[] = ["model-final", "synthesized", "tool-artifact", "sentinel", "none"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isStringArray = (v: unknown): v is readonly string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Validated read of the additive optional outcome fields (deliverable decision,
 * verifier verdict, outstanding ids, errorClass, finalStatus). A malformed
 * field is DROPPED (never throws, never fabricates) without voiding the outcome.
 */
function readOptionalOutcomeFields(raw: Record<string, unknown>): Partial<ReconciledOutcome> {
  const out: { -readonly [K in keyof ReconciledOutcome]?: ReconciledOutcome[K] } = {};
  const d = raw.deliverable;
  if (d === null) out.deliverable = null;
  else if (
    isRecord(d) && (d.outcome === "pass" || d.outcome === "block") &&
    typeof d.reason === "string" && typeof d.accepted === "boolean"
  ) {
    out.deliverable = { outcome: d.outcome, reason: d.reason, accepted: d.accepted };
  }
  const vv = raw.verifierVerdict;
  if (vv === null) out.verifierVerdict = null;
  else if (isRecord(vv) && typeof vv.verified === "boolean" && isStringArray(vv.failedChecks)) {
    out.verifierVerdict = { verified: vv.verified, failedChecks: vv.failedChecks };
  }
  if (isStringArray(raw.outstanding)) out.outstanding = raw.outstanding;
  if (typeof raw.errorClass === "string") out.errorClass = raw.errorClass;
  if (typeof raw.finalStatus === "string") out.finalStatus = raw.finalStatus;
  return out;
}

/**
 * Read + validate `metadata.extensions.terminalOutcome`. Returns `undefined`
 * when absent or malformed (never throws) — a malformed slot must not
 * fabricate a verdict.
 */
export function readTerminalOutcome(
  metadata: { readonly extensions?: Readonly<Record<string, unknown>> } | undefined,
): ReconciledOutcome | undefined {
  const raw = metadata?.extensions?.["terminalOutcome"];
  if (!isRecord(raw)) return undefined;
  const { status, terminatedBy, provenance, verdict, answerSatisfied, success } = raw;
  if (typeof status !== "string" || !STATUSES.includes(status)) return undefined;
  if (typeof provenance !== "string" || !PROVENANCES.includes(provenance)) return undefined;
  if (typeof success !== "boolean") return undefined;
  if (terminatedBy !== null && typeof terminatedBy !== "string") return undefined;
  if (answerSatisfied !== null && typeof answerSatisfied !== "boolean") return undefined;
  let v: ReconciledOutcome["verdict"] = null;
  if (verdict !== null) {
    if (!isRecord(verdict) || typeof verdict.accepted !== "boolean" || typeof verdict.summary !== "string") {
      return undefined;
    }
    v = { accepted: verdict.accepted, summary: verdict.summary };
  }
  return {
    ...readOptionalOutcomeFields(raw),
    ...(typeof raw.authority === "string" ? { authority: raw.authority } : {}),
    status: status as ReconciledOutcome["status"],
    terminatedBy,
    provenance: provenance as ReconciledOutcome["provenance"],
    verdict: v,
    answerSatisfied,
    success,
  };
}
