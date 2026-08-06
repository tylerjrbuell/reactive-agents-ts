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
import { entriesOfKind, type RunLedger } from "../../ledger/run-ledger.js";
import { getMissingRequiredToolsFromSteps } from "./requirement-state.js";
import { META_TOOLS, HARNESS_PSEUDO_TOOLS } from "../../state/kernel-constants.js";

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

/**
 * The run's side-effect must have LANDED — for a mutation task (create/send/
 * delete a note/email/event/…) whose deliverable is NOT a local file, so no
 * `ArtifactProduced` disk-check applies. Met iff the run's LATEST substantive
 * (non-meta, non-pseudo) tool observation SUCCEEDED. This closes the
 * generic-CLI blind spot: `ToolCalled(gws-cli)` is satisfied by a successful
 * `schema` READ while the `create` MUTATION failed — the tool name can't tell a
 * read from a write, so a failed mutation read as done and shipped a fabricated
 * "note created". Grounding on the terminal observation's success recovers the
 * ground truth the tool-name check throws away.
 */
export interface SideEffectLandedCondition {
  readonly kind: "SideEffectLanded";
}

export type PostCondition =
  | ToolCalledCondition
  | ArtifactProducedCondition
  | OutputContainsCondition
  | SideEffectLandedCondition;

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

export const sideEffectLanded = (): SideEffectLandedCondition => ({
  kind: "SideEffectLanded",
});

// ─── Verification result ──────────────────────────────────────────────────────

export interface PostConditionResult {
  readonly met: readonly PostCondition[];
  readonly unmet: readonly PostCondition[];
}

