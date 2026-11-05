import type { ReasoningStep } from "../../../types/index.js";
import {
  META_TOOLS as META_TOOL_NAMES,
  GUARD_OBSERVATION_TAG,
  HARNESS_PSEUDO_TOOLS,
} from "../../../kernel/state/kernel-constants.js";
import { executedToolResults, type LedgerEntry, type RunLedger } from "../../ledger/run-ledger.js";

/**
 * The run's tool evidence — ONE value every gate reads (`state.evidence`),
 * derived from the run ledger only (Plan 9 Phase 1 close, advisor item 4).
 *
 * Before this, each gate re-scanned the pass's `steps`, so a later kernel pass
 * of the same run (reflexion improve pass, plan-execute step) forgot the calls
 * an earlier pass made: a seeded pass ending on `end_turn` drew a grounding
 * redirect / abstention, and `maxCallsPerTool` reset every pass. The ledger
 * carries the seed (state/pass-seed.ts), so evidence read from it spans the run.
 */
export interface ToolEvidence {
  /** Successful executed calls per tool (meta tools excluded; delegated child tools credited). */
  readonly successfulCounts: Readonly<Record<string, number>>;
  /** At least one successful call of a tool that is neither meta nor a harness pseudo-tool. */
  readonly substantive: boolean;
  /** The evidence carries a substantive success from an earlier pass's seeded ledger. */
  readonly seeded: boolean;
}

/** Evidence of a run that has executed nothing. */
export const NO_TOOL_EVIDENCE: ToolEvidence = { successfulCounts: {}, substantive: false, seeded: false };

const SUB_AGENT_PASS_PREFIX = "sub-agent:";

/**
 * Fold ledger entries into `prior` evidence. Pure — returns a new value (or
 * `prior` by identity when no entry adds evidence).
 *
 * Counted: executed `tool-result` entries (harness-authored guard warnings
 * excluded via {@link executedToolResults}) with `success === true`, crediting
 * the tool plus each tool in `delegatedToolsUsed`. A sub-agent's merged entries
 * (`pass: "sub-agent:<name>"`) are NOT counted: the delegation's own result
 * already credits them through `delegatedToolsUsed`, and counting the child's
 * calls would charge them against this agent's `maxCallsPerTool` budget.
 */
export function foldToolEvidence(
  prior: ToolEvidence,
  entries: readonly LedgerEntry[],
): ToolEvidence {
  let counts: Record<string, number> | undefined;
  let substantive = prior.substantive;
  for (const entry of executedToolResults(entries)) {
    if (entry.success !== true) continue;
    if (entry.pass !== undefined && entry.pass.startsWith(SUB_AGENT_PASS_PREFIX)) continue;
    const tools = new Set<string>();
    if (typeof entry.toolName === "string") tools.add(entry.toolName);
    for (const delegated of entry.delegatedToolsUsed ?? []) tools.add(delegated);
    for (const toolName of tools) {
      if (!isCountableToolName(toolName)) continue;
      counts ??= { ...prior.successfulCounts };
      counts[toolName] = (counts[toolName] ?? 0) + 1;
      if (!HARNESS_PSEUDO_TOOLS.has(toolName)) substantive = true;
    }
  }
  if (counts === undefined) return prior;
  return { successfulCounts: counts, substantive, seeded: prior.seeded };
}

/** The tool evidence a ledger holds (`seeded` is false; the pass seed sets it). */
export function toolEvidence(ledger: RunLedger | undefined): ToolEvidence {
  return foldToolEvidence(NO_TOOL_EVIDENCE, ledger ?? []);
}

/**
 * Tool evidence for a STRATEGY result that carries no run ledger — the one
 * sanctioned steps-derived evidence, used only by `finalizeStrategyResult`
 * (capabilities/sense/finalize-result.ts) when `runLedger` is absent. Kernel
 * gates read `state.evidence`; the drift test (tests/kernel/
 * tool-evidence-drift.test.ts) fences this to that one caller. Retire it when
 * every strategy hands finalize its run ledger (FinalizeExtras collapse).
 */
export function toolEvidenceWithoutLedger(steps: readonly ReasoningStep[]): ToolEvidence {
  const successfulCounts = buildSuccessfulToolCallCounts(steps);
  const substantive = Object.keys(successfulCounts).some((t) => !HARNESS_PSEUDO_TOOLS.has(t));
  return { successfulCounts, substantive, seeded: false };
}

interface ObservationResultLike {
  readonly success?: boolean;
  readonly toolName?: string;
  readonly delegatedToolsUsed?: readonly string[];
}

