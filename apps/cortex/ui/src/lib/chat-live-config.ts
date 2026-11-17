/**
 * Config changes while a run is going. The quick bar's chips and the config slash
 * commands (`/model`, `/strategy`, `/tools`, …) only PATCH the session config; the
 * server rebuilds the agent for the NEXT turn and leaves the running one alone. So
 * they work during a run, and never go through the message queue (`chat-queue.ts`):
 * queueing `/model x` would send it as a chat message after the run. Pure.
 */

/** Slash commands that only change session config (their picker rows PATCH it). */
export const LIVE_CONFIG_COMMANDS: ReadonlySet<string> = new Set([
  "model",
  "provider",
  "thinking",
  "strategy",
  "tools",
  "terminal",
  "workspace",
  "iterations",
  "approvals",
  "durable",
  // `/skill` only marks a skill for the next message (no PATCH); it must not queue as text either.
  "skill",
  "skills",
  "docs",
  "agent",
  // `/mcp` toggles or adds an MCP server (a config PATCH, applied next turn).
  "mcp",
  // `/btw` asks a read-only side question: it is meant to run while a turn is in progress,
  // never queued behind it and never part of the running turn.
  "btw",
]);

/** True for a config-only slash command (allowed during a run). */
export function isLiveConfigCommand(name: string | undefined): boolean {
  return name !== undefined && LIVE_CONFIG_COMMANDS.has(name);
}

/**
 * What Enter does with the composer text. `dispatch` runs it now (a message when
 * idle, a slash command when idle or a config command during a run); `queue`
 * parks a message (or a non-config command) until the run ends.
 */
export function submitRoute(input: { readonly sending: boolean; readonly command?: string | undefined }): "dispatch" | "queue" {
  if (!input.sending) return "dispatch";
  return isLiveConfigCommand(input.command) ? "dispatch" : "queue";
}

/**
 * Whether the command surface may open. Idle: always. During a run: the root list
 * (it then lists only the config commands, `commandMenuItems`) and a config command's
 * panel (its rows PATCH the config); history commands (clear, rewind, fork…) wait
 * for the run to end.
 */
export function slashMenuAllowed(input: { readonly sending: boolean; readonly command?: string | undefined; readonly hasArg: boolean }): boolean {
  if (!input.sending) return true;
  return !input.hasArg || isLiveConfigCommand(input.command);
}

/** Toast after a config change: during a run it says the running turn keeps its settings. */
export function configAppliedNote(what: string, sending: boolean): string {
  return sending ? `${what} · applies to the next turn (this one keeps its settings)` : `${what} · applies to your next message`;
}

/** Provider and model a turn starts with, pinned on the turn so a mid-run switch does not relabel it. */
export function turnModelOf(cfg: Readonly<Record<string, unknown>> | undefined): { provider?: string; model?: string } {
  const provider = typeof cfg?.provider === "string" && cfg.provider !== "" ? cfg.provider : undefined;
  const model = typeof cfg?.model === "string" && cfg.model !== "" ? cfg.model : undefined;
  return { ...(provider ? { provider } : {}), ...(model ? { model } : {}) };
}
