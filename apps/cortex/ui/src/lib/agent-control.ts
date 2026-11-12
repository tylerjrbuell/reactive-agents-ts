/**
 * Agent-control switches: which kinds of change the chat agent may propose, and which of those may
 * apply a TIGHTENING change without a click. The group ids and labels mirror the server table
 * (`server/services/session-capabilities.ts` `CAPABILITY_GROUPS`; `agent-control-groups.test.ts`
 * fails when they drift). Pure; no I/O. Every switch defaults off; `basics` rides Agent control itself.
 */

export interface AgentControlGroup {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  /** True when the group has a tightening change that may auto-apply (the rest only ever wait for Apply). */
  readonly canAutoApply: boolean;
}

/** The switchable groups (not `basics`, which Agent control itself enables). */
export const AGENT_CONTROL_GROUPS: readonly AgentControlGroup[] = [
  { id: "tools", label: "Tools", detail: "Add or remove a tool or toolset; enable an MCP server you already configured", canAutoApply: true },
  { id: "limits", label: "Limits and strategy", detail: "Max steps, reasoning strategy, context budget", canAutoApply: true },
  { id: "memory", label: "Memory", detail: "Turn the working, episodic or semantic memory tier on or off", canAutoApply: true },
  { id: "prompt", label: "System prompt", detail: "Propose new system prompt text", canAutoApply: false },
  { id: "approvals", label: "Approvals", detail: "Ask before risky tools; looser always needs your Apply", canAutoApply: true },
  { id: "workspace", label: "Workspace folder", detail: "Point file tools and the shell at another existing folder", canAutoApply: false },
  { id: "conversation", label: "Conversation", detail: "Edit the to-do list; compact, fork or rewind the chat", canAutoApply: false },
];

type Cfg = Readonly<Record<string, unknown>>;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Group ids the user switched on for this chat. */
export const enabledControlGroups = (cfg: Cfg): string[] => ids(cfg.agentControlGroups).filter((g) => AGENT_CONTROL_GROUPS.some((x) => x.id === g));

/** Group ids whose tightening proposals apply without a click. */
export const autoApplyControlGroups = (cfg: Cfg): string[] => ids(cfg.agentControlAutoApply);

/** Patch that flips one group's switch; switching a group off also clears its auto-apply. */
export function toggleControlGroupPatch(cfg: Cfg, id: string): { agentControlGroups: string[]; agentControlAutoApply: string[] } {
  const on = enabledControlGroups(cfg);
  const next = on.includes(id) ? on.filter((g) => g !== id) : [...on, id];
  return { agentControlGroups: next, agentControlAutoApply: autoApplyControlGroups(cfg).filter((g) => next.includes(g)) };
}

/** Patch that flips auto-apply for one enabled group that supports it. */
export function toggleAutoApplyPatch(cfg: Cfg, id: string): { agentControlAutoApply: string[] } {
  const cur = autoApplyControlGroups(cfg);
  return { agentControlAutoApply: cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id] };
}

/** Short value for the Config menu row: "On", "On · 2 more" or "Off". */
export function agentControlSummary(cfg: Cfg): string {
  if (cfg.agentControl !== true) return "Off";
  const n = enabledControlGroups(cfg).length;
  return n === 0 ? "On" : `On · ${n} more`;
}
