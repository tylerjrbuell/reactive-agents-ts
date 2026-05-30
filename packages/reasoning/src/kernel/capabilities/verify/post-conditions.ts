// File: src/kernel/capabilities/verify/post-conditions.ts
//
// PostCondition spine — the kernel's deterministic, state-grounded success
// authority (North Star: tau-bench, DSPy assertions, evaluator-optimizer).
//
// Why this exists:
//   Completion was historically judged on PROSE — the Arbitrator/verifier
//   verdict and reflexion's isSatisfied() inspect OUTPUT TEXT. A run could
//   report success:true with the required deliverable never produced (cogito
//   GitHub-MCP wrote no ./commits.md despite a glowing summary). STATE, not
//   prose, must be the success authority.
//
// What this is:
//   A pure verifier over the run LEDGER (state.steps[]). It answers "did the
//   things that had to happen actually happen?" — NOT "does the answer read
//   well?". The prose verdict is demoted to a quality signal; this spine is
//   the gate.
//
// Hard contract (DBC):
//   - verify(conditions, steps, opts?) is PURE. Same input -> same output.
//   - NO fs access. NO LLM. NO network. Judged entirely from the ledger +
//     the assembled output string the caller passes in.
//   - ToolCalled / ArtifactProduced are judged from successful observations
//     in the ledger, NOT from the real filesystem.

import type { ReasoningStep } from "../../../types/index.js";
import { getMissingRequiredToolsFromSteps } from "./requirement-state.js";

// ─── PostCondition union ────────────────────────────────────────────────────

/** A tool that must have been called successfully at least once. */
export interface ToolCalledCondition {
  readonly kind: "ToolCalled";
  readonly tool: string;
}

/**
 * A file artifact that must have been produced — judged from a successful
 * write observation in the ledger whose originating action named a matching
 * path. NOT a real-fs check (per DBC: ledger-only).
 */
export interface ArtifactProducedCondition {
  readonly kind: "ArtifactProduced";
  readonly path: string;
}

/** The assembled output must contain this literal substring. */
export interface OutputContainsCondition {
  readonly kind: "OutputContains";
  readonly pattern: string;
}

export type PostCondition =
  | ToolCalledCondition
  | ArtifactProducedCondition
  | OutputContainsCondition;

// ─── Constructors ───────────────────────────────────────────────────────────

export const toolCalled = (tool: string): ToolCalledCondition => ({
  kind: "ToolCalled",
  tool,
});

export const artifactProduced = (path: string): ArtifactProducedCondition => ({
  kind: "ArtifactProduced",
  path,
});

export const outputContains = (pattern: string): OutputContainsCondition => ({
  kind: "OutputContains",
  pattern,
});

// ─── Verification result ──────────────────────────────────────────────────────

export interface PostConditionResult {
  readonly met: readonly PostCondition[];
  readonly unmet: readonly PostCondition[];
}

export interface VerifyOptions {
  /** The assembled deliverable output, consulted by OutputContains. */
  readonly output?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Normalize a path for comparison: drop a single leading "./" and trim. */
function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, "");
}

interface ToolCallLike {
  readonly id?: string;
  readonly name?: string;
  readonly arguments?: Record<string, unknown>;
}

interface ObservationResultLike {
  readonly success?: boolean;
  readonly toolName?: string;
}

/**
 * Tool names that count as PRODUCING a file artifact. An ArtifactProduced
 * condition is satisfied ONLY by a successful observation from one of these —
 * a successful file-READ of the path does NOT count, nor does an unrelated
 * successful tool. Shared with derive-conditions.ts so the produce/derive
 * vocabularies stay in lockstep.
 */
export const WRITING_TOOL_NAMES: ReadonlySet<string> = new Set([
  "file-write",
  "write-file",
  "fs-write",
  "writefile",
]);

function isWritingTool(toolName: string | undefined): boolean {
  return typeof toolName === "string" && WRITING_TOOL_NAMES.has(toolName.toLowerCase());
}

