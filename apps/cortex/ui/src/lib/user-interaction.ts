/**
 * The "agent may ask me questions" setting (`request_user_input`). It is the AgentConfig
 * path `userInteraction`, carried in `rawConfig` like any framework option. Without
 * durable runs a question is LIVE: the run waits in process for the answer.
 *
 * Unset means the surface's default: a chat asks (Cortex default, server
 * `chat-session-service.ts`), a desk run or saved agent does not, and durable runs always
 * can (they pause for the answer). Pure.
 */

/** `default` = unset; `yes`/`no` are explicit. */
export type AskMode = "default" | "yes" | "no";

/** Options the setting offers. */
export const ASK_MODES: readonly { readonly value: AskMode; readonly label: string }[] = [
  { value: "default", label: "Default (chats ask, runs do not)" },
  { value: "yes", label: "Yes, the agent may ask me" },
  { value: "no", label: "No, never ask" },
];

/** The mode a stored `rawConfig` is in. */
export function askModeOf(rawConfig: Readonly<Record<string, unknown>> | undefined): AskMode {
  const v = rawConfig?.userInteraction;
  if (v === undefined) return "default";
  return v === false ? "no" : "yes";
}

/**
 * `rawConfig` with the mode applied: `default` removes the key; `yes` keeps an existing
 * `{ timeoutMs }` object, else sets `true`. Other keys are untouched.
 */
export function withAskMode(rawConfig: Readonly<Record<string, unknown>>, mode: AskMode): Record<string, unknown> {
  const { userInteraction, ...rest } = rawConfig;
  if (mode === "default") return rest;
  if (mode === "no") return { ...rest, userInteraction: false };
  return { ...rest, userInteraction: typeof userInteraction === "object" && userInteraction !== null ? userInteraction : true };
}
