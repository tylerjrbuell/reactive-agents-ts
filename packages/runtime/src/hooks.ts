import { Effect, Context, Layer, Ref } from "effect";
import type {
  LifecycleHook,
  LifecyclePhase,
  HookTiming,
  ExecutionContext,
} from "./types.js";
import { HookError } from "./errors.js";

// ─── Service Tag ───

export class LifecycleHookRegistry extends Context.Tag("LifecycleHookRegistry")<
  LifecycleHookRegistry,
  {
    /** Register a lifecycle hook. Returns unregister function. */
    readonly register: (
      hook: LifecycleHook,
    ) => Effect.Effect<() => void, never>;

    /** Run all hooks for a phase/timing. Returns updated context. */
    readonly run: (
      phase: LifecyclePhase,
      timing: HookTiming,
      ctx: ExecutionContext,
    ) => Effect.Effect<ExecutionContext, HookError>;

    /** Get all registered hooks. */
    readonly list: () => Effect.Effect<readonly LifecycleHook[], never>;
  }
>() {}

// ─── Live Implementation ───

export const LifecycleHookRegistryLive = Layer.effect(
  LifecycleHookRegistry,
  Effect.gen(function* () {
    const hooks = yield* Ref.make<LifecycleHook[]>([]);

    return {
      register: (hook) =>
        Effect.gen(function* () {
          yield* Ref.update(hooks, (hs) => [...hs, hook]);
          return () => {
            Effect.runSync(
              Ref.update(hooks, (hs) => hs.filter((h) => h !== hook)),
            );
          };
        }),

      run: (phase, timing, ctx) =>
        Effect.gen(function* () {
          const allHooks = yield* Ref.get(hooks);
          const matching = allHooks.filter(
            (h) => h.phase === phase && h.timing === timing,
          );

          let current = ctx;
          for (const hook of matching) {
            current = yield* hook.handler(current).pipe(
              Effect.mapError(
                (cause) =>
                  new HookError({
                    message: `Hook failed for ${phase}/${timing}: ${cause}`,
                    phase,
                    timing,
                    cause,
                  }),
              ),
            );
          }
          return current;
        }),

      list: () => Ref.get(hooks),
    };
  }),
);
