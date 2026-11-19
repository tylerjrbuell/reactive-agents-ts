/** State of the thin indeterminate bar at the top of the chat column. */
export type BusyBarState = "off" | "run" | "calm";

/**
 * Pure state for the chat busy bar. It is indeterminate on purpose: it never
 * reads step counts. A run or a history action (`sending` / `busy`) sweeps
 * ("run"); a Stop / Pause waiting on the server ("stopping" / "pausing")
 * sweeps slower ("calm"); otherwise the bar is "off" and nothing animates.
 */
export function busyBarState(input: {
  readonly sending: boolean;
  readonly busy: boolean;
  readonly phase: "idle" | "stopping" | "pausing";
}): BusyBarState {
  if (input.phase !== "idle") return "calm";
  return input.sending || input.busy ? "run" : "off";
}
