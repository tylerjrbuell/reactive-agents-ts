/**
 * Prompt + reasoning + verification-step wither-body extractions
 * (WS-6 Phase 1 — prompt/reasoning bucket).
 *
 * Final tranche of high-yield wither bodies for Phase 1 — each extracts a
 * 3–5 line mutation block whose net delegation saves ~3 LOC in builder.ts.
 * Smaller bodies (2-line single-field setters) are deliberately left
 * inline; extracting them is LOC-negative once the helper module + import
 * cost is counted.
 */
import type { ReactiveAgentBuilder } from "../../builder.js";
import type { ReasoningOptions } from "../../types.js";
import { asBuilderState } from "./_state.js";

/**
 * Apply `.withSystemPrompt(prompt)` — set the custom system prompt and
 * return a harness registration callback that wires it into the
 * `prompt.system` chokepoint for Wave B+ pipeline integration. Mirrors
 * `applyHookRegistration` / `applyWithErrorHandler` shape — caller chains
 * the returned callback through `.withHarness(...)`.
 */
export const applyWithSystemPrompt = (
  builder: ReactiveAgentBuilder,
  prompt: string,
): ((h: import("@reactive-agents/core").Harness) => void) => {
  asBuilderState(builder)._systemPrompt = prompt;
  return (h) => h.on("prompt.system", () => prompt);
};

/**
 * Apply `.withReasoning(options)` — enable the reasoning layer and merge
 * options. Also propagates `options.maxIterations` to the top-level
 * `_maxIterations` field (explicit iteration override per the
 * most-restrictive resolution rule in `strategies/reactive.ts`).
 */
export const applyWithReasoning = (
  builder: ReactiveAgentBuilder,
  options?: ReasoningOptions,
): void => {
  const s = asBuilderState(builder);
  s._enableReasoning = true;
  if (options) s._reasoningOptions = options;
  if (options?.maxIterations !== undefined) s._maxIterations = options.maxIterations;
};

/**
 * Apply `.withVerificationStep(config)` — configure the post-result
 * verification pass (reflect mode — the only supported mode).
 */
export const applyWithVerificationStep = (
  builder: ReactiveAgentBuilder,
  config: { mode?: "reflect"; prompt?: string } = {},
): void => {
  asBuilderState(builder)._verificationStep = {
    mode: config.mode ?? "reflect",
    prompt: config.prompt,
  };
};

