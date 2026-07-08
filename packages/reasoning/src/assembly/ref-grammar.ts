// File: src/assembly/ref-grammar.ts
//
// The ONE ref grammar (Wave C / task C3, audit 03-#14 + H2 generalization).
//
// Before this module three grammars for "point at stored evidence" lived in
// three places and drifted:
//   1. projector previews   — result-store.ts rendered `recall("<ref>", …)` and
//                             `result_ref="<ref>"` markers inline.
//   2. the recall gate      — think-guards.ts owned `SURFACED_RECALL_KEY`
//                             (`/recall\("[^"]+"/`), the matcher that decides
//                             whether `recall` is offered to the model.
//   3. from_step            — plan.ts / blueprint each carried their own copy of
//                             `/\{\{from_step:(s\d+)(?::summary|:full)?\}\}/g`.
//
// H2 (2026-07-08 sweep) aligned ONE path — the scratchpad-backed preview — so the
// projector emitted a `recall("<ref>"…)` marker the gate could see. C3
// generalizes that fix: this module is the SINGLE place that MINTS a recall
// pointer (`renderRecallHint`) and the SINGLE matcher the gate uses
// (`SURFACED_RECALL_REF`). Because both come from here, the invariant is true by
// construction: EVERY recall pointer the projector renders is matched by the gate
// (see ref-grammar.test.ts round-trip property). Combined with result-store only
// rendering a recall pointer for RECALLABLE refs, every recall ref emitted into a
// prompt is resolvable — no dead pointers (the disease H2 partially fixed).
//
// Pure — no deps, no state, no I/O. Regexes with the `g` flag are exposed as
// FACTORIES (fresh RegExp per call) so a shared `lastIndex` never leaks between
// callers.

// ─── Recallable-ref namespace ────────────────────────────────────────────────
//
// The `recall` meta-tool resolves against the live run scratchpad. Only keys in
// this namespace (`_tool_result_N`, minted when a tool result is auto-stored)
// are resolvable by it. Content-hash refs minted by `ResultStore.put` (`res_*`)
// live only in the per-render store — they are NOT recallable and MUST NOT be
// rendered as a recall pointer (that recreates the blind-recall lure).

/** Prefix of the recallable (scratchpad-backed) ref namespace. */
export const SCRATCHPAD_REF_PREFIX = "_tool_result_";

/** Mint the Nth canonical recallable ref. The single mint site for these keys. */
export const mintScratchpadRef = (n: number): string => `${SCRATCHPAD_REF_PREFIX}${n}`;

/** True iff `ref` belongs to the recallable (scratchpad) namespace — i.e. the
 *  `recall` meta-tool can resolve it. Non-recallable refs (`res_*`) must never
 *  be surfaced as a recall pointer. */
export const isRecallableRef = (ref: string): boolean =>
  ref.startsWith(SCRATCHPAD_REF_PREFIX);

// ─── Recall pointer: mint + match (the H2 vocabulary, generalized) ────────────

/** How a surfaced recall pointer tells the model to re-read the stored data. */
export type RecallMode = "full" | "segment";

/**
 * Render the canonical recall pointer for `ref`. THE ONE MINTER — every
 * `recall("…")` pointer the projector puts into a prompt comes from here, so the
 * gate matcher below always matches it (round-trip invariant).
 *   - "full"    → `recall("<ref>", full: true)`
 *   - "segment" → `recall("<ref>", start: 0, maxChars: 2000)`
 */
export const renderRecallHint = (ref: string, mode: RecallMode = "full"): string =>
  mode === "segment"
    ? `recall("${ref}", start: 0, maxChars: 2000)`
    : `recall("${ref}", full: true)`;

/**
 * THE ONE MATCHER the recall-overflow gate uses. Matches ANY harness-surfaced
 * recall pointer inside a tool_result, in any argument shape. Kept as a single
 * source so the gate and the minter can never drift (think-guards imports this).
 */
export const SURFACED_RECALL_REF = /recall\("[^"]+"/;

/** Extract every surfaced recall ref KEY from text (any namespace). */
export const surfacedRecallRefs = (text: string): readonly string[] =>
  [...text.matchAll(/recall\("([^"]+)"/g)].map((m) => m[1]!);

/**
 * Scratchpad-scoped surfaced-ref matcher (global). Used by the resolver in
 * state-queries.ts, which can only resolve keys that are actually in the
 * scratchpad — hence the narrower namespace capture. Built from the prefix so it
 * tracks the grammar. Returns a FRESH RegExp (stateful `g` flag).
 */
export const scratchpadRecallRefRe = (): RegExp =>
  new RegExp(`recall\\("(${SCRATCHPAD_REF_PREFIX}\\d+)"`, "g");

// ─── from_step template grammar (plan-execute / blueprint chained args) ───────

/** Source of the `{{from_step:sN(:summary|:full)?}}` grammar. */
export const FROM_STEP_PATTERN = String.raw`\{\{from_step:(s\d+)(?::summary|:full)?\}\}`;

/** A FRESH global RegExp for the from_step grammar (stateful `g` flag). */
export const fromStepRe = (): RegExp => new RegExp(FROM_STEP_PATTERN, "g");

/** Render a from_step reference. The mint counterpart of {@link fromStepRe}. */
export const renderFromStepRef = (
  stepId: string,
  mode?: "summary" | "full",
): string => (mode ? `{{from_step:${stepId}:${mode}}}` : `{{from_step:${stepId}}}`);
