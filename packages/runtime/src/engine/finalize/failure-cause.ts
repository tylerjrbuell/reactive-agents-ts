/**
 * The cause of a failed run, for `TaskResult.error` and `AgentCompleted.error`.
 *
 * A failed run's error is WHY it failed, never what it said. The output text
 * of a failed run is the model's last narration or draft; publishing it as the
 * error hid the real cause (2026-11-10: an Ollama stream failure surfaced as
 * "Let me pull sessions and events for the period.").
 *
 * Order (first match wins), deterministic facts only:
 *   1. the verifier gate's own message (it withheld the answer);
 *   2. the kernel/provider failure detail carried on the strategy result;
 *   3. a kernel abstention (strategy status `abstained`), with its reason;
 *   4. the runtime veto that flipped success, with what it found;
 *   5. a generic cause naming the termination reason.
 */
import { runtimeStatusAuthority } from "./status-authority.js";
import { readTerminalOutcome } from "./terminal-outcome-read.js";

/** What the cause derivation reads; every field is already on the engine's locals. */
export interface FailureCauseInput {
  /** `VerificationOutcome.error` (verifier block). */
  readonly verificationError?: string;
  /** The strategy result: its status, error and metadata (outstanding criteria, abstention, terminal outcome). */
  readonly reasoning?: {
    readonly status: string;
    readonly error?: string;
    readonly metadata?: Readonly<Record<string, unknown>> & { readonly extensions?: Readonly<Record<string, unknown>> };
  };
  /** `ctx.metadata`: the honesty markers the engine stamped (see status-authority.ts). */
  readonly markers: Readonly<Record<string, unknown>>;
  /** The raw termination reason, when known. */
  readonly terminatedBy?: string;
}

const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

const stringList = (v: unknown): readonly string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

const suffix = (terminatedBy: string | undefined): string =>
  nonEmpty(terminatedBy) ? ` (terminatedBy: ${terminatedBy})` : "";

/** The cause sentence of an abstention, with the kernel's recorded reason when present. */
function abstentionCause(meta: Readonly<Record<string, unknown>> | undefined): string {
  const abstention = meta?.["abstention"] as { readonly reason?: unknown } | undefined;
  return `The agent abstained${nonEmpty(abstention?.reason) ? `: ${abstention.reason}` : ""}.`;
}

/** One sentence per runtime veto, naming what the veto found. */
function vetoCause(authority: string, input: FailureCauseInput): string {
  const meta = input.reasoning?.metadata;
  const outcome = readTerminalOutcome(meta);
  const outstanding = stringList(meta?.["outstandingCriteria"]);
  const outstandingIds = outstanding.length > 0 ? outstanding : stringList(outcome?.outstanding);
  const unmet = outstandingIds.length > 0 ? `: ${outstandingIds.join("; ")}` : "";
  switch (authority) {
    case "runtime-success-veto:abstained":
      return abstentionCause(meta);
    case "runtime-success-veto:outstanding-criteria":
      return `The run ended with unmet requirements${unmet}.`;
    case "runtime-success-veto:terminal-outcome": {
      const refused = outcome?.verdict?.accepted === false ? ` The final answer was refused: ${outcome.verdict.summary}.` : "";
      return `The run ended ${outcome?.status ?? "unfinished"}${suffix(input.terminatedBy)}${unmet ? ` with unmet requirements${unmet}` : ""}.${refused}`;
    }
    case "runtime-success-veto:strategy-result-failed":
      return `Reasoning failed${suffix(input.terminatedBy)}.`;
    case "runtime-success-veto:required-tool-unmet":
      return "No call to a required tool succeeded.";
    case "runtime-success-veto:empty-output":
      return "Run ended with no output and no verified deliverable — nothing to ship.";
    case "runtime-success-veto:unproduced-deliverable":
      return "A declared deliverable was not produced.";
    default:
      return `The run was vetoed by ${authority}${suffix(input.terminatedBy)}.`;
  }
}

/** The failure cause of a run whose success bit is false. Never the output text. */
export function deriveFailureCause(input: FailureCauseInput): string {
  if (nonEmpty(input.verificationError)) return input.verificationError;
  if (nonEmpty(input.reasoning?.error)) return input.reasoning.error;
  // The kernel abstained (its own status since 2026-11-10, output ""): the
  // cause is the abstention, never a generic "did not complete".
  if (input.reasoning?.status === "abstained") return abstentionCause(input.reasoning.metadata);
  const authority = runtimeStatusAuthority(input.markers);
  if (authority !== undefined) return vetoCause(authority, input);
  const outcome = readTerminalOutcome(input.reasoning?.metadata);
  const outstanding = stringList(outcome?.outstanding);
  if (outstanding.length > 0) {
    return `The run ended ${outcome?.status ?? "unfinished"}${suffix(input.terminatedBy)} with unmet requirements: ${outstanding.join("; ")}.`;
  }
  return input.reasoning?.status === "failed"
    ? `Reasoning failed${suffix(input.terminatedBy)}.`
    : `The run did not complete successfully${suffix(input.terminatedBy)}.`;
}
