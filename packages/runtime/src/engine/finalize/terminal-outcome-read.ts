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
    status: status as ReconciledOutcome["status"],
    terminatedBy,
    provenance: provenance as ReconciledOutcome["provenance"],
    verdict: v,
    answerSatisfied,
    success,
  };
}
