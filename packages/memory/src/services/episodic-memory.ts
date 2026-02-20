import { Effect, Context, Layer } from "effect";
import type { DailyLogEntry, SessionSnapshot, MemoryId } from "../types.js";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Service Tag ───

export class EpisodicMemoryService extends Context.Tag("EpisodicMemoryService")<
  EpisodicMemoryService,
  {
    /** Log an episodic event. */
    readonly log: (
      entry: DailyLogEntry,
    ) => Effect.Effect<MemoryId, DatabaseError>;

    /** Get today's log for an agent. */
    readonly getToday: (
      agentId: string,
    ) => Effect.Effect<DailyLogEntry[], DatabaseError>;

    /** Get recent log entries (newest first). */
    readonly getRecent: (
      agentId: string,
      limit: number,
    ) => Effect.Effect<DailyLogEntry[], DatabaseError>;

    /** Get entries by task ID. */
    readonly getByTask: (
      taskId: string,
    ) => Effect.Effect<DailyLogEntry[], DatabaseError>;

    /** Save a session snapshot. */
    readonly saveSnapshot: (
      snapshot: SessionSnapshot,
    ) => Effect.Effect<void, DatabaseError>;

    /** Get the most recent session snapshot for an agent. */
    readonly getLatestSnapshot: (
      agentId: string,
    ) => Effect.Effect<SessionSnapshot | null, DatabaseError>;

    /** Prune entries older than retainDays. */
    readonly prune: (
      agentId: string,
      retainDays: number,
    ) => Effect.Effect<number, DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const EpisodicMemoryServiceLive = Layer.effect(
  EpisodicMemoryService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    const rowToEntry = (r: Record<string, unknown>): DailyLogEntry => ({
      id: r.id as MemoryId,
      agentId: r.agent_id as string,
      date: r.date as string,
      content: r.content as string,
      taskId: (r.task_id as string | null) ?? undefined,
      eventType: r.event_type as DailyLogEntry["eventType"],
      cost: (r.cost as number | null) ?? undefined,
      duration: (r.duration as number | null) ?? undefined,
      metadata: JSON.parse((r.metadata as string) ?? "{}"),
      createdAt: new Date(r.created_at as string),
    });

    return {
      log: (entry) =>
        Effect.gen(function* () {
          yield* db.exec(
            `INSERT INTO episodic_log
             (id, agent_id, date, content, task_id, event_type, cost, duration, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.agentId,
              entry.date,
              entry.content,
              entry.taskId ?? null,
              entry.eventType,
              entry.cost ?? null,
              entry.duration ?? null,
              JSON.stringify(entry.metadata ?? {}),
              entry.createdAt.toISOString(),
            ],
          );
          return entry.id;
        }),

      getToday: (agentId) => {
        const today = new Date().toISOString().slice(0, 10);
        return db
          .query(
            `SELECT * FROM episodic_log WHERE agent_id = ? AND date = ? ORDER BY created_at DESC`,
            [agentId, today],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry)));
      },

      getRecent: (agentId, limit) =>
        db
          .query(
            `SELECT * FROM episodic_log WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
            [agentId, limit],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry))),

      getByTask: (taskId) =>
        db
          .query(
            `SELECT * FROM episodic_log WHERE task_id = ? ORDER BY created_at ASC`,
            [taskId],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry))),

      saveSnapshot: (snapshot) =>
        db
          .exec(
            `INSERT OR REPLACE INTO session_snapshots
             (id, agent_id, messages, summary, key_decisions, task_ids, started_at, ended_at, total_cost, total_tokens)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              snapshot.id,
              snapshot.agentId,
              JSON.stringify(snapshot.messages),
              snapshot.summary,
              JSON.stringify(snapshot.keyDecisions),
              JSON.stringify(snapshot.taskIds),
              snapshot.startedAt.toISOString(),
              snapshot.endedAt.toISOString(),
              snapshot.totalCost,
              snapshot.totalTokens,
            ],
          )
          .pipe(Effect.asVoid),

      getLatestSnapshot: (agentId) =>
        db
          .query(
            `SELECT * FROM session_snapshots WHERE agent_id = ? ORDER BY ended_at DESC LIMIT 1`,
            [agentId],
          )
          .pipe(
            Effect.map((rows) => {
              if (rows.length === 0) return null;
              const r = rows[0]! as Record<string, unknown>;
              return {
                id: r.id as string,
                agentId: r.agent_id as string,
                messages: JSON.parse(r.messages as string),
                summary: r.summary as string,
                keyDecisions: JSON.parse(r.key_decisions as string),
                taskIds: JSON.parse(r.task_ids as string),
                startedAt: new Date(r.started_at as string),
                endedAt: new Date(r.ended_at as string),
                totalCost: r.total_cost as number,
                totalTokens: r.total_tokens as number,
              } satisfies SessionSnapshot;
            }),
          ),

      prune: (agentId, retainDays) => {
        const cutoff = new Date(
          Date.now() - retainDays * 86_400_000,
        ).toISOString();
        return db.exec(
          `DELETE FROM episodic_log WHERE agent_id = ? AND created_at < ?`,
          [agentId, cutoff],
        );
      },
    };
  }),
);
