/**
 * Wither-body extractions for ReactiveAgentBuilder (W26-B-2 step 2).
 *
 * Each `applyXyzOptions(builder, opts)` mutates the builder's private fields
 * and returns void. The corresponding `withXyz()` method becomes a thin
 * wrapper: call the helper, return `this`.
 *
 * Mutation is intentional — withers are documented to mutate `this` in place
 * and return `this` for chaining. The boundary cast (`builder as unknown as
 * BuilderState`) types the private-field access so this file isn't littered
 * with `(this as any)._field`.
 */
import type { ReactiveAgentBuilder } from "../builder.js";
import type { LifecycleHook } from "../types.js";
import type { MemoryOptions } from "./types.js";
import { invokeUserHookSafely } from "./api-surface.js";
import { asBuilderState } from "./withers/_state.js";

// `asState` is a re-name shim onto the shared `asBuilderState` helper
// (`builder/withers/_state.ts`). WS-6 Phase 1 collapses this file's local
// cast into the shared module so adding new wither-bucket files is cast-budget
// neutral against the §5.5 `as unknown as` ceiling.
const asState = asBuilderState;

/**
 * Apply `.withReactiveIntelligence(arg)` configuration. Handles both the
 * boolean toggle form and the object form (which may carry RI-only fields
 * mixed with handler callbacks, constraints, and autonomy).
 */
export const applyReactiveIntelligenceOptions = (
  builder: ReactiveAgentBuilder,
  arg?:
    | boolean
    | (Partial<
        import("@reactive-agents/reactive-intelligence").ReactiveIntelligenceConfig
      > &
        Record<string, any>),
): void => {
  const state = asState(builder);
  if (typeof arg === "boolean") {
    state._enableReactiveIntelligence = arg;
    return;
  }
  state._enableReactiveIntelligence = true;
  if (!arg) return;
  const {
    onEntropyScored,
    onControllerDecision,
    onSkillActivated,
    onSkillRefined,
    onSkillConflict,
    onMidRunAdjustment,
    constraints,
    autonomy,
    ...riConfig
  } = arg as any;
  state._reactiveIntelligenceOptions = riConfig;
  if (
    onEntropyScored ||
    onControllerDecision ||
    onSkillActivated ||
    onSkillRefined ||
    onSkillConflict ||
    onMidRunAdjustment
  ) {
    state._riHooks = {
      onEntropyScored,
      onControllerDecision,
      onSkillActivated,
      onSkillRefined,
      onSkillConflict,
      onMidRunAdjustment,
    };
  }
  if (constraints) state._riConstraints = constraints;
  if (autonomy) state._riAutonomy = autonomy;
};

/**
 * Apply `.withMemory(arg)` configuration. Handles the legacy string-tier form
 * (with deprecation warning) and the object form.
 */
export const applyMemoryOptions = (
  builder: ReactiveAgentBuilder,
  tierOrOptions?: "1" | "2" | MemoryOptions,
): void => {
  const state = asState(builder);
  state._enableMemory = true;
  if (typeof tierOrOptions === "string") {
    const newForm =
      tierOrOptions === "2"
        ? '.withMemory({ tier: "enhanced" })'
        : ".withMemory()";
    console.warn(
      `⚠ withMemory("${tierOrOptions}") is deprecated. Use ${newForm} instead.`,
    );
    state._memoryTier = tierOrOptions;
    return;
  }
  if (!tierOrOptions) return;
  if (tierOrOptions.tier) {
    state._memoryTier = tierOrOptions.tier === "enhanced" ? "2" : "1";
  }
  state._memoryOptions = tierOrOptions;
  // Consolidation folds (audit #5): the sub-options route to the SAME state
  // slots as the standalone `.withExperienceLearning()` /
  // `.withMemoryConsolidation()` withers — one state slot, one serialization
  // path. Only set when explicitly provided (last-call-wins; absent = unchanged).
  if (tierOrOptions.experienceLearning !== undefined) {
    state._enableExperienceLearning = tierOrOptions.experienceLearning;
  }
  if (tierOrOptions.memoryConsolidation !== undefined) {
    state._enableMemoryConsolidation = tierOrOptions.memoryConsolidation;
  }
};

/**
 * Apply `.withHook(hook)` registration. Pushes the hook onto the builder's
 * lifecycle list AND mirrors it as a harness phase hook for compose-side
 * observability. Returns a callback to register the harness side (caller
 * invokes via `builder.withHarness(...)` to keep the chaining contract).
 */
export const applyHookRegistration = (
  builder: ReactiveAgentBuilder,
  hook: LifecycleHook,
): ((
  h: import("@reactive-agents/core").Harness,
) => void) => {
  asState(builder)._hooks.push(hook);

  // Harness registration callback — caller passes to .withHarness(...).
  if (hook.timing === "on-error") {
    return (h) => {
      h.onError(
        hook.phase as import("@reactive-agents/core").Phase,
        async (_err, ctx) => {
          await invokeUserHookSafely(builder, hook, ctx);
        },
      );
    };
  }
  const kind = hook.timing === "before" ? "before" : "after";
  return (h) => {
    h[kind](
      hook.phase as import("@reactive-agents/core").Phase,
      async (ctx) => {
        await invokeUserHookSafely(builder, hook, ctx);
      },
    );
  };
};
