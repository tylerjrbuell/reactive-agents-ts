import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

interface EpisodicRow {
  id: string;
  date: string;
  content: string;
  task_id: string | null;
  event_type: string | null;
  created_at: number;
}

interface SemanticRow {
  id: string;
  content: string;
  summary: string | null;
  importance: number;
  tags: string | null;
  created_at: number;
  access_count: number;
}

interface SessionRow {
  id: string;
  summary: string | null;
  key_decisions: string | null;
  started_at: number;
  ended_at: number | null;
  total_tokens: number;
}

interface ProceduralRow {
  id: string;
  name: string;
  description: string | null;
  success_rate: number;
  use_count: number;
}

export const memoryRouter = () =>
  new Elysia({ prefix: "/api/memory" }).get("/:agentId", ({ params, set }) => {
    const { agentId } = params;
    const dbPath = `.reactive-agents/memory/${agentId}/memory.db`;

    if (!existsSync(dbPath)) {
      return { agentId, available: false, episodic: [], semantic: [], procedural: [], sessions: [] };
    }

    let db: Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });

      const episodic: EpisodicRow[] = db
        .prepare(
          `SELECT id, date, content, task_id, event_type, created_at
           FROM episodic_log
           ORDER BY created_at DESC
           LIMIT 50`,
        )
        .all() as EpisodicRow[];

      const semantic: SemanticRow[] = db
        .prepare(
          `SELECT id, content, summary, importance, tags, created_at, access_count
           FROM semantic_memory
           ORDER BY importance DESC, access_count DESC
           LIMIT 30`,
        )
        .all() as SemanticRow[];

      const procedural: ProceduralRow[] = db
        .prepare(
          `SELECT id, name, description, success_rate, use_count
           FROM procedural_memory
           ORDER BY use_count DESC
           LIMIT 20`,
        )
        .all() as ProceduralRow[];

      const sessions: SessionRow[] = db
        .prepare(
          `SELECT id, summary, key_decisions, started_at, ended_at, total_tokens
           FROM session_snapshots
           ORDER BY started_at DESC
           LIMIT 10`,
        )
        .all() as SessionRow[];

      return {
        agentId,
        available: true,
        episodic: episodic.map((r) => ({
          id: r.id,
          date: r.date,
          content: r.content,
          taskId: r.task_id,
          eventType: r.event_type,
          createdAt: r.created_at,
        })),
        semantic: semantic.map((r) => ({
          id: r.id,
          content: r.content,
          summary: r.summary,
          importance: r.importance,
          tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
          createdAt: r.created_at,
          accessCount: r.access_count,
        })),
        procedural: procedural.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          successRate: r.success_rate,
          useCount: r.use_count,
        })),
        sessions: sessions.map((r) => ({
          id: r.id,
          summary: r.summary,
          keyDecisions: r.key_decisions
            ? (JSON.parse(r.key_decisions) as string[])
            : [],
          startedAt: r.started_at,
          endedAt: r.ended_at,
          totalTokens: r.total_tokens,
        })),
      };
    } catch (e) {
      set.status = 500;
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      db?.close();
    }
  });
