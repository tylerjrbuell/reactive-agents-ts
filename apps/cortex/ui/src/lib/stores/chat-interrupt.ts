/**
 * What the chat Stop / Pause buttons show while the server winds the turn down.
 *
 * The server answers Stop / Pause only once the aborted turn has released the session
 * (`settled`), which can take seconds (a model call that notices the abort late). Until
 * then the button must say so at once ("Stopping…" / "Pausing…") and a second press must
 * not fire a second request. Edit / rewind wait for the phase to clear (`whenInterruptIdle`),
 * and a busy answer that still slips through reads as a plain sentence, not the raw server one.
 */
import { get, writable } from "svelte/store";
import { toast } from "./toast-store.js";

/** `idle`, or the interrupt the person asked for that the server has not confirmed yet. */
export type InterruptPhase = "idle" | "stopping" | "pausing";

/** The in-progress interrupt (read by the composer to draw the pending buttons). */
export const interruptPhase = writable<InterruptPhase>("idle");

/**
 * Enter `phase`. Returns the function that leaves it, or `null` when an interrupt is already
 * pending (the press is a double-submit and is dropped).
 */
export function beginInterrupt(phase: Exclude<InterruptPhase, "idle">): (() => void) | null {
  if (get(interruptPhase) !== "idle") return null;
  interruptPhase.set(phase);
  return () => interruptPhase.set("idle");
}

/** Resolve once no interrupt is pending, or after `maxMs` (never blocks an edit longer than the server's own bound). */
export function whenInterruptIdle(maxMs = 10_000): Promise<void> {
  if (get(interruptPhase) === "idle") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let off: (() => void) | undefined;
    const timer = setTimeout(() => finish(), maxMs);
    const finish = (): void => {
      clearTimeout(timer);
      off?.();
      resolve();
    };
    off = interruptPhase.subscribe((p) => {
      if (p === "idle") finish();
    });
  });
}

/** The toast title and line when the server did not confirm a Stop / Pause in time (the request failed or timed out, or the turn is still winding down). */
export function unsettledNotice(kind: "stop" | "pause"): { readonly title: string; readonly detail: string } {
  return {
    title: kind === "stop" ? "Stop is taking longer than usual" : "Pause is taking longer than usual",
    detail: "The reply was dropped here, but the server has not confirmed yet. Editing or sending again works in a moment.",
  };
}

/** What a Stop / Pause request answers for the pending state: `settled` is the server's "the turn let go of the session". */
export type InterruptRequestAnswer = { readonly ok: true; readonly settled: boolean } | { readonly ok: false };

/**
 * Run a Stop / Pause request under the pending phase: "Stopping…" / "Pausing…" from the press until the
 * server confirms, a second press while pending is dropped (`undefined`), and a request that failed,
 * timed out or came back unsettled raises the not-confirmed warning. Returns the answer for the caller's own toast.
 */
export async function interruptTurn<A extends InterruptRequestAnswer>(
  phase: Exclude<InterruptPhase, "idle">,
  request: () => Promise<A>,
): Promise<A | undefined> {
  const leave = beginInterrupt(phase);
  if (leave === null) return undefined;
  try {
    const answer = await request();
    if (!answer.ok || !answer.settled) {
      const n = unsettledNotice(phase === "stopping" ? "stop" : "pause");
      toast.warning(n.title, n.detail);
    }
    return answer;
  } finally {
    leave();
  }
}

const BUSY =/is busy: a turn is already in flight/;

/** A server busy sentence ("Chat session X is busy: a turn is already in flight") as words a person can act on; other messages pass through. */
export function friendlyChatError(message: string): string {
  return BUSY.test(message) ? "The previous reply is still stopping. Try again in a moment." : message;
}
