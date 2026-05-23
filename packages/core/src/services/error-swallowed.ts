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

// ── Load-bearing failures (HS-cleanup-3) ─────────────────────────────────────

/**
 * Categorize a failure as **load-bearing** — distinct from telemetry-quality
 * swallow sites covered by `emitErrorSwallowed`. Load-bearing failures break
 * framework invariants users rely on (skill persistence is the canonical
 * example: silently swallowing it makes the "compounding intelligence" claim
 * false). They MUST surface; never become silent.
 *
 * @property capability — Short string identifying the framework surface that
 *   failed (e.g. `"skill-persistence"`, `"memory-flush"`, `"calibration-write"`).
 *   Trace consumers grep on this.
 * @property site — Canonical site identifier (`<package>/<file>:<line>`).
 * @property tag — Underlying error discriminator (`errorTag(err)`).
 * @property entityId — Optional identifier of the entity whose persistence
 *   failed (skill name, calibration model id, memory record id) so the
 *   surface can be attributed.
 * @property message — Optional human-readable detail.
 */
export interface LoadBearingFailurePayload {
  readonly capability: string;
  readonly site: string;
  readonly tag: string;
  readonly entityId?: string;
  readonly message?: string;
}

/**
 * Surface a load-bearing failure — triple-channel signal so the failure can
 * never go unnoticed:
 *
 *   1. `console.warn(...)` — visible in any process output, including test
 *      runners and minimal-logger consumers.
 *   2. `Effect.logWarning(...)` — structured-logger consumers capture at WARN.
 *   3. `ErrorSwallowed` event with `tag: "LoadBearingFailure:<capability>"`
 *      so trace consumers have one canonical grep predicate:
 *      `e._tag === "ErrorSwallowed" && e.tag.startsWith("LoadBearingFailure:")`.
 *
 * Always succeeds with `void` — the helper never throws, just like
 * `emitErrorSwallowed`. The difference is **audibility**: telemetry swallows
 * stay silent in `console`; load-bearing failures always warn.
 *
 * Use this in place of `emitErrorSwallowed` when the swallow site protects a
 * framework invariant the user relies on (persistence, calibration writes,
 * memory flush) — NOT for opportunistic publishes, hint emits, or trace logs.
 *
 * @example
 * ```ts
 * yield* Effect.catchAll(skillStore.store(entry), (err) =>
 *   emitLoadBearingFailure({
 *     capability: "skill-persistence",
 *     site: "reactive-intelligence/learning-engine.ts:165",
 *     tag: errorTag(err),
 *     entityId: entry.name,
 *     message: err instanceof Error ? err.message : String(err),
 *   }),
 * );
 * ```
 */
export const emitLoadBearingFailure = (
  payload: LoadBearingFailurePayload,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const detail = `capability="${payload.capability}" tag=${payload.tag}` +
      (payload.entityId ? ` entity="${payload.entityId}"` : "") +
      (payload.message ? ` message=${payload.message}` : "");
    // Channel 1: console.warn — visible in any output stream.
    console.warn(`[reactive-agents] LoadBearingFailure: ${detail} (${payload.site})`);
    // Channel 2: Effect.logWarning — structured-logger consumers.
    yield* Effect.logWarning(`LoadBearingFailure: ${detail}`);
    // Channel 3: typed event for trace consumers.
    yield* emitErrorSwallowed({
      site: payload.site,
      tag: `LoadBearingFailure:${payload.capability}`,
      ...(payload.entityId ? { message: `${payload.entityId}: ${payload.message ?? payload.tag}` } : payload.message ? { message: payload.message } : {}),
    });
  });