/**
 * ArtifactProduced is met iff a SUCCESSFUL WRITE observation can be tied to the
 * target path. "Write" is judged from the observation's own toolName (DBC: tied
 * to the write's success, not to any-tool-succeeded), and the path must be tied
 * to *that* successful observation — never to the run-wide union of all write
 * actions.
 *
 * Matching is by toolCallId linkage ONLY: the successful write observation links
 * (via toolCallId) to its originating action whose toolCall.arguments names the
 * target path. An unlinked successful write carries no own-path on the
 * observation record (the ObservationResult schema has no path/args field), so
 * it CANNOT satisfy a specific ArtifactProduced(target) — we return false rather
 * than fall back to the action-path union.
 *
 * Why no union fallback: false-met is the dangerous direction for a success
 * authority. The union ("some write action named target AND some unrelated
 * write succeeded") wrongly reports target as produced when the target's own
 * write FAILED and a *different* path's write succeeded. The spine exists to
 * block exactly that false-success.
 *
 * Ledger-only, pure. NO fs access.
 */
function isArtifactProduced(
  path: string,
  steps: readonly ReasoningStep[],
): boolean {
  const target = normalizePath(path);

  // Collect WRITING-tool action steps' (id -> path-args). Non-writing tools
  // (e.g. file-read) are excluded so a read of the path cannot satisfy
  // "produced". Keyed by toolCallId only — the union of all write paths is
  // deliberately NOT collected (see doc comment).
  const writeActionPathsById = new Map<string, Set<string>>();
  for (const step of steps) {
    if (step.type !== "action") continue;
    const tc = step.metadata?.toolCall as ToolCallLike | undefined;
    if (!tc?.arguments) continue;
    if (!isWritingTool(tc.name)) continue;
    if (typeof tc.id !== "string" || tc.id.length === 0) continue;
    const paths = new Set<string>();
    for (const value of Object.values(tc.arguments)) {
      if (typeof value === "string" && value.trim().length > 0) {
        paths.add(normalizePath(value));
      }
    }
    if (paths.size === 0) continue;
    writeActionPathsById.set(tc.id, paths);
  }

  for (const step of steps) {
    if (step.type !== "observation") continue;
    const result = step.metadata?.observationResult as
      | ObservationResultLike
      | undefined;
    // Must be a SUCCESSFUL observation from a WRITING tool.
    if (result?.success !== true) continue;
    if (!isWritingTool(result.toolName)) continue;

    // Linked action via toolCallId — the ONLY way to tie a successful write to
    // a specific target path. Unlinked successful writes cannot resolve an
    // own-path and so cannot satisfy ArtifactProduced(target).
    const linkId = step.metadata?.toolCallId;
    if (typeof linkId === "string" && writeActionPathsById.has(linkId)) {
      if (writeActionPathsById.get(linkId)!.has(target)) return true;
      // Linked but path mismatched — keep scanning other observations.
    }
  }

  return false;
}

// ─── verify(): the pure gate ───────────────────────────────────────────────────

/**
 * Verify a set of post-conditions against the run ledger. Pure. Ledger-only.
 *
 * @param conditions the derived post-conditions (empty => all-met, no-op)
 * @param steps      the run's full ledger (state.steps[])
 * @param opts       optional assembled output (for OutputContains)
 */
export function verify(
  conditions: readonly PostCondition[],
  steps: readonly ReasoningStep[],
  opts?: VerifyOptions,
): PostConditionResult {
  const met: PostCondition[] = [];
  const unmet: PostCondition[] = [];
  const output = opts?.output ?? "";

  for (const condition of conditions) {
    let satisfied = false;
    switch (condition.kind) {
      case "ToolCalled":
        // Reuse the ledger-scan primitive — a tool is "called" iff it is NOT
        // in the missing set for the singleton requirement [tool].
        satisfied =
          getMissingRequiredToolsFromSteps(steps, [condition.tool]).length === 0;
        break;
      case "ArtifactProduced":
        satisfied = isArtifactProduced(condition.path, steps);
        break;
      case "OutputContains":
        satisfied = output.includes(condition.pattern);
        break;
    }
    if (satisfied) met.push(condition);
    else unmet.push(condition);
  }

  return { met, unmet };
}

/** Human-readable steering text naming the unmet conditions. */
export function describeUnmet(unmet: readonly PostCondition[]): string {
  if (unmet.length === 0) return "";
  const parts = unmet.map((c) => {
    switch (c.kind) {
      case "ToolCalled":
        return `call the \`${c.tool}\` tool`;
      case "ArtifactProduced":
        return `write the file ${c.path}`;
      case "OutputContains":
        return `include "${c.pattern}" in your answer`;
      default: {
        // Exhaustiveness: a future PostCondition kind must be handled here.
        // Without this, the switch would yield `undefined` -> "You still
        // must: undefined" steering text.
        const _exhaust: never = c;
        void _exhaust;
        return "";
      }
    }
  });
  return `You still must: ${parts.join("; ")}.`;
}
