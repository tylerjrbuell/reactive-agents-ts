// File: src/kernel/capabilities/decide/authority.ts
//
// AuthorityClass — the precedence law of the harness control plane (north-star
// spec 2026-07-11 §3, gap row 3). Every control actor (termination evaluator,
// harness signal, gate redirect, guard fire, strategy switch) carries a typed
// authority class so the kernel can enforce ONE rule structurally:
//
//   Deterministic fact  → LAW. May override the model.
//   Model-grade judgment → may override an equal-or-weaker signal.
//   Lexical/statistical  → ADVISORY ONLY. NEVER the final termination authority.
//
// The minimum honest slice (this module + arbitrator wiring): the two lexical
// terminators identified in spec §1a — content-stability (Levenshtein) and the
// final-answer regex — are annotated lexical, and on a contract-bearing run
// they are structurally prevented from terminating around the terminal gate
// (they become candidate-answer PROPOSALS routed THROUGH it). See
// `contractCoverageProposal` in arbitrator.ts. Other actors are annotated where
// cheap so every intervention on the receipt (§5b) can name its authority.

/** The three authority classes of the override rule (spec §3 table). */
export type AuthorityClass = "deterministic" | "model-grade" | "lexical";

/**
 * Actor name → authority class. Keys are the stable actor identifiers used by
 * termination evaluators (`TerminationSignalEvaluator.name`), harness-signal
 * emitters, and gate redirects. Unknown actors default to `model-grade` — the
 * conservative middle: an unclassified actor is neither granted deterministic
 * law nor stripped of all authority, so a forgotten annotation cannot silently
 * promote a heuristic to law NOR silently mute a real signal.
 */
const AUTHORITY_BY_ACTOR: Readonly<Record<string, AuthorityClass>> = {
  // ── Lexical / statistical heuristics (spec §3: NEVER override) ─────────────
  ContentStability: "lexical", // normalized Levenshtein of consecutive thoughts
  FinalAnswerRegex: "lexical", // "FINAL ANSWER:" prefix detection
  EntropyConvergence: "lexical", // entropy-derivative statistical proxy
  "content-stability": "lexical",
  "final-answer-regex": "lexical",

  // ── Model-grade judgments (may override equal-or-weaker) ───────────────────
  LLMEndTurn: "model-grade", // the model chose to stop
  ReactiveControllerEarlyStop: "model-grade",
  ControllerSignalVeto: "model-grade",
  "reflect-verdict": "model-grade",
  "strategy-switch": "model-grade",

  // ── Deterministic facts (law — enforced at the boundary) ───────────────────
  PendingToolCall: "deterministic",
  budget: "deterministic",
  "terminal-gate:coverage": "deterministic", // contract requirement satisfaction
  "terminal-gate:grounding": "deterministic", // substantive tool-call presence
  "post-condition-steer": "deterministic",
  "grounding-redirect": "deterministic",
  "budget-exceeded": "deterministic",
};

/** Resolve an actor's authority class (default `model-grade` — see above). */
export function authorityOf(actor: string): AuthorityClass {
  return AUTHORITY_BY_ACTOR[actor] ?? "model-grade";
}

/** True iff the actor is a lexical/statistical heuristic (spec §3 bottom row). */
export function isLexicalAuthority(actor: string): boolean {
  return authorityOf(actor) === "lexical";
}