function isCountableToolName(toolName: string): boolean {
  return toolName.length > 0 && !META_TOOL_NAMES.has(toolName);
}

function incrementCount(
  counts: Record<string, number>,
  toolName: string,
): void {
  if (!isCountableToolName(toolName)) return;
  counts[toolName] = (counts[toolName] ?? 0) + 1;
}

/**
 * Count successful tool calls from observation metadata.
 *
 * Counts are based only on successful observations (`observationResult.success === true`).
 * Delegated tool usage is credited once per delegated tool for each successful
 * delegation observation, which allows parent delegation results to satisfy
 * required child-tool quotas.
 *
 * SUBSTRATE UNIFICATION (Cascade B root, Sys-audit 2026-07-29 RC#1). The
 * post-condition authority (`isToolCalled`, post-conditions.ts) reads the
 * run-scoped RunLedger's `tool-result` entries — which merge a sub-agent's
 * calls into the parent (Wave C.2), including GRANDCHILDREN. This counter read
 * `steps` only + one-level `delegatedToolsUsed`, so a required tool satisfied
 * 2+ delegation levels deep was invisible here while visible to `isToolCalled`
 * — two authorities, two definitions of "called", one blind. The missing-
 * required-tool gate (runner.ts §8) then FAILS the run and NULLS the output on
 * a deliverable a deeper agent had already produced. Threading the ledger here
 * puts this counter on the SAME evidence substrate as `isToolCalled`.
 *
 * No double-count: the ledger grows a `tool-result` from every LOCAL
 * observation step too, so a ledger entry is credited only when its
 * `toolCallId` was not already counted from `steps` (delegated/merged entries
 * carry a distinct child toolCallId absent from the parent's steps). A ledger
 * entry with no `toolCallId` is skipped — it cannot be de-duplicated against a
 * step, and counting it risks inflating a quantity>1 requirement. Union of two
 * positive-evidence sources ⇒ can only turn a false-UNMET into MET, never open
 * a false-MET. Ledger omitted ⇒ byte-identical to the prior steps-only count.
 */
export function buildSuccessfulToolCallCounts(
  steps: readonly ReasoningStep[],
  ledger?: RunLedger,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  const countedToolCallIds = new Set<string>();

  for (const step of steps) {
    if (step.type !== "observation") continue;
    // A guard-blocked call never executed; its warning is not a call.
    if (step.metadata?.frameworkInstrumentation === GUARD_OBSERVATION_TAG) continue;

    const result = step.metadata?.observationResult as ObservationResultLike | undefined;
    if (result?.success !== true) continue;

    const linkId = step.metadata?.toolCallId;
    if (typeof linkId === "string" && linkId.length > 0) countedToolCallIds.add(linkId);

    const observedTools = new Set<string>();
    if (typeof result.toolName === "string" && result.toolName.length > 0) {
      observedTools.add(result.toolName);
    }
    if (Array.isArray(result.delegatedToolsUsed)) {
      for (const delegatedToolName of result.delegatedToolsUsed) {
        if (typeof delegatedToolName === "string" && delegatedToolName.length > 0) {
          observedTools.add(delegatedToolName);
        }
      }
    }
    for (const toolName of observedTools) {
      incrementCount(counts, toolName);
    }
  }

  // Ledger tool-result entries not already represented in `steps` — the
  // delegated/merged calls (incl. grandchildren) that never reach the parent's
  // steps. De-duplicated by toolCallId against the local steps above.
  for (const entry of executedToolResults(ledger)) {
    if (entry.success !== true) continue;
    if (typeof entry.toolName !== "string" || entry.toolName.length === 0) continue;
    const id = entry.toolCallId;
    if (typeof id !== "string" || id.length === 0) continue;
    if (countedToolCallIds.has(id)) continue;
    countedToolCallIds.add(id);
    incrementCount(counts, entry.toolName);
  }

  return counts;
}

/**
 * Returns the subset of required tools whose successful call counts are still
 * below their required quantity floor.
 */
export function getMissingRequiredToolsByCount(
  successfulCounts: Readonly<Record<string, number>>,
  requiredTools: readonly string[],
  requiredToolQuantities?: Readonly<Record<string, number>>,
): readonly string[] {
  const quantities = requiredToolQuantities ?? {};
  return requiredTools.filter(
    (toolName) => (successfulCounts[toolName] ?? 0) < (quantities[toolName] ?? 1),
  );
}

