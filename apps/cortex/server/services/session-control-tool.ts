/**
 * `session-control`: the one Cortex-local tool that lets a chat agent look at, and PROPOSE
 * changes to, its own session (model, thinking, skills, docs, goals, loops).
 *
 * Safety contract (do not weaken): the handler never mutates the session. Mutating actions
 * only create a `chat_proposals` row through {@link SessionControlPort.propose}; a human must
 * press Apply. Read-only actions (`status`, `list-schedules`) answer directly. Registered
 * only for sessions with `agentControl: true`.
 */
import { Schema } from "effect";
import { defineTool, type DefinedTool } from "@reactive-agents/tools";
import { SESSION_ACTIONS, healAction, healActionArgs } from "./session-actions.js";
import type { SessionControlPort } from "./chat-proposal-service.js";

/** Tool name as the model sees it. */
export const SESSION_CONTROL_TOOL_NAME = "session-control";

/** One system-prompt line added only when agent control is on. */
export const SESSION_CONTROL_SYSTEM_LINE =
  "You can inspect and propose changes to this chat with the session-control tool (model, thinking, skills, docs, goals, loops). " +
  "Call action=status first to see the current setup. Every change is only a proposal the user must Apply: never say a change is already made.";

const optStr = (description: string) => Schema.optional(Schema.String.annotations({ description }));
const optNum = (description: string) => Schema.optional(Schema.Union(Schema.Number, Schema.String).annotations({ description }));

const Input = Schema.Struct({
  action: Schema.String.annotations({ description: `One of: ${SESSION_ACTIONS.join(", ")}` }),
  value: optStr("set-model: model id. set-provider: provider id. set-thinking: on|off|auto. pin-skill: skill name. add-doc: http(s) URL."),
  model: optStr("set-provider only: model id for the new provider (optional)."),
  objective: optStr("start-goal: what to achieve."),
  interval: optStr("set-loop: repeat interval such as 30m, 1h, 1d (minimum 1m)."),
  cron: optStr("set-schedule: 5-field cron expression."),
  prompt: optStr("set-loop / set-schedule: the message to run each time."),
  id: optStr("stop-loop: schedule id from status or list-schedules."),
  maxSegments: optNum("start-goal: most work segments (optional, only lowers the default)."),
  maxCostUsd: optNum("start-goal / set-loop / set-schedule: spend cap in USD (optional, only lowers the default)."),
  ttlHours: optNum("set-loop / set-schedule: hours before it expires (optional, only lowers the default)."),
});

/**
 * Build the `session-control` tool for one session. Never throws at call time: every failure
 * is returned as a short `error: ...` line that names the valid options so a small model can retry.
 */
export function makeSessionControlTool(sessionId: string, port: SessionControlPort): DefinedTool {
  const tool = defineTool({
    name: SESSION_CONTROL_TOOL_NAME,
    description:
      "See and propose changes to this chat session. action=status shows the current setup. " +
      "Other actions only create a proposal the user approves. " +
      `Actions: ${SESSION_ACTIONS.join(", ")}.`,
    input: Input,
    riskLevel: "low",
    handler: async (args): Promise<string> => {
      const healed = healAction(args.action);
      if (!healed.ok) return `error: ${healed.message}`;
      if (healed.action === "status") return port.status(sessionId);
      if (healed.action === "list-schedules") return port.listSchedules(sessionId);
      const { action: _action, ...rest } = args;
      const r = await port.propose(sessionId, healed.action, rest);
      return r.ok ? `proposed: ${r.proposal.summary}; awaiting user Apply` : `error: ${r.message}`;
    },
  });
  // Decode accepts any string so drifted names ("loop") reach the healer; the wire schema still advertises the closed enum.
  return {
    ...tool,
    // Heal drifted argument names (`every` -> `interval`) before decode: the struct decode drops unknown keys.
    handler: (raw) => {
      const healed = healAction(typeof raw.action === "string" ? raw.action : "");
      return tool.handler(healed.ok ? healActionArgs(healed.action, raw) : raw);
    },
    definition: {
      ...tool.definition,
      parameters: tool.definition.parameters.map((p) => (p.name === "action" ? { ...p, enum: [...SESSION_ACTIONS] } : p)),
    },
  };
}
