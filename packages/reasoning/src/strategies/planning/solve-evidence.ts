// File: src/strategies/planning/solve-evidence.ts
//
// What a plan strategy's SOLVE (synthesizer) call is shown.
//
// The solver renders the final answer from the steps' full results. When those
// results exceed what the model can read, something has to give; cutting the
// joined text at a character limit drops whichever steps come last, however
// relevant. Selection is by STEP relevance instead, within a stated budget:
// steps are ranked by how much of the goal their title, instruction and result
// speak to, taken whole while they fit, and the one that crosses the budget is
// clipped only when a useful slice remains. Everything not shown is named in
// the prompt ("not shown"), and the selection is recorded on the trace
// (`solve-evidence` guard event), so a reader sees what the call actually saw.
import { Effect } from "effect";
import type { PlanStep } from "../../types/plan.js";
import { emitGuardFired } from "../../kernel/utils/diagnostics.js";

/** Trace `guard` name of the solve-evidence record. */
export const SOLVE_EVIDENCE_GUARD = "solve-evidence";

/** Smallest slice of a step result worth showing clipped (characters). */
export const MIN_CLIPPED_CHARS = 800;

/** One step's result as the solve call received it. */
export interface SolveEvidenceItem {
  readonly id: string;
  readonly title: string;
  /** Characters of the result shown. */
  readonly shown: number;
  /** Characters of the full result. */
  readonly of: number;
}

/** The selection: the prompt lines and what they stand for. */
export interface SolveEvidence {
  /** Evidence lines in plan order, then a "not shown" line when steps were left out. */
  readonly texts: readonly string[];
  readonly included: readonly SolveEvidenceItem[];
  /** Steps left out entirely. */
  readonly omitted: readonly { readonly id: string; readonly title: string }[];
  /** Characters of result shown. */
  readonly chars: number;
  /** The budget it was chosen within. */
  readonly budget: number;
}

type EvidenceStep = Pick<PlanStep, "id" | "title" | "instruction" | "result" | "fullResult">;

const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

/** How much of the goal's vocabulary a step's title, instruction and result opening speak to. */
const relevance = (goalWords: ReadonlySet<string>, s: EvidenceStep, text: string): number => {
  const own = words(`${s.title} ${s.instruction} ${text.slice(0, 400)}`);
  let hits = 0;
  for (const w of goalWords) if (own.has(w)) hits++;
  return hits;
};

/**
 * Choose the solve call's evidence from the completed steps (plan order).
 * Within `budgetChars` every result is shown whole, exactly as before; over it,
 * see the module header.
 */
export function selectSolveEvidence(
  goal: string,
  steps: readonly EvidenceStep[],
  budgetChars: number,
  /** Name each step's title in its line (`Step 1 (title): …`); false: `Step 1: …`. Default true. */
  titled = true,
): SolveEvidence {
  const items = steps.map((s, i) => ({ s, i, text: s.fullResult ?? s.result ?? "" }));
  const line = (i: number, title: string, body: string): string => `Step ${i + 1}${titled ? ` (${title})` : ""}: ${body}`;
  const total = items.reduce((n, it) => n + it.text.length, 0);
  if (total <= budgetChars) {
    return {
      texts: items.map((it) => line(it.i, it.s.title, it.text)),
      included: items.map((it) => ({ id: it.s.id, title: it.s.title, shown: it.text.length, of: it.text.length })),
      omitted: [],
      chars: total,
      budget: budgetChars,
    };
  }
  const goalWords = words(goal);
  const ranked = [...items].sort((a, b) => relevance(goalWords, b.s, b.text) - relevance(goalWords, a.s, a.text) || a.i - b.i);
  const shown = new Map<number, string>();
  const shownChars = new Map<number, number>();
  let used = 0;
  for (const it of ranked) {
    const room = budgetChars - used;
    if (it.text.length <= room) {
      shown.set(it.i, it.text);
      shownChars.set(it.i, it.text.length);
      used += it.text.length;
    } else if (room >= MIN_CLIPPED_CHARS) {
      shown.set(it.i, `${it.text.slice(0, room)} [clipped: ${room} of ${it.text.length} characters shown]`);
      shownChars.set(it.i, room);
      used += room;
    }
  }
  const kept = items.filter((it) => shown.has(it.i));
  const omitted = items.filter((it) => !shown.has(it.i)).map((it) => ({ id: it.s.id, title: it.s.title }));
  const texts = kept.map((it) => line(it.i, it.s.title, shown.get(it.i)!));
  if (omitted.length > 0) {
    texts.push(`Not shown (over the evidence budget): ${omitted.map((o) => o.title).join("; ")}. Say these were not covered rather than guessing their content.`);
  }
  return {
    texts,
    included: kept.map((it) => ({ id: it.s.id, title: it.s.title, shown: shownChars.get(it.i)!, of: it.text.length })),
    omitted,
    chars: used,
    budget: budgetChars,
  };
}

/** Record the selection on the trace (what the solve call saw), one `solve-evidence` event. */
export const emitSolveEvidence = (taskId: string, strategy: string, evidence: SolveEvidence): Effect.Effect<void, never> =>
  emitGuardFired({
    taskId,
    iteration: 0,
    guard: SOLVE_EVIDENCE_GUARD,
    outcome: evidence.omitted.length > 0 || evidence.included.some((i) => i.shown < i.of) ? "warn" : "pass",
    reason: `${strategy} solve saw ${evidence.included.length} step result(s), ${evidence.chars} of budget ${evidence.budget} characters, ${evidence.omitted.length} not shown`,
    metadata: { strategy, included: evidence.included, omitted: evidence.omitted, chars: evidence.chars, budget: evidence.budget },
  });
