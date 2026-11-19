/**
 * Model + budget wither-body extractions (WS-6 Phase 1 — model/budget bucket).
 *
 * Hosts `.withModel()` (string / ModelParams overload bodies) and
 * `.withBudget()` (declarative budget caps consumed by the Arbitrator's
 * pre-intent guard — Issue #128 / North Star v5.0 Pillar 6).
 */
import type { ReactiveAgentBuilder, BudgetLimits } from "../../builder.js";
import { ModelParamsSchema, type ModelParamsInput } from "../../types.js";
import { ModelOptionError } from "../../errors.js";
import type { ThinkingOptions } from "@reactive-agents/llm-provider";
import { asBuilderState } from "./_state.js";

/** Keys `.withModel()` accepts in a params object (one source: the schema). */
const MODEL_PARAM_KEYS: ReadonlySet<string> = new Set(Object.keys(ModelParamsSchema.fields));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validate a `.withModel()` params object: a plain object whose keys are all
 * `ModelParams` fields. `allowModel` is false for the `(model, params)` form,
 * where the id comes from the first argument. Throws `ModelOptionError` so a
 * typo (`num_ctx`) or a stray value fails at the call instead of being dropped.
 */
const assertModelParams = (
  value: unknown,
  argument: "modelOrParams" | "params",
  allowModel: boolean,
): ModelParamsInput => {
  if (!isPlainObject(value)) {
    throw new ModelOptionError({
      argument,
      message: `withModel(): \`${argument}\` must be ${argument === "params" ? "a params object" : "a model id string or a params object"}, got ${value === null ? "null" : Array.isArray(value) ? "an array" : typeof value}.`,
    });
  }
  const unknown = Object.keys(value).filter(
    (key) => !MODEL_PARAM_KEYS.has(key) || (key === "model" && !allowModel),
  );
  if (unknown.length > 0) {
    const allowed = [...MODEL_PARAM_KEYS].filter((key) => allowModel || key !== "model");
    throw new ModelOptionError({
      argument,
      message: `withModel(): unknown ${argument} key(s) ${unknown.map((k) => `\`${k}\``).join(", ")}; accepted keys: ${allowed.join(", ")}.`,
    });
  }
  return value as ModelParamsInput;
};

/**
 * Apply `.withModel(modelOrParams, params?)` — set model id and optionally
 * `thinking` / `temperature` / `maxTokens` / `numCtx` overrides. Three
 * spellings, one code path:
 * - `("m")` sets only the model id.
 * - `("m", { numCtx })` is exactly `({ model: "m", numCtx })`.
 * - `({ ... })` may omit `model` (only a falsy/absent model leaves the
 *   provider default in place) so params apply without pinning a model.
 *
 * Throws `ModelOptionError` for a first argument that is neither a string nor
 * a params object, a second argument after the object form, a non-object
 * `params`, or any key that is not a `ModelParams` field.
 */
export const applyWithModel = (
  builder: ReactiveAgentBuilder,
  modelOrParams: string | ModelParamsInput,
  params?: Omit<ModelParamsInput, "model">,
): void => {
  if (typeof modelOrParams === "string") {
    if (params === undefined) {
      asBuilderState(builder)._model = modelOrParams;
      return;
    }
    const overrides = assertModelParams(params, "params", false);
    applyModelParams(builder, { ...overrides, model: modelOrParams });
    return;
  }
  const merged = assertModelParams(modelOrParams, "modelOrParams", true);
  if (params !== undefined) {
    throw new ModelOptionError({
      argument: "params",
      message:
        "withModel(): a second argument is only accepted after a model id string; put the fields in the params object instead.",
    });
  }
  applyModelParams(builder, merged);
};

const applyModelParams = (
  builder: ReactiveAgentBuilder,
  modelOrParams: ModelParamsInput,
): void => {
  const s = asBuilderState(builder);
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

