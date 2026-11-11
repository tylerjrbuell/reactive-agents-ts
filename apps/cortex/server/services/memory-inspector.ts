/**
 * Memory studio backend: read, search, edit and delete an agent's stored memory
 * through the framework's `agent.memory()` facade, never by opening `memory.db`.
 *
 * Each inspected agent gets one small agent built with the same `agentId` and the
 * same database the framework resolves for it (`defaultUserMemoryPath`, i.e.
 * `$HOME/.reactive-agents/memory/<agentId>/memory.db`). The path is passed
 * explicitly because a `test`-provider build would otherwise resolve to
 * `:memory:`. An agent whose database file does not exist is reported as
 * unavailable and never built, so looking never creates a database.
 *
 * Built agents are cached per agentId and disposed by {@link MemoryInspector.disposeAll}.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultUserMemoryPath } from "@reactive-agents/memory";
import {
  ReactiveAgents,
  type AgentMemoryHandle,
  type EpisodicMemoryItem,
  type ProceduralMemoryItem,
  type ProceduralMemoryPatch,
  type SemanticMemoryItem,
  type SemanticMemoryPatch,
} from "@reactive-agents/runtime";

/** A semantic entry as the Memory studio API returns it (dates as ISO strings). */
export interface MemorySemanticDto {
  readonly id: string;
  readonly content: string;
  readonly summary: string;
  readonly importance: number;
  readonly verified: boolean;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly accessCount: number;
  readonly lastAccessedAt: string;
  readonly taskId?: string;
  readonly runId?: string;
}

/** A procedural entry (learned workflow) as the API returns it. */
export interface MemoryProceduralDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly pattern: string;
  readonly successRate: number;
  readonly useCount: number;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly taskId?: string;
  readonly runId?: string;
}

/** An episodic log entry as the API returns it. */
export interface MemoryEpisodicDto {
  readonly id: string;
  readonly date: string;
  readonly content: string;
  readonly eventType: string;
  readonly taskId?: string;
}

/** One agent's memory listing. `available: false` when the agent has no memory database. */
export interface MemoryListing {
  readonly agentId: string;
  readonly available: boolean;
  readonly dbPath: string;
  readonly semantic: readonly MemorySemanticDto[];
  readonly procedural: readonly MemoryProceduralDto[];
  readonly episodic: readonly MemoryEpisodicDto[];
}

/** Result of a memory call: the value, or why it failed (`missing` = no database / unknown id). */
export type MemoryResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: "missing" | "error"; readonly error: string };

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/** Map a facade semantic entry to its JSON shape. Pure. */
export function semanticDto(e: SemanticMemoryItem): MemorySemanticDto {
  return {
    id: e.id,
    content: e.content,
    summary: e.summary,
    importance: e.importance,
    verified: e.verified,
    tags: [...e.tags],
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
    accessCount: e.accessCount,
    lastAccessedAt: iso(e.lastAccessedAt),
    ...(e.taskId !== undefined ? { taskId: e.taskId } : {}),
    ...(e.runId !== undefined ? { runId: e.runId } : {}),
  };
}

/** Map a facade procedural entry to its JSON shape. Pure. */
export function proceduralDto(e: ProceduralMemoryItem): MemoryProceduralDto {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    pattern: e.pattern,
    successRate: e.successRate,
    useCount: e.useCount,
    tags: [...e.tags],
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
    ...(e.taskId !== undefined ? { taskId: e.taskId } : {}),
    ...(e.runId !== undefined ? { runId: e.runId } : {}),
  };
}

/** Map a facade episodic entry to its JSON shape. Pure. */
export function episodicDto(e: EpisodicMemoryItem): MemoryEpisodicDto {
  return {
    id: e.id,
    date: e.date,
    content: e.content,
    eventType: e.eventType,
    ...(e.taskId !== undefined ? { taskId: e.taskId } : {}),
  };
}

/**
 * Narrow a listing to what one run wrote. Semantic and procedural entries match on
 * their `runId`; episodic entries carry only a `taskId`, so they match the run id or
 * any task id the run's semantic/procedural entries recorded. Pure.
 */
export function listingForRun(listing: MemoryListing, runId: string): MemoryListing {
  const semantic = listing.semantic.filter((e) => e.runId === runId);
  const procedural = listing.procedural.filter((e) => e.runId === runId);
  const taskIds = new Set<string>([runId]);
  for (const e of [...semantic, ...procedural]) if (e.taskId) taskIds.add(e.taskId);
  const episodic = listing.episodic.filter((e) => e.taskId !== undefined && taskIds.has(e.taskId));
  return { ...listing, semantic, procedural, episodic };
}

/** The database the framework uses for an agent built with a bare `.withMemory()`. */
export function memoryDbPathOf(agentId: string): string {
  return defaultUserMemoryPath(agentId);
}

/** Agent ids with a memory database under the framework's memory root (`~/.reactive-agents/memory`). */
export function agentIdsWithMemory(): string[] {
  const root = dirname(dirname(defaultUserMemoryPath("_probe")));
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "memory.db")))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

const errorText = (e: unknown): string => {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
};

const isNotFound = (e: unknown): boolean =>
  !!e && typeof e === "object" && "_tag" in e && (e as { _tag: unknown })._tag === "MemoryNotFoundError";

