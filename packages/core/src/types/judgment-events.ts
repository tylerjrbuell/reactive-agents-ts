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
