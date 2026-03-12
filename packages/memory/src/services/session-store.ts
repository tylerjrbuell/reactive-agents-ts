import { Effect, Context, Layer } from "effect";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChatMessageShape {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface SessionRecord {
  sessionId: string;
  agentId: string;
  messages: ChatMessageShape[];
  createdAt: number;
  updatedAt: number;
}

export interface SaveSessionInput {
  sessionId: string;
  agentId: string;
  messages: ChatMessageShape[];
}

// ─── Service Tag ─────────────────────────────────────────────────────────────

export class SessionStoreService extends Context.Tag("SessionStoreService")<
  SessionStoreService,
  {
    /** Persist or update a chat session (upsert keyed on sessionId). */
    readonly save: (input: SaveSessionInput) => Effect.Effect<void, DatabaseError>;

    /** Look up a session by its unique session ID. Returns null if not found. */
    readonly findById: (sessionId: string) => Effect.Effect<SessionRecord | null, DatabaseError>;

    /** List all sessions for an agent, newest first, up to limit. */
    readonly listByAgent: (agentId: string, limit: number) => Effect.Effect<SessionRecord[], DatabaseError>;

    /** Delete sessions older than maxAgeDays. Returns the number of rows deleted. */
    readonly cleanup: (maxAgeDays: number) => Effect.Effect<number, DatabaseError>;
  }
>() {}

// ─── Live Layer ──────────────────────────────────────────────────────────────

export const SessionStoreLive: Layer.Layer<
  SessionStoreService,
  DatabaseError,
  MemoryDatabase
> = Layer.effect(
  SessionStoreService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    // Create table + indexes (safe: IF NOT EXISTS)
    yield* db.exec(
      `CREATE TABLE IF NOT EXISTS chat_sessions (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL UNIQUE,
        agent_id     TEXT NOT NULL,
        messages     TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      )`,
      [],
    );
    yield* db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON chat_sessions(agent_id)`,
      [],
    );
    yield* db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_updated  ON chat_sessions(updated_at DESC)`,
      [],
    );

    const save = (input: SaveSessionInput): Effect.Effect<void, DatabaseError> => {
      const now = Date.now();
      return db
        .exec(
          `INSERT INTO chat_sessions (id, session_id, agent_id, messages, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             messages   = excluded.messages,
             updated_at = excluded.updated_at`,
          [
            `sess_${now}_${Math.random().toString(36).slice(2, 8)}`,
            input.sessionId,
            input.agentId,
            JSON.stringify(input.messages),
            now,
            now,
          ],
        )
        .pipe(Effect.asVoid);
    };

    const findById = (
      sessionId: string,
    ): Effect.Effect<SessionRecord | null, DatabaseError> =>
      db
        .query<Record<string, unknown>>(
          `SELECT * FROM chat_sessions WHERE session_id = ? LIMIT 1`,
          [sessionId],
        )
        .pipe(
          Effect.map((rows) => (rows.length > 0 ? rowToRecord(rows[0]!) : null)),
        );

    const listByAgent = (
      agentId: string,
      limit: number,
    ): Effect.Effect<SessionRecord[], DatabaseError> =>
      db
        .query<Record<string, unknown>>(
          `SELECT * FROM chat_sessions WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?`,
          [agentId, limit],
        )
        .pipe(Effect.map((rows) => rows.map(rowToRecord)));

    const cleanup = (maxAgeDays: number): Effect.Effect<number, DatabaseError> => {
      const cutoff = Date.now() - maxAgeDays * 86400000;
      return Effect.gen(function* () {
        // Count rows to be deleted first (works with any db mock)
        const rows = yield* db.query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM chat_sessions WHERE updated_at < ?`,
          [cutoff],
        );
        const count = rows[0]?.cnt ?? 0;
        yield* db.exec(`DELETE FROM chat_sessions WHERE updated_at < ?`, [cutoff]);
        return count;
      });
    };

    return { save, findById, listByAgent, cleanup };
  }),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): SessionRecord {
  return {
    sessionId: row.session_id as string,
    agentId: row.agent_id as string,
    messages: JSON.parse(row.messages as string) as ChatMessageShape[],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}