/** Agent ids name a directory under the memory root: no separators, no dot-dot. */
export function isSafeAgentId(agentId: string): boolean {
  return agentId.length > 0 && agentId.length <= 200 && !/[\\/\0]/.test(agentId) && agentId !== "." && agentId !== "..";
}

interface Built {
  readonly memory: AgentMemoryHandle;
  readonly dispose: () => Promise<void>;
}

/** Default list sizes: the studio shows a working set, search reaches the rest. */
const LIST_LIMIT = { semantic: 500, procedural: 500, episodic: 200 } as const;

/**
 * Per-agent `agent.memory()` handles, built on demand and cached.
 * Construct one per server; call {@link disposeAll} on shutdown.
 */
export class MemoryInspector {
  private readonly agents = new Map<string, Promise<Built>>();

  constructor(private readonly dbPathOf: (agentId: string) => string = memoryDbPathOf) {}

  /** The memory handle for an agent, or `undefined` when it has no database (nothing is created). */
  private async handle(agentId: string): Promise<AgentMemoryHandle | undefined> {
    if (!isSafeAgentId(agentId)) return undefined;
    const dbPath = this.dbPathOf(agentId);
    if (!existsSync(dbPath)) return undefined;
    let pending = this.agents.get(agentId);
    if (!pending) {
      pending = ReactiveAgents.create()
        .withName("cortex-memory-studio")
        .withAgentId(agentId)
        .withProvider("test")
        .withMemory({ dbPath })
        .build()
        .then((agent) => ({ memory: agent.memory(), dispose: () => agent.dispose() }));
      this.agents.set(agentId, pending);
      pending.catch(() => this.agents.delete(agentId));
    }
    return (await pending).memory;
  }

  private async call<A>(agentId: string, f: (m: AgentMemoryHandle) => Promise<A>): Promise<MemoryResult<A>> {
    try {
      const m = await this.handle(agentId);
      if (!m) return { ok: false, reason: "missing", error: `No memory database for agent "${agentId}"` };
      return { ok: true, value: await f(m) };
    } catch (e) {
      return { ok: false, reason: isNotFound(e) ? "missing" : "error", error: errorText(e) };
    }
  }

  /** Semantic, procedural and episodic entries; `runId` narrows to what that run wrote. */
  async list(agentId: string, opts: { readonly runId?: string } = {}): Promise<MemoryResult<MemoryListing>> {
    const dbPath = isSafeAgentId(agentId) ? this.dbPathOf(agentId) : "";
    const empty: MemoryListing = { agentId, available: false, dbPath, semantic: [], procedural: [], episodic: [] };
    if (!isSafeAgentId(agentId) || !existsSync(dbPath)) return { ok: true, value: empty };
    const r = await this.call(agentId, async (m) => {
      const [semantic, procedural, episodic] = await Promise.all([
        m.semantic.list({ limit: LIST_LIMIT.semantic }),
        m.procedural.list({ limit: LIST_LIMIT.procedural }),
        m.episodic.list({ limit: LIST_LIMIT.episodic }),
      ]);
      const listing: MemoryListing = {
        agentId,
        available: true,
        dbPath,
        semantic: semantic.map(semanticDto),
        procedural: procedural.map(proceduralDto),
        episodic: episodic.map(episodicDto),
      };
      return opts.runId ? listingForRun(listing, opts.runId) : listing;
    });
    return r;
  }

  /** Full-text search over semantic memory (framework FTS5, LIKE fallback). */
  search(
    agentId: string,
    query: string,
    opts: { readonly runId?: string; readonly limit?: number } = {},
  ): Promise<MemoryResult<MemorySemanticDto[]>> {
    return this.call(agentId, async (m) =>
      (
        await m.search(query, {
          limit: opts.limit ?? 50,
          ...(opts.runId ? { runId: opts.runId } : {}),
        })
      ).map(semanticDto),
    );
  }

  /** Edit a semantic entry. `missing` for an unknown id. */
  updateSemantic(agentId: string, id: string, patch: SemanticMemoryPatch): Promise<MemoryResult<MemorySemanticDto>> {
    return this.call(agentId, async (m) => semanticDto(await m.semantic.update(id, patch)));
  }

  /** Delete a semantic entry (unknown ids are a no-op). */
  deleteSemantic(agentId: string, id: string): Promise<MemoryResult<true>> {
    return this.call(agentId, async (m) => {
      await m.semantic.delete(id);
      return true as const;
    });
  }

  /** Edit a procedural entry. `missing` for an unknown id. */
  updateProcedural(agentId: string, id: string, patch: ProceduralMemoryPatch): Promise<MemoryResult<MemoryProceduralDto>> {
    return this.call(agentId, async (m) => proceduralDto(await m.procedural.update(id, patch)));
  }

  /** Delete a procedural entry (unknown ids are a no-op). */
  deleteProcedural(agentId: string, id: string): Promise<MemoryResult<true>> {
    return this.call(agentId, async (m) => {
      await m.procedural.delete(id);
      return true as const;
    });
  }

  /** Dispose every built agent. */
  async disposeAll(): Promise<void> {
    const all = [...this.agents.values()];
    this.agents.clear();
    await Promise.allSettled(all.map(async (p) => (await p).dispose()));
  }
}
