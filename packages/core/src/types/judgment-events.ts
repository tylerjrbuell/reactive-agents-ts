/**
 * Judgment primitive events (`@reactive-agents/judgment`).
 * These are added to the AgentEvent union in event-bus.ts.
 *
 * Observability for the typed judgment layer (Choice/Score/Noul over a
 * `JudgmentBackend`, e.g. TypeSafe/Jev): every `JudgmentService.ask()` call
 * emits `JudgmentEvaluated` on success and `JudgmentFailed` on any backend
 * error, at the `site` naming which consumer made the call ("strategy-
 * selection", "task-comprehension", "guardrail-battery", "eval:relevance",
 * etc). Values, probabilities, and confidence are carried for shadow-mode
 * agreement analysis and the eval variance layer — the API key is never
 * attached to either event.
 */

export type JudgmentEvaluated = {
  readonly _tag: "JudgmentEvaluated";
  /** Which consumer/integration made this call, e.g. "strategy-selection", "eval:relevance". */
  readonly site: string;
  /** Which backend answered — "jev", "llm", or a future third provider's name. */
  readonly backend: string;
  /** Question ids answered, each with its kind/value/probabilities/confidence, serialized for the event bus. */
  readonly answers: ReadonlyArray<{
    readonly id: string;
    readonly kind: "noul" | "choice" | "score";
    readonly value: string | number | boolean;
    readonly confidence?: number;
    readonly calibrated?: boolean;
  }>;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
};

export type JudgmentFailed = {
  readonly _tag: "JudgmentFailed";
  readonly site: string;
  readonly backend: string;
  /** The `JudgmentError` tag, e.g. "JudgmentTimeout", "JudgmentUnauthorized". */
  readonly errorTag: string;
  readonly message: string;
  readonly latencyMs: number;
};

/**
 * Fired by a runtime site running Jev in SHADOW mode (Phase C: strategy-
 * selection, complexity-router, etc) — Jev's answer is computed but never
 * consumes the decision actually made. Distinct from `JudgmentEvaluated`
 * (which reports on every `JudgmentService.ask()` call at whatever site name
 * the layer was constructed with) because shadow analysis needs the current
 * heuristic/LLM decision and an agreement verdict alongside Jev's answer,
 * correlated per real production call — not reconstructable from
 * `JudgmentEvaluated` alone.
 */
export type JudgmentShadow = {
  readonly _tag: "JudgmentShadow";
  /** Which shadow site fired, e.g. "strategy-selection", "complexity-router". */
  readonly site: string;
  /** Jev's answer, or `null` if the call failed/timed out. */
  readonly jev: string | null;
  /** The decision actually used (from the existing heuristic/LLM path), unaffected by `jev`. */
  readonly current: string;
  /** `jev === current`, or `null` when `jev` is null (no answer to compare). */
  readonly agreement: boolean | null;
};
