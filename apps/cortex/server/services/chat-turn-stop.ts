/**
 * Who stopped a chat turn. A turn's run is aborted either by the user (Stop,
 * `POST /api/chat/sessions/:id/chat/stop`) or by its client going away (the SSE
 * request's signal: page closed, navigated off). Both abort the same run; this
 * registry keeps them apart so the stored turn can say which happened.
 */
import type { InterruptedBy, UserInterrupt } from "@reactive-agents/ui-core";

/** One in-flight turn's stop handle. */
export interface TurnStopHandle {
  /** Aborts when the user stops the turn or the client's request ends. Pass it to the run. */
  readonly signal: AbortSignal;
  /** Who stopped the turn; only meaningful once `signal` has aborted. */
  readonly stoppedBy: () => InterruptedBy;
  /** `"pause"` when the user's stop was a Pause (what `StreamCancelled.reason` reads as `user-paused`); `undefined` for a Stop or a disconnect. */
  readonly stoppedHow: () => UserInterrupt | undefined;
  /** Abort the run as a disconnect (its consumer went away); a no-op once aborted. */
  readonly abort: () => void;
  /** Release the handle when the turn ends. */
  readonly end: () => void;
}

interface ActiveTurn {
  readonly controller: AbortController;
  byUser: boolean;
  paused: boolean;
  /** Resolves when the turn's handle ends (the turn released the session's in-flight guard right after). */
  readonly settled: Promise<void>;
  readonly settle: () => void;
}

/** Longest a Stop, or a history change / new send right after one, waits for the aborted turn to wind down. */
export const STOP_SETTLE_MS = 8_000;

/** The `StreamCancelled.reason` of a stopped turn: who stopped it, `user-paused` for a Pause. */
export const cancelReasonOf = (by: InterruptedBy, how: UserInterrupt | undefined): string =>
  by === "user" && how === "pause" ? "user-paused" : by;

/** In-flight chat turns by session id (one turn per session at a time). */
export class ChatTurnStops {
  private readonly active = new Map<string, ActiveTurn>();

  /** Register the session's turn; `clientSignal` (the request's) aborts it as a disconnect. */
  begin(sessionId: string, clientSignal?: AbortSignal): TurnStopHandle {
    let settle: () => void = () => {};
    const settled = new Promise<void>((r) => {
      settle = r;
    });
    const turn: ActiveTurn = { controller: new AbortController(), byUser: false, paused: false, settled, settle };
    const onClientAbort = (): void => turn.controller.abort();
    if (clientSignal?.aborted) turn.controller.abort();
    else clientSignal?.addEventListener("abort", onClientAbort, { once: true });
    this.active.set(sessionId, turn);
    return {
      signal: turn.controller.signal,
      stoppedBy: () => (turn.byUser ? "user" : "disconnect"),
      stoppedHow: () => (turn.byUser && turn.paused ? "pause" : undefined),
      abort: () => turn.controller.abort(),
      end: () => {
        clientSignal?.removeEventListener("abort", onClientAbort);
        if (this.active.get(sessionId) === turn) this.active.delete(sessionId);
        turn.settle();
      },
    };
  }

  /**
   * Wait (bounded) for the session's aborted turn to finish winding down. Resolves `true` at once
   * when no turn is stopping (nothing to wait for: a turn that is still running is genuinely busy),
   * `true` when the stopping turn released in time, `false` on timeout.
   */
  async settleIfStopping(sessionId: string, timeoutMs: number = STOP_SETTLE_MS): Promise<boolean> {
    const turn = this.active.get(sessionId);
    if (turn === undefined || !turn.controller.signal.aborted) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((r) => {
      timer = setTimeout(() => r(false), timeoutMs);
    });
    try {
      return await Promise.race([turn.settled.then(() => true as const), timedOut]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Stop the session's in-flight turn as the user (`how` = Pause or Stop, default Stop). `false` when no turn is running. */
  stop(sessionId: string, how: UserInterrupt = "stop"): boolean {
    const turn = this.active.get(sessionId);
    if (turn === undefined || turn.controller.signal.aborted) return false;
    turn.byUser = true;
    turn.paused = how === "pause";
    turn.controller.abort();
    return true;
  }
}
