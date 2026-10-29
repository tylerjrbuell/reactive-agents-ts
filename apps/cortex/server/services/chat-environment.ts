/**
 * chat-environment.ts — deterministic environment facts for Cortex chat sessions.
 *
 * Feeds the runtime ChatEngine's between-turn environment diff. Everything is derived
 * from the session's resolved agent params (no model call, no live registry probe), so
 * a change the user makes in the config panel shows up as exactly one notice.
 */
import type { SessionOptions } from "@reactive-agents/runtime";

/** Host-supplied environment facts (the runtime does not re-export the type). */
export type EnvironmentSnapshotInput = ReturnType<NonNullable<SessionOptions["environment"]>>;
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";
import type { StoredTodoItem } from "../db/chat-queries.js";

/** Host facts a snapshot needs beyond the agent params. */
export interface ChatEnvironmentFacts {
  readonly agentControl: boolean;
  readonly goal: { readonly status: string; readonly objective?: string } | null;
  readonly todoUserEdits: { readonly added: number; readonly removed: number };
}

/** Tool names the session's config grants (allow-list, extras, MCP servers, agent tools). */
export function configuredToolNames(p: BuildCortexAgentParams): string[] {
  const names = new Set<string>(p.tools ?? []);
  for (const n of (p.additionalToolNames ?? "").split(/[,\n]/)) if (n.trim()) names.add(n.trim());
  for (const t of p.extraTools ?? []) names.add(t.definition.name);
  for (const m of p.mcpConfigs ?? []) names.add(`mcp:${m.name}`);
  for (const a of p.agentTools ?? []) if ("toolName" in a && a.toolName) names.add(a.toolName);
  return [...names];
}

/** Build the environment snapshot input for one session at this instant. */
export function chatEnvironmentSnapshot(p: BuildCortexAgentParams, facts: ChatEnvironmentFacts): EnvironmentSnapshotInput {
  return {
    ...(p.provider ? { provider: p.provider } : {}),
    ...(p.model ? { model: p.model } : {}),
    ...(p.thinking !== undefined ? { thinking: p.thinking } : {}),
    toolNames: configuredToolNames(p),
    skills: p.skills?.paths ?? [],
    docSources: (p.documents ?? []).map((d) => d.source),
    ...(facts.goal ? { goal: facts.goal } : {}),
    ...(facts.agentControl ? { agentControl: "on" } : {}),
    todoUserEdits: facts.todoUserEdits,
  };
}

/** Rows the user added to / removed from the list (matched by id). Status or title edits are not counted. */
export function countTodoEdits(
  before: readonly StoredTodoItem[],
  after: readonly StoredTodoItem[],
): { added: number; removed: number } {
  const b = new Set(before.map((t) => t.id));
  const a = new Set(after.map((t) => t.id));
  return { added: after.filter((t) => !b.has(t.id)).length, removed: before.filter((t) => !a.has(t.id)).length };
}
