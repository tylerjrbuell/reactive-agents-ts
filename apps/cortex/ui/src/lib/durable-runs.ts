/**
 * Durable runs as the UI states and edits it (pure). One home for the setting's
 * wording and its config shape, shared by the Lab Builder's Execution section and the
 * chat's `/durable` command, so the two cannot drift. The value is the framework's
 * `durableRuns` builder option (`.withDurableRuns()`); this module never invents a
 * second path for it. On is the default (owner decision 2026-11-17): only an explicit
 * `enabled: false` turns it off, so a config with no `durableRuns` key reads as On.
 */

type Cfg = Readonly<Record<string, unknown>>;

/** The setting's name in both surfaces. */
export const DURABLE_RUNS_LABEL = "Durable runs";

/** The Builder switch's hint: what turning it on does. */
export const DURABLE_RUNS_HINT = "On by default. A Stop, a Pause or a crash leaves a run you can continue, and a run that waits for your approval or an answer survives a restart. Turns reasoning on.";

/**
 * The chat panel's explanation: resumable stops, Continue, approvals and questions
 * pausing durably, and the framework limit that it turns reasoning on.
 */
export const DURABLE_RUNS_CHAT_DETAIL =
  "On by default. Stop and Pause save the run so Continue can pick it up. Approvals and questions pause the run (answer to continue) and survive a restart, instead of waiting live. Turns reasoning on (framework limit). Applies from your next message.";

/** The Off row's explanation in the chat panel. */
export const DURABLE_RUNS_CHAT_OFF_DETAIL = "Stop ends the reply for good, with nothing to continue; approvals and questions wait live in the chat";

/**
 * Whether the config has Durable runs on: on unless `durableRuns.enabled` is literally
 * `false` (the server builds durable by default, `server/services/durable-default.ts`).
 * A saved config with no `durableRuns` key reads as on.
 */
export function durableRunsOn(cfg: Cfg): boolean {
  const dr = cfg.durableRuns;
  return !(typeof dr === "object" && dr !== null && !Array.isArray(dr) && (dr as { enabled?: unknown }).enabled === false);
}

/** The text a command row or Config row shows for the current value. */
export function durableRunsValue(cfg: Cfg): "On" | "Off" {
  return durableRunsOn(cfg) ? "On" : "Off";
}

/**
 * The config patch that turns Durable runs on or off. Other `durableRuns` fields
 * (`dir`, `checkpointEvery`) are kept, as the Builder switch keeps them.
 */
export function durableRunsPatch(cfg: Cfg, on: boolean): { durableRuns: Record<string, unknown> } {
  const dr = cfg.durableRuns;
  const rest = typeof dr === "object" && dr !== null && !Array.isArray(dr) ? (dr as Record<string, unknown>) : {};
  return { durableRuns: { ...rest, enabled: on } };
}
