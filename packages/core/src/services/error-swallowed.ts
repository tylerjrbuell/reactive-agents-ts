import { Effect, Option } from "effect";
import { EventBus } from "./event-bus.js";

/**
 * Payload describing a framework site that caught and swallowed an error.
 *
 * Used by `emitErrorSwallowed(payload)` to publish an `ErrorSwallowed`
 * `AgentEvent` without suppressing the swallow behavior itself. The goal is
 * to keep silent-failure sites observable for telemetry and regression
 * detection (north-star design §1.2 G-6).
 *
 * @property site — Canonical site identifier, formatted as
 *   `<package-name>/<relative-file>:<line>` (e.g. `"runtime/builder.ts:4182"`).
 * @property tag — Error discriminator, typically the error's `_tag` or
 *   constructor name. Use `errorTag(err)` to derive consistently.
 * @property taskId — Optional task identifier when the swallow occurs inside
 *   a task-scoped Effect.
 * @property message — Optional human-readable error message. Keep concise;
 *   redaction is not applied here.
 */
export interface ErrorSwallowedPayload {
  readonly site: string;
  readonly tag: string;
  readonly taskId?: string;
  readonly message?: string;
}

/**
 * Publish an `ErrorSwallowed` event to the ambient `EventBus` if one is
 * provided; otherwise this is a no-op.
 *
 * Designed to replace `Effect.catchAll(() => Effect.void)` sites without
 * changing their requirements set: the helper uses
 * `Effect.serviceOption(EventBus)` so it may be composed into any Effect
 * regardless of whether the caller's context has `EventBus` in scope.
 *
 * The helper never throws and never propagates an error: publishing failures
 * (if any) are themselves swallowed so the original `catchAll` semantics
 * — "this failure path is not fatal" — are preserved.
 *
 * @param payload — Description of the swallow site.
 * @returns Effect that always succeeds with `void`.
 *
 * @example
 * ```ts
 * pipe(
 *   someEffect,
 *   Effect.catchAll((err) =>
 *     emitErrorSwallowed({
 *       site: "runtime/builder.ts:4182",
 *       tag: errorTag(err),
 *     }),
 *   ),
 * )
 * ```
 *
 * @see errorTag — pairs with this helper to derive a stable `tag`.
 */
export const emitErrorSwallowed = (
  payload: ErrorSwallowedPayload,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (Option.isSome(busOpt)) {
      yield* busOpt.value
        .publish({
          _tag: "ErrorSwallowed",
          site: payload.site,
          tag: payload.tag,
          taskId: payload.taskId,
          message: payload.message,
          timestamp: Date.now(),
        })
        .pipe(Effect.catchAll(() => Effect.void));
    }
  });

/**
 * Derive a stable tag name for any error value.
 *
 * Precedence:
 * 1. An object with a string `_tag` property — returns its value (covers
 *    Effect `Data.TaggedError` instances and other discriminated errors).
 * 2. A native `Error` subclass — returns `err.name` (e.g. `"TypeError"`).
 * 3. Anything else — returns `"UnknownError"`.
 *
 * @param err — Any value caught by `Effect.catchAll`.
 * @returns A short tag suitable for telemetry and event payloads.
 */
export function errorTag(err: unknown): string {
  if (err !== null && typeof err === "object" && "_tag" in err) {
    const tag = (err as { readonly _tag: unknown })._tag;
    if (typeof tag === "string" && tag.length > 0) {
      return tag;
    }
  }
  if (err instanceof Error) {
    return err.name;
  }
  return "UnknownError";
}
