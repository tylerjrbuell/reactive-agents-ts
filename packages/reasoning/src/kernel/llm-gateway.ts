/**
 * LLM Gateway — the single mediated path for every direct model call in the
 * reasoning/runtime layers (Adaptive Harness Overhaul Phase 1, pillar 2,
 * 2026-07-07).
 *
 * Call sites state INTENT (purpose + budget class); the gateway decides the
 * output-token budget. Before this module, twelve call sites hardcoded flat
 * `maxTokens` literals (4096 / THINKING_SAFE_MIN_TOKENS / ad-hoc math) — the
 * root cause behind the qwen3:14b empty-turn starvation fixed tactically by
 * B2/P1 in the 2026-07-07 fix waves. The tier table + thinking allowance that
 * lived inline in `reason/think.ts` now live here as the one budget authority.
 *
 * Division of labor with the provider layer:
 *  - Gateway (here): resolves the ANSWER budget the caller intends
 *    (tier-adaptive for loop turns, class-based for aux calls).
 *  - Provider (llm-provider): owns thinking-mode widening/reserve on top of
 *    the requested budget (`widenNumPredictForThinking`, `reserveThinkingBudget`)
 *    and capability clamping (`maxOutputTokens`).
 *  The kernel-side `thinkingAllowance` for `purpose: "think"` is retained from
 *  B2 verbatim (bench-validated at re-runs #2/#3) even though the local
 *  provider also widens — deliberate: shrinking the effective think budget is
 *  a behavior change that must go through the bench, not a refactor.
 *
 * Observability is unchanged: calls still flow through the observable-llm
 * wrapper below this module (it wraps LLMService itself), so every gateway
 * call emits `LLMExchangeEmitted` exactly as before.
 *
 * Enforcement: `scripts/check-llm-gateway.sh` greps for raw `.complete({` /
 * `.stream({` outside this module; new call sites must route through
 * `gatewayComplete` / `gatewayStream`.
 */

import type { Effect, Stream } from "effect";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMService,
  LLMErrors,
  StreamEvent,
} from "@reactive-agents/llm-provider";
import { THINKING_SAFE_MIN_TOKENS } from "./utils/stream-parser.js";

/** What the call is FOR — drives the default budget class. */
export type LlmPurpose =
  | "think" // main-loop reasoning turn (tier-adaptive budget)
  | "plan" // decompose a goal into steps
  | "synthesize" // combine evidence into a final answer
  | "extract" // pull structured data out of text
  | "classify" // small routing/labelling decision
  | "verify"; // critique / grounding check

/**
 * How much room the answer needs.
 *  - terse:    one-liners, labels, verdicts (THINKING_SAFE_MIN_TOKENS = 2048)
 *  - standard: prose answers, plans, synthesis (4096)
 *  - generous: long-form multi-section output (8192)
 *  - provider-default: omit maxTokens entirely — the provider's
 *    defaultMaxTokens applies. Exists so legacy sites that never set a budget
 *    migrate behavior-identically; new call sites should state a real class.
 */
export type BudgetClass = "terse" | "standard" | "generous" | "provider-default";

export interface LlmCallIntent {
  readonly purpose: LlmPurpose;
  /** Override the purpose's default budget class. */
  readonly budgetClass?: BudgetClass;
  /**
   * Explicit token budget — wins over class resolution. The escape hatch for
   * genuinely computed budgets (ToT breadth math, kernel pressure overrides,
   * caller-supplied structured-output budgets). Use sparingly; every use is a
   * budget decision made outside the gateway.
   */
  readonly budgetTokens?: number;
  /** Context-profile tier ("local" | "mid" | "large" | "frontier") — enables tier-adaptive think budgets. */
  readonly tier?: string;
  /** Whether the resolved model runs a thinking mode (profile.thinkingModel). */
  readonly thinkingModel?: boolean;
}

/**
 * Tier-adaptive budget for main-loop think turns — moved verbatim from
 * `reason/think.ts` (B2). Frontier models get more room for sophisticated
 * reasoning; local models are capped to avoid wasted tokens.
 */
const TIER_THINK_BUDGET: Record<string, number> = {
  local: 1200,
  mid: 2000,
  large: 3000,
  frontier: 4000,
};
const TIER_THINK_FALLBACK = 1500;

/**
 * B2: thinking models spend their num_predict budget inside <think> before any
 * visible content — a flat tier cap yields empty max_tokens turns that thrash
 * Stage-1 escalation (bench: two 2000-token empty turns = ~148s of a 420s
 * budget). Give them room for think + answer.
 */
const THINK_MODEL_ALLOWANCE = 6000;

const CLASS_BUDGET: Record<Exclude<BudgetClass, "provider-default">, number> = {
  terse: THINKING_SAFE_MIN_TOKENS,
  standard: 4096,
  generous: 8192,
};

/** Default budget class per purpose when the intent names neither class nor tokens. */
const PURPOSE_DEFAULT_CLASS: Record<LlmPurpose, BudgetClass> = {
  think: "standard", // only used when tier is absent; tier-adaptive path preferred
  plan: "standard",
  synthesize: "standard",
  extract: "standard",
  classify: "terse",
  verify: "terse",
};

/**
 * Resolve the output-token budget for an intent. Returns `undefined` only for
 * `budgetClass: "provider-default"` (omit maxTokens on the wire).
 *
 * Precedence: explicit budgetTokens → tier-adaptive (purpose "think" with a
 * tier) → budgetClass → purpose default class.
 */
export function resolveOutputBudget(intent: LlmCallIntent): number | undefined {
  if (intent.budgetTokens !== undefined) return intent.budgetTokens;
  if (intent.budgetClass === "provider-default") return undefined;
  if (intent.purpose === "think" && intent.budgetClass === undefined && intent.tier !== undefined) {
    const base = TIER_THINK_BUDGET[intent.tier] ?? TIER_THINK_FALLBACK;
    return base + (intent.thinkingModel ? THINK_MODEL_ALLOWANCE : 0);
  }
  const cls = intent.budgetClass ?? PURPOSE_DEFAULT_CLASS[intent.purpose];
  return cls === "provider-default" ? undefined : CLASS_BUDGET[cls];
}

/** A CompletionRequest whose budget the gateway owns. */
export type GatewayRequest = Omit<CompletionRequest, "maxTokens">;

type LLMServiceShape = LLMService["Type"];

/**
 * Mediated `complete()` — resolves the budget from intent, delegates to the
 * provided LLMService. Identical error/response types to `llm.complete`.
 */
export function gatewayComplete(
  llm: LLMServiceShape,
  intent: LlmCallIntent,
  request: GatewayRequest,
): Effect.Effect<CompletionResponse, LLMErrors> {
  const budget = resolveOutputBudget(intent);
  return llm.complete(
    budget === undefined ? (request as CompletionRequest) : { ...request, maxTokens: budget },
  );
}

/**
 * Mediated `stream()` — same contract as {@link gatewayComplete} for the
 * streaming path (kernel think turns).
 */
export function gatewayStream(
  llm: LLMServiceShape,
  intent: LlmCallIntent,
  request: GatewayRequest,
): Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors> {
  const budget = resolveOutputBudget(intent);
  return llm.stream(
    budget === undefined ? (request as CompletionRequest) : { ...request, maxTokens: budget },
  );
}
