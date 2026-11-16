import type { RunPosture } from "@reactive-agents/core";
import { setChatMode } from "../db/chat-queries.js";
import { CortexNotFoundError } from "../errors.js";
import { planModeAddsTodo } from "./chat-meta-tools.js";
import { resolveEnableTools } from "./chat-tool-params.js";

/**
 * Switch a chat session's mode: persisted with the session (it survives a reload) and applied to
 * the live framework session at once. A turn already running keeps the mode it started under.
 */
export function applyChatMode(
  db: Parameters<typeof setChatMode>[0],
  live: ReadonlyMap<string, { readonly session: { setMode(mode: RunPosture): void } }>,
  sessionId: string,
  mode: RunPosture,
): void {
  if (!setChatMode(db, sessionId, mode)) throw new CortexNotFoundError({ id: sessionId, resource: "chat session" });
  live.get(sessionId)?.session.setMode(mode);
}

/**
 * True when entering Plan mode needs the cached agent rebuilt: Plan mode adds the `todo`
 * meta-tool (`chat-meta-tools.ts`) and an agent built in Execute mode has none. Without it the
 * plan turn still works (the harness derives the checklist from the reply), but the model could not
 * record the plan itself.
 */
export function modeSwitchNeedsRebuild(
  before: { readonly mode: RunPosture; readonly agentConfig: Record<string, unknown> } | null,
  next: RunPosture,
  cached: boolean,
): boolean {
  return cached && before !== null && next === "plan" && before.mode !== "plan" && planModeAddsTodo(before.agentConfig.metaTools, resolveEnableTools(before.agentConfig));
}
