import type { CortexMetaToolsConfig } from "./cortex-agent-config.js";

/**
 * The meta-tools a chat session builds with. The framework's plan posture records the plan with
 * the `todo` meta-tool (a model-written plan; without it the harness derives the checklist from the
 * reply), so a session built in Plan mode switches `todo` on unless the user decided:
 * `metaTools.enabled: false` (meta-tools off) and an explicit `todo` both stand. Tools-off chats
 * have no tool loop, so they are untouched. Everything else is the session's own `metaTools`.
 */
export function chatMetaTools(raw: unknown, mode: "plan" | "execute", enableTools: boolean): CortexMetaToolsConfig | undefined {
  const base = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as CortexMetaToolsConfig) : undefined;
  if (mode !== "plan" || !enableTools || base?.enabled === false || base?.todo === true) return base;
  return { ...base, todo: true };
}

/**
 * True when switching a session to Plan mode needs a rebuilt agent: its `todo` meta-tool is added
 * by Plan mode ({@link chatMetaTools}) and an agent built in Execute mode has none.
 */
export const planModeAddsTodo = (raw: unknown, enableTools: boolean): boolean =>
  chatMetaTools(raw, "plan", enableTools)?.todo === true && chatMetaTools(raw, "execute", enableTools)?.todo !== true;
