import {
  META_TOOLS as META_TOOL_NAMES,
  HARNESS_PSEUDO_TOOLS,
} from "../../../kernel/state/kernel-constants.js";
import { executedToolResults, type LedgerEntry, type RunLedger } from "../../ledger/run-ledger.js";

/**
 * The run's tool evidence — ONE value every gate reads (`state.evidence`),
 * derived from the run ledger only (Plan 9 Phase 1 close, advisor items 4 + 8).
 *
 * Before this, each gate re-scanned the pass's `steps`, so a later kernel pass
 * of the same run (reflexion improve pass, plan-execute step) forgot the calls
 * an earlier pass made: a seeded pass ending on `end_turn` drew a grounding
 * redirect / abstention, `maxCallsPerTool` reset every pass, and the act-phase
 * final-answer gate refused an answer for a required tool pass 1 had called.
 * The ledger carries the seed (state/pass-seed.ts), so evidence read from it
 * spans the run. Every "was required tool X called / attempted / permanently
 * failed / still missing" answer is a pure function of this value.
 */
export interface ToolEvidence {
  /** Successful executed calls per tool (meta tools excluded; delegated child tools credited). */
  readonly successfulCounts: Readonly<Record<string, number>>;
  /**
   * Executed calls per tool, success or not (meta tools excluded). A call a
   * harness guard blocked never ran and is not an attempt; a delegated child's
   * tools are credited on success only, never as attempts.
   */
  readonly attemptedCounts: Readonly<Record<string, number>>;
  /**
   * Tools attempted at least once that never succeeded, in first-attempt order.
   * Nudging the model to retry them only causes loops.
   */
  readonly permanentlyFailed: readonly string[];
  /** At least one successful call of a tool that is neither meta nor a harness pseudo-tool. */
  readonly substantive: boolean;
  /** The evidence carries a substantive success from an earlier pass's seeded ledger. */
  readonly seeded: boolean;
}

/** Evidence of a run that has executed nothing. */
export const NO_TOOL_EVIDENCE: ToolEvidence = {
  successfulCounts: {},
  attemptedCounts: {},
  permanentlyFailed: [],
  substantive: false,
  seeded: false,
};

const SUB_AGENT_PASS_PREFIX = "sub-agent:";

/**
 * Fold ledger entries into `prior` evidence. Pure — returns a new value (or
 * `prior` by identity when no entry adds evidence).
 *
 * Counted: executed `tool-result` entries (harness-authored guard warnings
 * excluded via {@link executedToolResults}). Each is an attempt of its tool;
 * one with `success === true` also credits the tool plus each tool in
 * `delegatedToolsUsed` (the executor rolls a grandchild's tools up into it). A
 * sub-agent's merged entries (`pass: "sub-agent:<name>"`) are NOT counted: the
 * delegation's own result already credits them through `delegatedToolsUsed`,
 * and counting the child's calls would charge them against this agent's
 * `maxCallsPerTool` budget.
 */
export function foldToolEvidence(
  prior: ToolEvidence,
  entries: readonly LedgerEntry[],
): ToolEvidence {
  let counts: Record<string, number> | undefined;
  let attempts: Record<string, number> | undefined;
  let substantive = prior.substantive;
  for (const entry of executedToolResults(entries)) {
    if (entry.pass !== undefined && entry.pass.startsWith(SUB_AGENT_PASS_PREFIX)) continue;
    if (typeof entry.toolName === "string" && isCountableToolName(entry.toolName)) {
      attempts ??= { ...prior.attemptedCounts };
      attempts[entry.toolName] = (attempts[entry.toolName] ?? 0) + 1;
    }
    if (entry.success !== true) continue;
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
  if (counts === undefined && attempts === undefined) return prior;
  const successfulCounts = counts ?? prior.successfulCounts;
  const attemptedCounts = attempts ?? prior.attemptedCounts;
  return {
    successfulCounts,
    attemptedCounts,
    permanentlyFailed: Object.keys(attemptedCounts).filter((t) => (successfulCounts[t] ?? 0) === 0),
    substantive,
    seeded: prior.seeded,
  };
}

/** The tool evidence a ledger holds (`seeded` is false; the pass seed sets it). */
export function toolEvidence(ledger: RunLedger | undefined): ToolEvidence {
  return foldToolEvidence(NO_TOOL_EVIDENCE, ledger ?? []);
}

function isCountableToolName(toolName: string): boolean {
  return toolName.length > 0 && !META_TOOL_NAMES.has(toolName);
}

/**
 * The required tools whose successful call count in `evidence` is still below
 * their quantity floor (default 1). Counts are run-wide: a seeded earlier pass's
 * calls count, and a guard-blocked call counts for nothing.
 */
export function missingRequired(
  evidence: ToolEvidence,
  requiredTools: readonly string[],
  requiredToolQuantities?: Readonly<Record<string, number>>,
): readonly string[] {
  const quantities = requiredToolQuantities ?? {};
  return requiredTools.filter(
    (toolName) => (evidence.successfulCounts[toolName] ?? 0) < (quantities[toolName] ?? 1),
  );
}

/** The required tools that were attempted at least once and never succeeded. */
export function permanentlyFailedRequired(
  evidence: ToolEvidence,
  requiredTools: readonly string[],
): readonly string[] {
  const failed = new Set(evidence.permanentlyFailed);
  return requiredTools.filter((toolName) => failed.has(toolName));
}

/**
 * Like {@link missingRequired} but excludes permanently-failed tools.
 *
 * Use this for nudge messages and completion guards — if a tool was attempted
 * and always failed, the model already knows and repeating the nudge causes loops.
 * Tools that were never attempted remain in the list (genuinely missing).
 */
export function effectiveMissingRequired(
  evidence: ToolEvidence,
  requiredTools: readonly string[],
  requiredToolQuantities?: Readonly<Record<string, number>>,
): readonly string[] {
  const failed = new Set(evidence.permanentlyFailed);
  return missingRequired(evidence, requiredTools, requiredToolQuantities).filter(
    (toolName) => !failed.has(toolName),
  );
}

/**
 * Step 3 item 3c (09 §6.5) — the requirement-coverage view of the run's
 * evidence. Covered means COMPLETED SUCCESSFULLY (a delegated success counts).
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
  evidence: ToolEvidence,
  requiredTools: readonly string[],
): RequirementEvidence {
  const missing = new Set(missingRequired(evidence, requiredTools));
  return { coveredTools: new Set(requiredTools.filter((t) => !missing.has(t))) };
}
