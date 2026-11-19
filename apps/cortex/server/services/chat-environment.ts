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
    // Pinned skill names (the catalog itself reaches the model through withSkills).
    skills: p.skills?.activate ?? [],
    docSources: (p.documents ?? []).map((d) => d.source),
    ...(facts.goal ? { goal: facts.goal } : {}),
    ...(facts.agentControl ? { agentControl: "on" } : {}),
    todoUserEdits: facts.todoUserEdits,
  };
}

/** Who wrote a to-do list: only `user` writes are reported to the model as "edited". */
export type TodoSource = "user" | "agent";

/**
 * Per-session environment state for chat: the cumulative USER to-do edit counters and the
 * baseline the runtime diffs against. The baseline advances only in {@link settle} (a turn
 * ended), never when the engine reads the snapshot, so a read cannot swallow a pending diff.
 */
export class ChatEnvironment {
  private readonly baselines = new Map<string, EnvironmentSnapshotInput>();
  private readonly edits = new Map<string, { added: number; removed: number }>();
  private readonly readers = new Map<string, () => EnvironmentSnapshotInput>();

  /** Count a to-do write. Agent writes (session-control proposals) are not user edits. */
  recordTodoEdit(
    sessionId: string,
    before: readonly StoredTodoItem[],
    after: readonly StoredTodoItem[],
    source: TodoSource,
  ): void {
    if (source !== "user") return;
    const d = countTodoEdits(before, after);
    const prev = this.userEdits(sessionId);
    this.edits.set(sessionId, { added: prev.added + d.added, removed: prev.removed + d.removed });
  }

  /** Cumulative user to-do edits for the session. */
  userEdits(sessionId: string): { added: number; removed: number } {
    return this.edits.get(sessionId) ?? { added: 0, removed: 0 };
  }

  /** Register how to read the session's live snapshot (replaced on every rebuild). */
  attach(sessionId: string, reader: () => EnvironmentSnapshotInput): void {
    this.readers.set(sessionId, reader);
  }

  /** The baseline a rebuilt session diffs against (absent until a turn has settled). */
  baselineOf(sessionId: string): EnvironmentSnapshotInput | undefined {
    return this.baselines.get(sessionId);
  }

  /** A turn ended: what the model was told is now the baseline. */
  settle(sessionId: string): void {
    const read = this.readers.get(sessionId);
    if (read) this.baselines.set(sessionId, read());
  }

  /** Drop everything held for a deleted session. */
  forget(sessionId: string): void {
    this.baselines.delete(sessionId);
    this.edits.delete(sessionId);
    this.readers.delete(sessionId);
  }
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