/**
 * Convenience wrapper that computes missing required tools directly from steps.
 * When a run-scoped `ledger` is supplied, delegated/merged successful calls
 * (incl. grandchildren) count too — the same substrate `isToolCalled` reads.
 */
export function getMissingRequiredToolsFromSteps(
  steps: readonly ReasoningStep[],
  requiredTools: readonly string[],
  requiredToolQuantities?: Readonly<Record<string, number>>,
  ledger?: RunLedger,
): readonly string[] {
  const successfulCounts = buildSuccessfulToolCallCounts(steps, ledger);
  return getMissingRequiredToolsByCount(
    successfulCounts,
    requiredTools,
    requiredToolQuantities,
  );
}

/**
 * Count all tool call attempts from observation metadata, regardless of success.
 * Used to detect tools that have been tried but never succeeded.
 */
export function buildAttemptedToolCallCounts(
  steps: readonly ReasoningStep[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const step of steps) {
    if (step.type !== "observation") continue;
    const result = step.metadata?.observationResult as ObservationResultLike | undefined;
    if (typeof result?.toolName !== "string" || result.toolName.length === 0) continue;
    if (!isCountableToolName(result.toolName)) continue;
    counts[result.toolName] = (counts[result.toolName] ?? 0) + 1;
  }

  return counts;
}

/**
 * Returns required tools that were attempted at least once but never succeeded.
 * These are "permanently failed" from the harness perspective — nudging the model
 * to retry them will only cause loops.
 */
export function getPermanentlyFailedRequiredTools(
  steps: readonly ReasoningStep[],
  requiredTools: readonly string[],
  ledger?: RunLedger,
): readonly string[] {
  // Ledger-aware success count: a tool that SUCCEEDED via delegation (incl. a
  // grandchild) is not permanently failed, even if a local attempt failed.
  const successfulCounts = buildSuccessfulToolCallCounts(steps, ledger);
  const attemptedCounts = buildAttemptedToolCallCounts(steps);
  return requiredTools.filter(
    (toolName) =>
      (attemptedCounts[toolName] ?? 0) > 0 &&
      (successfulCounts[toolName] ?? 0) === 0,
  );
}

/**
 * Step 3 item 3c (09 §6.5) — the ONE ledger-backed requirement-evidence
 * derivation. Covered means COMPLETED SUCCESSFULLY, computed from the same
 * substrate `buildSuccessfulToolCallCounts`/`isToolCalled` already read (local
 * `steps` unioned with the run-scoped `RunLedger`'s `tool-result` entries, so a
 * delegated/merged success counts too).
 *
 * This replaces caller-computed `coveredTools` sets that used ATTEMPTED
 * semantics (e.g. `state.toolsUsed`, written before the tool executes —
 * act.ts's `newToolsUsed.add(...)` sites). A required tool whose every call
 * errored must NOT be covered — see
 * wiki/Planning/Implementation-Plans/2026-08-18-step-3-one-execution-boundary.md
 * §4 and the live probe `scripts/probes/step3-requirement-evidence-probe.ts`
 * (a required tool with 2/2 failing calls previously produced a RunLedger
 * `{kind:"requirement", status:"satisfied"}` entry — factually wrong).
 */
export interface RequirementEvidence {
  /** Required tools that COMPLETED (at least one successful call). */
  readonly coveredTools: ReadonlySet<string>;
}

export function deriveRequirementEvidence(
  steps: readonly ReasoningStep[],
  requiredTools: readonly string[],
  ledger?: RunLedger,
): RequirementEvidence {
  const missing = new Set(getMissingRequiredToolsFromSteps(steps, requiredTools, undefined, ledger));
  return { coveredTools: new Set(requiredTools.filter((t) => !missing.has(t))) };
}

/**
 * Like getMissingRequiredToolsFromSteps but excludes permanently-failed tools.
 *
 * Use this for nudge messages and completion guards — if a tool was attempted
 * and always failed, the model already knows and repeating the nudge causes loops.
 * Tools that were never attempted remain in the list (genuinely missing).
 */
export function getEffectiveMissingRequiredTools(
  steps: readonly ReasoningStep[],
  requiredTools: readonly string[],
  requiredToolQuantities?: Readonly<Record<string, number>>,
  ledger?: RunLedger,
): readonly string[] {
  const missing = getMissingRequiredToolsFromSteps(steps, requiredTools, requiredToolQuantities, ledger);
  const permanentlyFailed = new Set(getPermanentlyFailedRequiredTools(steps, requiredTools, ledger));
  return missing.filter((toolName) => !permanentlyFailed.has(toolName));
}
