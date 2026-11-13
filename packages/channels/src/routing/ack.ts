import { Effect, Schedule } from "effect";
import type { RouteAck, RouteSpec } from "./types.js";

/** Default delay before the acknowledgement message. */
export const DEFAULT_ACK_AFTER_MS = 4000;
/** Default acknowledgement message. */
export const DEFAULT_ACK_TEXT = "On it...";
/** Platforms expire a typing pulse after about 5 seconds; refresh a little sooner. */
export const TYPING_REFRESH_MS = 4000;

/** A route's `ack` with defaults applied. */
export interface ResolvedAck {
  readonly afterMs: number;
  readonly texts: readonly string[];
  readonly typing: boolean;
}

/** Apply defaults. Absent or `false` is off: no typing, no message. */
export const resolveAck = (ack: RouteSpec["ack"]): ResolvedAck | undefined => {
  if (!ack) return undefined;
  const given = ack.text === undefined ? [DEFAULT_ACK_TEXT] : typeof ack.text === "string" ? [ack.text] : ack.text;
  return {
    afterMs: ack.afterMs ?? DEFAULT_ACK_AFTER_MS,
    texts: given.length > 0 ? given : [DEFAULT_ACK_TEXT],
    typing: ack.typing ?? true,
  };
};

/** Deterministic pick: the same message id always gets the same text. */
export const pickAckText = (texts: readonly string[], seed: string): string => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return texts[h % texts.length] ?? DEFAULT_ACK_TEXT;
};

/**
 * Run `turn` while two scoped helper fibers act on the chat: a typing pulse every
 * {@link TYPING_REFRESH_MS} from the start, and one acknowledgement after `afterMs`. Both are
 * interrupted (and awaited) when the turn ends, so an ack never lands after the final reply and a
 * quick turn is never acknowledged. `pulse` / `sendAck` must not fail; the caller swallows errors.
 */
export const withTurnAck = <A, E, R>(
  turn: Effect.Effect<A, E, R>,
  plan: {
    readonly ack: ResolvedAck;
    readonly pulse: Effect.Effect<void> | undefined;
    readonly sendAck: Effect.Effect<void>;
  },
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      if (plan.ack.typing && plan.pulse) {
        yield* Effect.forkScoped(Effect.repeat(plan.pulse, Schedule.spaced(TYPING_REFRESH_MS)));
      }
      yield* Effect.forkScoped(Effect.zipRight(Effect.sleep(plan.ack.afterMs), plan.sendAck));
      return yield* turn;
    }),
  );
