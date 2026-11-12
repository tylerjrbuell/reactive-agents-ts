import { Clock, Effect, Ref } from "effect";
import type { GatewayState } from "../types.js";

/** Length of the rate-limit window (`actionsThisHour`). */
export const HOUR_MS = 60 * 60 * 1000;
/** Length of the token-budget window (`tokensUsedToday`). */
export const DAY_MS = 24 * HOUR_MS;

/**
 * Pure window roll: when a window has elapsed, zero its counter and restart it at `nowMs`.
 * Without this the hourly action cap and daily token budget never recover (audit G1).
 */
export const rollWindows = (state: GatewayState, nowMs: number): GatewayState => {
  const hourElapsed = nowMs - state.hourWindowStart.getTime() >= HOUR_MS;
  const dayElapsed = nowMs - state.dayWindowStart.getTime() >= DAY_MS;
  if (!hourElapsed && !dayElapsed) return state;
  return {
    ...state,
    ...(hourElapsed ? { actionsThisHour: 0, hourWindowStart: new Date(nowMs) } : {}),
    ...(dayElapsed ? { tokensUsedToday: 0, dayWindowStart: new Date(nowMs) } : {}),
  };
};

/**
 * Roll the windows in `stateRef` using the Effect `Clock` (so `TestClock` drives tests)
 * and return the fresh state.
 */
export const rollStateWindows = (
  stateRef: Ref.Ref<GatewayState>,
): Effect.Effect<GatewayState> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return yield* Ref.updateAndGet(stateRef, (s) => rollWindows(s, now));
  });

/** Anchor the initial windows to the Effect `Clock`. */
export const anchorWindows = (
  stateRef: Ref.Ref<GatewayState>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(stateRef, (s) => ({
      ...s,
      hourWindowStart: new Date(now),
      dayWindowStart: new Date(now),
    }));
  });
