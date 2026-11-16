import type { RunPosture } from "@reactive-agents/core";
import { setChatMode } from "../db/chat-queries.js";
import { CortexNotFoundError } from "../errors.js";

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
