import type { ResultStore } from "./result-store.js";

/**
 * Single-shot result projector — substrate unification (#2 / leg b, 2026-05-31).
 *
 * The non-reactive strategies (plan-execute / ToT / reflexion) inject prior tool
 * results into SINGLE-SHOT prompts (step execution, reflection, thought-gen). They
 * are not conversation threads, so `project()` (the thread assembler) does not
 * apply — but their result-injection MUST use the SAME projection policy as the
 * reactive seam, or two parallel substrates ship (the split this #2 closes).
 *
 * Before: `compressToolResult(...)` + a scratchpad-pointer format.
 * After:  this — `ResultStore.preview()` (the #1 structure-aware bounded preview +
 *         honest truncation marker + `result_ref`), one ResultStore, one pointer
 *         namespace. The ref a planner emits resolves via the same
 *         `materialize`/`write_result_to_file(result_ref=…)` path reactive uses.
 *
 * Pure w.r.t. inputs; the only effect is the idempotent `put` into the caller's
 * run-scoped store (content-addressed → identical values share one ref, no dup).
 */
export function projectResultForPrompt(
  store: ResultStore,
  tool: string,
  value: unknown,
  budgetChars: number,
): { ref: string; text: string } {
  const ref = store.put(tool, value);
  return { ref, text: store.preview(ref, budgetChars) };
}
