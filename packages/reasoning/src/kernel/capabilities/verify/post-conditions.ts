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

/**
 * Does a WRITTEN path satisfy a derived TARGET path? Asymmetric on purpose:
 * the derived target is always the short relative side ("./out.md",
 * "dir/out.md") and the written path the long, often-absolute side
 * ("/abs/dir/out.md") — the file-write tool writes to the resolved absolute
 * path, which is what lands in the ledger action's toolCall.arguments.path.
 *
 * Matches iff the written path EQUALS the target, or the target is a trailing
 * PATH-SEGMENT suffix of the written path (a "/" boundary before it). Both
 * sides are normalized (leading "./" stripped). So:
 *   "/abs/dir/out.md"  ⊇ "out.md"           ✓ (suffix after "/")
 *   "/abs/dir/out.md"  ⊇ "dir/out.md"       ✓ (multi-segment suffix)
 *   "/abs/dir/my-out.md" ⊉ "out.md"         ✗ (no "/" boundary — basename collision)
 *   "/abs/dir/other.md"  ⊉ "out.md"         ✗ (different file)
 *
 * The "/" boundary requirement is what keeps this from being a loose
 * `.includes()` / basename match — false-met is the dangerous direction for a
 * success authority, so we never match across a non-separator boundary and
 * never run the reverse direction (target ⊇ written). Pure: no fs, no cwd.
 */
function writtenPathSatisfies(written: string, target: string): boolean {
  const w = normalizePath(written);
  const t = normalizePath(target);
  if (t.length === 0) return false;
  return w === t || w.endsWith(`/${t}`);
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
 * Argument keys whose VALUE names the written file path. Restricting extraction
 * to these keys (rather than scanning every string arg) is load-bearing for the
 * no-false-met DBC: under the trailing-path-segment suffix match, a non-path arg
 * like `content` that merely ENDS WITH the derived path (e.g. a document body
 * "...see docs/agents-summary.md") would otherwise falsely satisfy
 * ArtifactProduced. If an exotic write tool uses an unknown key the artifact
 * simply won't match (false-UNMET) — the acceptable direction.
 */
const PATH_ARG_KEYS: ReadonlySet<string> = new Set([
  "path",
  "filepath",
  "file_path",
  "file",
  "filename",
  "file_name",
  "dest",
  "destination",
  "outputpath",
  "output_path",
  "outpath",
  "out_path",
  "target",
  "targetpath",
  "target_path",
]);

function isPathArgKey(key: string): boolean {
  return PATH_ARG_KEYS.has(key.toLowerCase());
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
  // Collect WRITING-tool action steps' (id -> raw path-args). Non-writing tools
  // (e.g. file-read) are excluded so a read of the path cannot satisfy
  // "produced". Keyed by toolCallId only — the union of all write paths is
  // deliberately NOT collected (see doc comment). Paths are stored raw (only
  // trimmed); the absolute-vs-relative reconciliation happens at match time via
  // writtenPathSatisfies (the written side is the long/absolute path).
  const writeActionPathsById = new Map<string, string[]>();
  for (const step of steps) {
    if (step.type !== "action") continue;
    const tc = step.metadata?.toolCall as ToolCallLike | undefined;
    if (!tc?.arguments) continue;
    if (!isWritingTool(tc.name)) continue;
    if (typeof tc.id !== "string" || tc.id.length === 0) continue;
    const paths: string[] = [];
    for (const [key, value] of Object.entries(tc.arguments)) {
      // Only path-naming keys — a `content` body that ends with the target path
      // must NOT be treated as the written path (no-false-met DBC).
      if (!isPathArgKey(key)) continue;
      if (typeof value === "string" && value.trim().length > 0) {
        paths.push(value);
      }
    }
    if (paths.length === 0) continue;
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
      const written = writeActionPathsById.get(linkId)!;
      // The written path is the long/absolute side; the derived `path` the
      // short/relative target. A path-segment-suffix match reconciles them
      // without opening a false-met door (see writtenPathSatisfies).
      if (written.some((w) => writtenPathSatisfies(w, path))) return true;
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
