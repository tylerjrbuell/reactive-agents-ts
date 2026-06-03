/**
 * Model + budget wither-body extractions (WS-6 Phase 1 — model/budget bucket).
 *
 * Hosts `.withModel()` (string / ModelParams overload bodies) and
 * `.withBudget()` (declarative budget caps consumed by the Arbitrator's
 * pre-intent guard — Issue #128 / North Star v5.0 Pillar 6).
 */
import type { ReactiveAgentBuilder, BudgetLimits } from "../../builder.js";
import type { ModelParams } from "../../types.js";
import { asBuilderState } from "./_state.js";

/**
 * Apply `.withModel(modelOrParams)` — set model id and optionally
 * `thinking` / `temperature` / `maxTokens` overrides from a `ModelParams`
 * object. String form sets only the model id.
 */
export const applyWithModel = (
  builder: ReactiveAgentBuilder,
  modelOrParams: string | ModelParams,
): void => {
  const s = asBuilderState(builder);
  if (typeof modelOrParams === "string") {
    s._model = modelOrParams;
    return;
  }
  s._model = modelOrParams.model;
  if (modelOrParams.thinking !== undefined) s._thinking = modelOrParams.thinking;
  if (modelOrParams.temperature !== undefined)
    s._temperature = modelOrParams.temperature;
  if (modelOrParams.maxTokens !== undefined)
    s._maxTokens = modelOrParams.maxTokens;
  if (modelOrParams.numCtx !== undefined)
    s._numCtx = modelOrParams.numCtx;
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
  if (limits.tokenLimit === undefined && limits.costLimit === undefined) {
    throw new Error(
      "withBudget() requires at least one of `tokenLimit` or `costLimit`.",
    );
  }
  asBuilderState(builder)._budgetLimits = {
    ...(limits.tokenLimit !== undefined ? { tokenLimit: limits.tokenLimit } : {}),
    ...(limits.costLimit !== undefined ? { costLimit: limits.costLimit } : {}),
    ...(limits.warningRatio !== undefined
      ? { warningRatio: limits.warningRatio }
      : {}),
  };
};

