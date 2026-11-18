import { Effect, Context, Layer, Ref } from "effect";
import type {
  LifecyclePhase,
  HookTiming,
  ExecutionContext,
} from "./types.js";
import type { EngineRegisteredHook } from "./lifecycle-hook-types.js";
import type { RawHookResult } from "./hooks-normalize.js";
import { HookError } from "./errors.js";
import { normalizeHookResult } from "./hooks-normalize.js";

// ─── Service Tag ───

export class LifecycleHookRegistry extends Context.Tag("LifecycleHookRegistry")<
  LifecycleHookRegistry,
  {
    /** Register a lifecycle hook. Returns unregister function. */
    readonly register: (
      hook: EngineRegisteredHook,
    ) => Effect.Effect<() => void, never>;

    /** Run all hooks for a phase/timing. Returns updated context. */
    readonly run: (
      phase: LifecyclePhase,
      timing: HookTiming,
      ctx: ExecutionContext,
    ) => Effect.Effect<ExecutionContext, HookError>;

    /** Get all registered hooks. */
    readonly list: () => Effect.Effect<readonly EngineRegisteredHook[], never>;
  }
>() {}

// ─── Live Implementation ───

export const LifecycleHookRegistryLive = Layer.effect(
  LifecycleHookRegistry,
  Effect.gen(function* () {
    const hooks = yield* Ref.make<EngineRegisteredHook[]>([]);

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
            // The engine passes an ExecutionContext, and a per-turn handler
            // hands back the context it received, so an engine firing yields one.
            const handler = hook.handler as (c: ExecutionContext) => RawHookResult;
            current = yield* normalizeHookResult(handler, current).pipe(
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
