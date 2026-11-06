/**
 * TypeBox fragments shared by the chat-session config body (`api/chat.ts`) and
 * the run launch body (`api/runs.ts`), so a field added for one surface has the
 * same shape on the other (pinned by `chat-runs-config-drift.test.ts`).
 */
import { t } from "elysia";

/** Guardrails: real detector switches + custom blocklist; thresholds are the legacy on/off encoding. */
export const GuardrailsBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  injection: t.Optional(t.Boolean()),
  pii: t.Optional(t.Boolean()),
  toxicity: t.Optional(t.Boolean()),
  customBlocklist: t.Optional(t.Array(t.String())),
  injectionThreshold: t.Optional(t.Number()),
  piiThreshold: t.Optional(t.Number()),
  toxicityThreshold: t.Optional(t.Number()),
});

/** Host-shell options (`CortexShellOptions` in services/cortex-agent-config.ts). */
export const TerminalShellOptionsBody = t.Object({
  cwd: t.Optional(t.String()),
  allowUnsafeCwd: t.Optional(t.Boolean()),
  timeoutMs: t.Optional(t.Number()),
  maxOutputChars: t.Optional(t.Number()),
  commandAccess: t.Optional(t.Array(t.String())),
  sandbox: t.Optional(t.Union([t.Literal("host"), t.Literal("docker")])),
});

/** Durable execution + durable HITL approval gate. */
export const DurableRunsBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  checkpointEvery: t.Optional(t.Number()),
  dir: t.Optional(t.String()),
  approvalPolicy: t.Optional(
    t.Object({
      tools: t.Optional(t.Array(t.String())),
      mode: t.Optional(t.Union([t.Literal("detach"), t.Literal("block")])),
    }),
  ),
});
