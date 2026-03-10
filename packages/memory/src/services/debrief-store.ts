import { Context, Effect, Layer } from "effect";
import { Database } from "bun:sqlite";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Mirror of AgentDebrief from @reactive-agents/runtime.
 * Defined inline to avoid a circular package dependency
 * (runtime depends on memory, not the other way around).
 */
export interface AgentDebriefShape {
  outcome: string;
  summary: string;
  keyFindings: readonly string[];
  errorsEncountered: readonly string[];
  lessonsLearned: readonly string[];
  confidence: string;
  toolsUsed: readonly { name: string; calls: number; successRate: number }[];
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
  markdown: string;
}

export interface DebriefRecord {
  taskId: string;
  agentId: string;
  taskPrompt: string;
  terminatedBy: string;
  output: string;
  outputFormat: string;
  debrief: AgentDebriefShape;
  createdAt: number;
}

export interface SaveDebriefInput {
  taskId: string;
  agentId: string;
  taskPrompt: string;
  terminatedBy: string;
  output: string;
  outputFormat: string;
  debrief: AgentDebriefShape;
}

// ─── Service Interface ─────────────────────────────────────────────────────

export interface IDebriefStore {
  save(input: SaveDebriefInput): Effect.Effect<void, never>;
  findByTaskId(taskId: string): Effect.Effect<DebriefRecord | null, never>;
  listByAgent(agentId: string, limit: number): Effect.Effect<DebriefRecord[], never>;
}

export class DebriefStoreService extends Context.Tag("DebriefStoreService")<
  DebriefStoreService,
  IDebriefStore
>() {}

// ─── Live Layer ─────────────────────────────────────────────────────────────

export const DebriefStoreLive = (dbPath: string): Layer.Layer<DebriefStoreService> =>
  Layer.effect(
    DebriefStoreService,
    Effect.sync(() => {
      const db = new Database(dbPath, { create: true });
      db.run("PRAGMA journal_mode=WAL;");
      db.run(`
        CREATE TABLE IF NOT EXISTS agent_debriefs (
          id              TEXT PRIMARY KEY,
          task_id         TEXT NOT NULL,
          agent_id        TEXT NOT NULL,
          created_at      INTEGER NOT NULL,
          task_prompt     TEXT NOT NULL,
          terminated_by   TEXT NOT NULL,
          output          TEXT NOT NULL,
          output_format   TEXT NOT NULL,
          debrief_json    TEXT NOT NULL,
          debrief_markdown TEXT NOT NULL,
          tokens_used     INTEGER,
          duration_ms     INTEGER,
          iterations      INTEGER,
          outcome         TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_debriefs_agent_id ON agent_debriefs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_debriefs_task_id ON agent_debriefs(task_id);
        CREATE INDEX IF NOT EXISTS idx_debriefs_created_at ON agent_debriefs(created_at DESC);
      `);

      const save = (input: SaveDebriefInput): Effect.Effect<void, never> =>
        Effect.sync(() => {
          const id = `dbrf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const now = Date.now();
          db.prepare(`
            INSERT INTO agent_debriefs
              (id, task_id, agent_id, created_at, task_prompt, terminated_by,
               output, output_format, debrief_json, debrief_markdown,
               tokens_used, duration_ms, iterations, outcome)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            input.taskId,
            input.agentId,
            now,
            input.taskPrompt,
            input.terminatedBy,
            input.output,
            input.outputFormat,
            JSON.stringify(input.debrief),
            input.debrief.markdown,
            input.debrief.metrics.tokens,
            input.debrief.metrics.duration,
            input.debrief.metrics.iterations,
            input.debrief.outcome,
          );
        });

      const findByTaskId = (taskId: string): Effect.Effect<DebriefRecord | null, never> =>
        Effect.sync(() => {
          const row = db.prepare(
            "SELECT * FROM agent_debriefs WHERE task_id = ? LIMIT 1"
          ).get(taskId) as Record<string, unknown> | null;
          if (!row) return null;
          return rowToRecord(row);
        });

      const listByAgent = (agentId: string, limit: number): Effect.Effect<DebriefRecord[], never> =>
        Effect.sync(() => {
          const rows = db.prepare(
            "SELECT * FROM agent_debriefs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?"
          ).all(agentId, limit) as Record<string, unknown>[];
          return rows.map(rowToRecord);
        });

      return { save, findByTaskId, listByAgent };
    })
  );

function rowToRecord(row: Record<string, unknown>): DebriefRecord {
  return {
    taskId: row.task_id as string,
    agentId: row.agent_id as string,
    taskPrompt: row.task_prompt as string,
    terminatedBy: row.terminated_by as string,
    output: row.output as string,
    outputFormat: row.output_format as string,
    debrief: JSON.parse(row.debrief_json as string) as AgentDebriefShape,
    createdAt: row.created_at as number,
  };
}
