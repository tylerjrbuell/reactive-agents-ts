// File: src/kernel/capabilities/reflect/strategy-ladder.ts
//
// W4.5 — deterministic strategy escalation. When the loop detector trips, the
// DEFAULT switch path walks a FIXED ladder (reactive → plan-execute-reflect →
// reflexion) with ZERO extra LLM call. The LLM strategy-evaluator round-trip is
// reserved for MULTI-CANDIDATE configs — callers that explicitly supply a custom
// candidate set wanting the model to choose among them.
//
// WHY: the default path used to pay a `classify`-purpose LLM round-trip mid-run
// (the live post-w1 traces show it firing on local arms), and the switch reason
// was a free-text description rather than a stable pattern id. A deterministic
// ladder removes the cost AND makes the escalation reproducible.
//
// The candidate list is the REAL registered kernel strategies (a subset of
// `StrategyRegistryLive`): reactive, plan-execute-reflect, reflexion,
// tree-of-thought. Before this, only `reactive` hardcoded a candidate list; the
// other kernel strategies defaulted to `[]`, so the evaluator short-circuited
// dead. This module is the single source for both the ladder and the candidates.
//
// Pure / synchronous / no Effect / no state.

/** The real registered KERNEL strategies (subset of StrategyRegistryLive). */
export const KERNEL_STRATEGY_CANDIDATES: readonly string[] = [
  "reactive",
  "plan-execute-reflect",
  "reflexion",
  "tree-of-thought",
];

/**
 * The fixed escalation ladder, walked in order. `reactive` is the default
 * starting strategy; the first switch goes to `plan-execute-reflect`, the
 * second to `reflexion`.
 */
export const DEFAULT_STRATEGY_LADDER: readonly string[] = [
  "reactive",
  "plan-execute-reflect",
  "reflexion",
];

/**
 * Is this candidate list the canonical kernel set (i.e. the default)? An
 * explicitly-supplied list that is NOT the canonical set is a MULTI-CANDIDATE
 * config — the caller wants the LLM evaluator to choose among the candidates.
 */
export function isDefaultCandidateSet(list: readonly string[]): boolean {
  if (list.length !== KERNEL_STRATEGY_CANDIDATES.length) return false;
  const set = new Set(list);
  return KERNEL_STRATEGY_CANDIDATES.every((c) => set.has(c));
}

/**
 * The next strategy from the fixed ladder: the first ladder entry not yet tried
 * and present in `candidates`, else the first untried candidate, else null (no
 * untried strategy remains). Deterministic — zero LLM.
 */
export function selectLadderStrategy(
  triedStrategies: readonly string[],
  candidates: readonly string[],
): string | null {
  const available = candidates.filter((c) => !triedStrategies.includes(c));
  for (const s of DEFAULT_STRATEGY_LADDER) {
    if (available.includes(s)) return s;
  }
  return available[0] ?? null;
}
