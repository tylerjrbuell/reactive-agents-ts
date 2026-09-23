// File: src/kernel/capabilities/verify/judgment-text-budget.ts
/**
 * Honest text budgeting shared by the kernel's judgment-shadow sites.
 *
 * Final whole-branch review (fix round, 2026-09-23) found two related defects
 * in how `completion-judgment-shadow.ts` (via `verifyAndEmit` in
 * `verifier.ts`) and `grounding-fabrication-judgment-shadow.ts` (via
 * `evaluateUnconsumedEvidenceGrounding` in `runner-helpers/deliverable.ts`)
 * hand kernel-observed text to the judgment backend:
 *
 *   1. Observation `content` can be `compressToolResult`'s over-budget output
 *      (`kernel/capabilities/attend/tool-formatting.ts`), which embeds a
 *      `[STORED: <key> | <tool>] ...` header and a trailing
 *      `use recall("<key>", ...)` instruction — a real capability claim only
 *      true for the agent's OWN reasoning loop (which has a scratchpad and a
 *      `recall` tool). The judgment backend has neither; passing that text
 *      through verbatim is a false capability claim. This is the exact
 *      defect `packages/runtime/src/judgment-context.ts`'s
 *      `truncateToolResult` already fixed on the `agent.judge({includeContext})`
 *      path — same problem, mirrored here for the kernel-internal shadow
 *      sites, which cannot import from `packages/runtime` (dependency runs
 *      the other way, see `AGENTS.md`'s package tree).
 *   2. Both sites bounded item COUNT, not item SIZE — a single tool
 *      observation or scratchpad payload can run into the thousands of
 *      characters, and grounding-fabrication's evidence in particular
 *      (`resolveUnconsumedEvidence`) joins full uncompressed scratchpad
 *      payloads with no cap at all.
 *
 * `sanitizeForJudgment` fixes both: strip the misleading capability-claim
 * lines, then apply a per-item char budget with an honest
 * "(truncated, N chars total)" marker — never a silent drop.
 */

/** Default per-item char budget when a call site doesn't pick its own. */
export const DEFAULT_JUDGMENT_TEXT_BUDGET = 800;

/**
 * Drop any line that is (or contains) a kernel-only capability claim the
 * judgment backend cannot act on: the `[STORED: <key> | <tool>]` header line,
 * and any line referencing `recall(` (the only tool that can read a STORED
 * payload back — a tool the judgment backend never has access to).
 */
export function stripKernelOnlyCapabilityClaims(content: string): string {
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (/^\[STORED:.*\]$/.test(trimmed)) return false;
      if (trimmed.includes("recall(")) return false;
      return true;
    })
    .join("\n")
    .trim();
}

/**
 * Honest byte-budget text preparation for a judgment-shadow prompt field:
 * strip kernel-only capability claims (see file header), then truncate to
 * `budget` chars with an explicit "(truncated, N chars total)" marker if the
 * (post-strip) content still exceeds it. Never silently drops meaning without
 * saying so.
 */
export function sanitizeForJudgment(
  content: string,
  budget: number = DEFAULT_JUDGMENT_TEXT_BUDGET,
): string {
  const stripped = stripKernelOnlyCapabilityClaims(content);
  if (stripped.length <= budget) return stripped;
  return `${stripped.slice(0, budget)} (truncated, ${stripped.length} chars total)`;
}
