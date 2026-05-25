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
import type { LifecycleHook, ReasoningOptions } from "../types.js";
import type { MemoryOptions } from "./types.js";
import { invokeUserHookSafely } from "./api-surface.js";
import type { RiHooks } from "./ri-wiring.js";

/** Typed view of the builder's private fields that the wither bodies mutate. */
interface BuilderState {
  _enableReactiveIntelligence: boolean;
  _reactiveIntelligenceOptions?: Partial<
    import("@reactive-agents/reactive-intelligence").ReactiveIntelligenceConfig
  >;
  _riHooks?: RiHooks;
  _riConstraints?: {
    allowedStrategySwitch?: string[];
    maxTemperatureAdjustment?: number;
    neverEarlyStop?: boolean;
    neverHumanEscalate?: boolean;
    protectedSkills?: string[];
    lockedSkills?: string[];
  };
  _riAutonomy?: "full" | "suggest" | "observe";
  _enableMemory: boolean;
  _memoryTier: "1" | "2";
  _memoryOptions?: MemoryOptions;
  _hooks: LifecycleHook[];
}

const asState = (builder: ReactiveAgentBuilder): BuilderState =>
  builder as unknown as BuilderState;

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
