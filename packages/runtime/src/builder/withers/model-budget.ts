/**
 * Model + budget wither-body extractions (WS-6 Phase 1 — model/budget bucket).
 *
 * Hosts `.withModel()` (string / ModelParams overload bodies) and
 * `.withBudget()` (declarative budget caps consumed by the Arbitrator's
 * pre-intent guard — Issue #128 / North Star v5.0 Pillar 6).
 */
import type { ReactiveAgentBuilder, BudgetLimits } from "../../builder.js";
import type { ModelParamsInput } from "../../types.js";
import type { ThinkingOptions } from "@reactive-agents/llm-provider";
import { asBuilderState } from "./_state.js";

/**
 * Apply `.withModel(modelOrParams)` — set model id and optionally
 * `thinking` / `temperature` / `maxTokens` / `numCtx` overrides from a
 * `ModelParams` object. String form sets only the model id. The object form
 * may omit `model` (only a falsy/absent model leaves the provider default in
 * place) so params can be applied without pinning a model.
 */
export const applyWithModel = (
  builder: ReactiveAgentBuilder,
  modelOrParams: string | ModelParamsInput,
): void => {
  const s = asBuilderState(builder);
  if (typeof modelOrParams === "string") {
    s._model = modelOrParams;
    return;
  }
  if (modelOrParams.model) s._model = modelOrParams.model;
  if (modelOrParams.thinking !== undefined) s._thinking = modelOrParams.thinking;
  if (modelOrParams.temperature !== undefined)
    s._temperature = modelOrParams.temperature;
  if (modelOrParams.maxTokens !== undefined)
    s._maxTokens = modelOrParams.maxTokens;
  if (modelOrParams.numCtx !== undefined)
    s._numCtx = modelOrParams.numCtx;
};

/**
 * Apply `.withThinking(options?)` — the rich-config home for thinking mode.
 * `true`/absent → enable; `false` → disable; object → enable with effort/budget.
 * Writes both the `_thinking` boolean (quick path parity) and `_thinkingOptions`.
 */
export const applyWithThinking = (
  builder: ReactiveAgentBuilder,
  options?: boolean | ThinkingOptions,
): void => {
  const s = asBuilderState(builder);
  if (options === false) {
    s._thinking = false;
    s._thinkingOptions = { enabled: false };
    return;
  }
  if (options === undefined || options === true) {
    s._thinking = true;
    s._thinkingOptions = { enabled: true };
    return;
  }
  const enabled = options.enabled !== false;
  s._thinking = enabled;
  s._thinkingOptions = { ...options, enabled };
};

/**
 * Apply `.withBudget(limits)` — set declarative budget caps. Throws when
 * neither `tokenLimit` nor `costLimit` is supplied. Field-narrows the
 * stored value so undefined entries are omitted (downstream
 * `RuntimeOptions.budgetLimits` consumer treats omission as "no cap").
 */
export const applyWithBudget = (
  builder: ReactiveAgentBuilder,
  limits: BudgetLimits,
): void => {
  const s = asBuilderState(builder);
  const hasSpendCap =
    limits.tokenLimit !== undefined || limits.costLimit !== undefined;
  const hasExecCap =
    limits.maxIterations !== undefined ||
    limits.minIterations !== undefined ||
    limits.timeout !== undefined ||
    limits.llmTimeout !== undefined;
  if (!hasSpendCap && !hasExecCap) {
    throw new Error(
      "withBudget() requires at least one of `tokenLimit`, `costLimit`, " +
        "`maxIterations`, `minIterations`, `timeout`, or `llmTimeout`.",
    );
  }
  // Spend caps — only set the budget-limits slot when a spend cap is present, so
  // an execution-only budget call does not create an empty (no-cap) limits object.
  if (hasSpendCap) {
    s._budgetLimits = {
      ...(limits.tokenLimit !== undefined ? { tokenLimit: limits.tokenLimit } : {}),
      ...(limits.costLimit !== undefined ? { costLimit: limits.costLimit } : {}),
      ...(limits.warningRatio !== undefined
        ? { warningRatio: limits.warningRatio }
        : {}),
    };
  }
  // Execution-cap folds (audit #9) — route to the SAME slots the standalone
  // withers set, so both spellings serialize identically.
  if (limits.maxIterations !== undefined) s._maxIterations = limits.maxIterations;
  if (limits.minIterations !== undefined) s._minIterations = limits.minIterations;
  if (limits.timeout !== undefined) s._executionTimeoutMs = limits.timeout;
  if (limits.llmTimeout !== undefined) s._ollamaTimeoutMs = limits.llmTimeout;
};

