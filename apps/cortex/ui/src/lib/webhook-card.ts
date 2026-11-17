/**
 * Pure rules for the webhook channel card: how a duration in milliseconds reads, the replay
 * line built from the framework's `signature.replayWindowMs` (so the number is formatted, not
 * quoted as `300000 ms`), and which actions the signing-secret row offers. Rendering:
 * `components/channels/ChannelCard.svelte`, `WebhookConnectionPanel.svelte`.
 */

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** A duration in plain words: `300000` is "5 minutes", `90000` is "90 seconds", `3600000` is "1 hour". Sub-second values stay milliseconds. */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  if (seconds % 60 === 0 && seconds < 3600) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}

/** The replay rule for the connection facts, from the framework's window (it also drops a repeated message id). */
export function replayLine(replayWindowMs: number): string {
  const window = humanDuration(replayWindowMs);
  return `Requests whose timestamp is more than ${window} off the receiver's clock are refused; a repeated message id is dropped.`;
}

/** One action of the signing-secret row. */
export interface SecretAction {
  readonly id: "replace" | "generate" | "remove";
  readonly label: string;
}

/**
 * The signing-secret row's actions: with a secret saved `Replace`, `Generate` and `Remove`;
 * with none, only `Generate` (typing one in is the form beside it, not an action).
 */
export function secretActions(secretSaved: boolean): readonly SecretAction[] {
  return secretSaved
    ? [
        { id: "replace", label: "Replace" },
        { id: "generate", label: "Generate" },
        { id: "remove", label: "Remove" },
      ]
    : [{ id: "generate", label: "Generate" }];
}