export interface VerifyOptions {
  /** The assembled deliverable output, consulted by OutputContains. */
  readonly output?: string;
  /**
   * The run-scoped RunLedger — the canonical evidence substrate for BOTH
   * state-grounded conditions (`ToolCalled`, `ArtifactProduced`).
   *
   * `steps` are the CURRENT agent's own steps. A delegated write therefore does
   * not appear in them: the parent's steps hold `spawn-agent`, and the child's
   * `file-write` lives only in the run ledger, merged under `sub-agent:<name>`
   * by Wave C.2 slice 2. Without this the gate failed a run whose sub-agent had
   * demonstrably written the deliverable — observed live: an orchestrator that
   * delegated the write got
   * `Post-condition(s) unmet: You still must: write the file ./cryptos.md`
   * while `./cryptos.md` existed on disk with the correct content, and
   * `receipt.toolsUsed` already listed `file-write`.
   *
   * Optional so every existing caller and test keeps its exact behaviour; when
   * absent the check is steps-only, as before.
   */
  readonly ledger?: RunLedger;
  /**
   * Move 2 — the DETERMINISTIC ground-truth override for `ArtifactProduced`
   * (Sys-audit 2026-07-29 RC#1: the success authority was filesystem-blind).
   *
   * The ledger/steps evidence is a RECONSTRUCTION of what the run believes it
   * did — it misses an unlinked write, a write tool whose path-arg key we don't
   * know, or a side-effecting producer. When it misses, the file may still be
   * ON DISK, and a file on disk IS the artifact. This capability answers "does
   * the target path exist as ground truth?" and is consulted ONLY to flip a
   * would-be UNMET to MET — never the reverse. So it strictly reduces the
   * documented false-failure rate and cannot open a false-met beyond "the file
   * the contract named actually exists."
   *
   * Injected (not a direct `fs` import) so `verify()` stays pure and unit-test
   * deterministic; the terminal gate supplies an fs-backed implementation.
   * Absent → today's ledger-only behaviour, byte-identical.
   */
  readonly fileExists?: (path: string) => boolean;
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
 *
 * Exported (Wave C1 task 6) so `deliverable-report.ts` can reuse this SAME
 * normalizer when matching a RunLedger `artifact` entry's path against a
 * declared deliverable's path, instead of re-deriving path-matching logic.
 */
export function writtenPathSatisfies(written: string, target: string): boolean {
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
 * ToolCalled is met iff the tool completed SUCCESSFULLY at least once, anywhere
 * in the run — including inside a sub-agent.
 *
 * Two evidence sources, unioned:
 *
 *   1. The run-scoped ledger's `tool-result` entries. This is the canonical one.
 *      A sub-agent's ledger merges into its parent's (Wave C.2 slice 2), and a
 *      grandchild's merges through that, so this sees delegated calls at ANY
 *      depth without the parent having to carry a summary of them.
 *   2. The steps scan, which additionally credits `delegatedToolsUsed` — the
 *      older, hand-plumbed channel that carried a child's tool names up onto the
 *      spawn observation. Kept because callers with no ledger (unit callers,
 *      pre-ledger strategies) still depend on it, and because it costs nothing:
 *      both sources are sound positive evidence, so their union cannot produce a
 *      false-met.
 *
 * `delegatedToolsUsed` is one delegation level deep by construction (it comes
 * off the child's own result); the ledger is not. That is why source 1 leads.
 */
function isToolCalled(
  tool: string,
  steps: readonly ReasoningStep[],
  ledger?: RunLedger,
): boolean {
  for (const entry of entriesOfKind(ledger, "tool-result")) {
    if (entry.success === true && entry.toolName === tool) return true;
  }
  return getMissingRequiredToolsFromSteps(steps, [tool]).length === 0;
}

/** A tool name that is real work — not a harness meta-tool or pseudo-tool. */
function isSubstantiveToolName(toolName: string | undefined): toolName is string {
  return (
    typeof toolName === "string" &&
    toolName.length > 0 &&
    !META_TOOLS.has(toolName) &&
    !HARNESS_PSEUDO_TOOLS.has(toolName)
  );
}

/**
 * SideEffectLanded is met iff the run's LATEST substantive (non-meta,
 * non-pseudo) tool result SUCCEEDED. For a mutation task the model does its
 * reads first and its write last, so the terminal substantive action IS the
 * mutation attempt — if it FAILED, the side-effect never landed and the run must
 * not report success (the reported gws-cli fabrication: `schema` succeeded,
 * `create` failed, harness declared done). No substantive result at all →
 * unmet: nothing was performed. Delegation (`spawn-agent`) counts as substantive
 * so a sub-agent that carried out the mutation is credited.
 *
 * Prefers the run-scoped ledger (append order = call order, and it sees
 * delegated results) and falls back to the steps scan for ledger-less callers.
 */
export function isSideEffectLanded(
  steps: readonly ReasoningStep[],
  ledger?: RunLedger,
): boolean {
  const results = ledger ? [...entriesOfKind(ledger, "tool-result")] : [];
  if (results.length > 0) {
    for (let i = results.length - 1; i >= 0; i--) {
      const entry = results[i]!;
      if (!isSubstantiveToolName(entry.toolName)) continue;
      return entry.success === true;
    }
    return false;
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.type !== "observation") continue;
    const result = step.metadata?.observationResult as ObservationResultLike | undefined;
    if (!isSubstantiveToolName(result?.toolName)) continue;
    return result?.success === true;
  }
  return false;
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
  ledger?: RunLedger,
  fileExists?: (path: string) => boolean,
): boolean {
  // ── Ledger `artifact` entries first (2026-07-26) ──────────────────────────
  // An `artifact` entry is minted (artifact-projection.ts) ONLY from a
  // SUCCESSFUL observation of a tool DECLARING `produces:"file"`, already linked
  // by toolCallId to the action whose args named the path. That is the same
  // no-false-met contract the steps scan below enforces by hand, on a broader
  // vocabulary (declared `produces` covers code-execute / shell-execute writes
  // that the 4-name WRITING_TOOL_NAMES set cannot see).
  //
  // Crucially the ledger is RUN-scoped: a sub-agent's entries are merged into
  // its parent's (Wave C.2 slice 2, stamped `sub-agent:<name>`), so a DELEGATED
  // write is visible here while it is structurally absent from `steps` — the
  // parent's steps hold only `spawn-agent`. `op` is checked so a `delete` entry
  // can never satisfy "produced".
  for (const entry of entriesOfKind(ledger, "artifact")) {
    if (entry.op === "delete") continue;
    if (writtenPathSatisfies(entry.path, path)) return true;
  }
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

  // ── Deterministic ground-truth override (Move 2 / RC#1) ──────────────────────
  // The reconstruction above found nothing. Before declaring the artifact
  // UNPRODUCED, ask the world: if the contract's target path exists on disk, it
  // WAS produced, regardless of whether the ledger managed to link the write.
  // Positive-only: a present file flips false→MET; an absent file leaves the
  // reconstruction's verdict unchanged (no false-met). This is what makes the
  // "deterministic" authority in authority.ts actually deterministic.
  if (fileExists?.(path) === true) return true;

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
        satisfied = isToolCalled(condition.tool, steps, opts?.ledger);
        break;
      case "ArtifactProduced":
        satisfied = isArtifactProduced(condition.path, steps, opts?.ledger, opts?.fileExists);
        break;
      case "OutputContains":
        satisfied = output.includes(condition.pattern);
        break;
      case "SideEffectLanded":
        satisfied = isSideEffectLanded(steps, opts?.ledger);
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
      case "SideEffectLanded":
        return "actually complete the requested action — your last tool call failed, so it did not take effect; retry it (correct the arguments) or report honestly that it could not be done";
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
