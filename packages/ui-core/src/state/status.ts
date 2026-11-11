import type { SubAgentCardState } from "./sub-agent-card.js";
import type { TurnEnding } from "./turn-outcome.js";

/**
 * One status vocabulary for every surface that paints a run's state: a chat
 * turn, a sub-agent card, a run list row, a desk node. Each surface maps its own
 * states onto these tones, so "stopped" or "needs attention" looks the same
 * everywhere.
 * - `running`: work in progress.
 * - `attention`: ended or paused in a way the user should read (partial,
 *   abstained, waiting on an approval or an answer).
 * - `done`: succeeded.
 * - `failed`: did not finish because something broke.
 * - `stopped`: stopped before it finished (by the user, or the client left).
 * - `idle`: nothing to show.
 */
export type StatusTone = "running" | "attention" | "done" | "failed" | "stopped" | "idle";

/** A tone plus the short label a surface shows for it. */
export interface StatusView {
  readonly tone: StatusTone;
  readonly label: string;
}

/** Status of a chat turn from its ending; `undefined` reads as running while it streams, else idle. */
export function statusOfTurn(ending: TurnEnding | undefined, opts: { readonly streaming?: boolean } = {}): StatusView {
  if (opts.streaming === true) return { tone: "running", label: "Running" };
  switch (ending) {
    case "succeeded":
      return { tone: "done", label: "Finished" };
    case "partial":
      return { tone: "attention", label: "Partial" };
    case "abstained":
      return { tone: "attention", label: "Abstained" };
    case "paused":
      return { tone: "attention", label: "Waiting on you" };
    case "failed":
    case "errored":
      return { tone: "failed", label: "Did not finish" };
    case "cancelled":
      return { tone: "stopped", label: "Stopped" };
    case "interrupted":
      return { tone: "stopped", label: "Interrupted" };
    default:
      return { tone: "idle", label: "Idle" };
  }
}

/** Status of a run summary row (`live`, `completed`, `failed`, `stopped`, `paused`, `awaiting-*`). */
export function statusOfRun(status: string): StatusView {
  switch (status) {
    case "live":
    case "streaming":
      return { tone: "running", label: "Live" };
    case "completed":
      return { tone: "done", label: "Done" };
    case "failed":
    case "error":
      return { tone: "failed", label: "Failed" };
    case "stopped":
    case "cancelled":
      return { tone: "stopped", label: "Stopped" };
    case "paused":
    case "awaiting-approval":
    case "awaiting-interaction":
      return { tone: "attention", label: "Paused" };
    default:
      return { tone: "idle", label: status };
  }
}

/** Status of a sub-agent card. */
export function statusOfSubAgent(state: SubAgentCardState): StatusView {
  switch (state) {
    case "running":
      return { tone: "running", label: "Running" };
    case "done":
      return { tone: "done", label: "Done" };
    case "failed":
      return { tone: "failed", label: "Failed" };
    case "abstained":
      return { tone: "attention", label: "Abstained" };
  }
}
