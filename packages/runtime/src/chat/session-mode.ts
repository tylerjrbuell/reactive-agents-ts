import type { ChatModeChangedEvent, RunPosture } from "@reactive-agents/core";

/**
 * The mode a chat session is in. `"execute"` (default): turns run normally.
 * `"plan"`: every turn runs plan-only (pure reasoning, no tools); the prose plan
 * stays in session history so the next execute turn sees it.
 *
 * This is session state, independent of the `plan-execute` reasoning STRATEGY.
 * It is the same value space as the per-run {@link RunPosture}; a session's mode
 * decides the posture of each of its turns.
 */
export type ChatMode = RunPosture;

/** The mode a session starts in when none is given. */
export const DEFAULT_CHAT_MODE: ChatMode = "execute";

/**
 * The posture one turn runs under: an explicit per-turn posture (even
 * `"execute"`) wins, otherwise the session's mode decides.
 */
export const turnPosture = (mode: ChatMode, explicit?: RunPosture): RunPosture => explicit ?? mode;

/**
 * Announce a session mode change on `publish` (the host's EventBus port): one
 * `ChatModeChanged` per actual change, nothing for a no-op set or an unwired
 * port. A publish failure goes to `onError`, never to the caller.
 */
export const announceModeChange = (
  publish: ((event: ChatModeChangedEvent) => Promise<void>) | undefined,
  sessionId: string,
  from: ChatMode,
  to: ChatMode,
  onError: (err: unknown) => void,
): void => {
  if (from === to || !publish) return;
  publish({ _tag: "ChatModeChanged", sessionId, from, to, timestamp: Date.now() }).catch(onError);
};
