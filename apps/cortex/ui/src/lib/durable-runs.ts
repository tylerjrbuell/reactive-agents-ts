/**
 * Durable runs as the UI states and edits it (pure). One home for the setting's
 * wording and its config shape, shared by the Lab Builder's Execution section and the
 * chat's `/durable` command, so the two cannot drift. The value is the framework's
 * `durableRuns` builder option (`.withDurableRuns()`); this module never invents a
 * second path for it. Off is the default.
 */

type Cfg = Readonly<Record<string, unknown>>;

/** The setting's name in both surfaces. */
export const DURABLE_RUNS_LABEL = "Durable runs";

/** The Builder switch's hint: what turning it on does. */
export const DURABLE_RUNS_HINT = "Resumes after a crash, and keeps a run that waits for your approval across a restart. Turns reasoning on.";

/**
 * The chat panel's explanation: resumable stops, Continue, approvals and questions
 * pausing durably, and the framework limit that it turns reasoning on.
 */
export const DURABLE_RUNS_CHAT_DETAIL =
  "Stop and Pause save the run so Continue can pick it up. Approvals and questions pause the run in a store and survive a restart, instead of waiting live. Turns reasoning on (framework limit). Applies from your next message.";

/** Whether the config has Durable runs on (`durableRuns.enabled === true`). */
export function durableRunsOn(cfg: Cfg): boolean {
  const dr = cfg.durableRuns;
  return typeof dr === "object" && dr !== null && !Array.isArray(dr) && (dr as { enabled?: unknown }).enabled === true;
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
