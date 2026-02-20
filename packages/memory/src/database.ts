import { Effect, Context, Layer } from "effect";
import { Database } from "bun:sqlite";
import { DatabaseError } from "./errors.js";
import type { MemoryConfig } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Service Interface (extracted to break circular reference) ───

export interface MemoryDatabaseService {
  /** Execute a query with parameters. Returns rows. */
  readonly query: <T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ) => Effect.Effect<T[], DatabaseError>;

  /** Execute a statement (INSERT/UPDATE/DELETE). Returns changes count. */
  readonly exec: (
    sql: string,
    params?: readonly unknown[],
  ) => Effect.Effect<number, DatabaseError>;

  /** Execute multiple statements in a transaction. */
  readonly transaction: <T>(
    fn: (db: MemoryDatabaseService) => Effect.Effect<T, DatabaseError>,
  ) => Effect.Effect<T, DatabaseError>;

  /** Close the database connection. */
  readonly close: () => Effect.Effect<void, never>;
}

// ─── Service Tag ───

export class MemoryDatabase extends Context.Tag("MemoryDatabase")<
  MemoryDatabase,
  MemoryDatabaseService
>() {}

// ─── Schema SQL ───

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS semantic_memory (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    content     TEXT NOT NULL,
    summary     TEXT NOT NULL,
    importance  REAL NOT NULL DEFAULT 0.5,
    verified    INTEGER NOT NULL DEFAULT 0,
    tags        TEXT NOT NULL DEFAULT '[]',
    embedding   BLOB,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS episodic_log (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    date        TEXT NOT NULL,
    content     TEXT NOT NULL,
    task_id     TEXT,
    event_type  TEXT NOT NULL,
    cost        REAL,
    duration    REAL,
    metadata    TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_snapshots (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    messages    TEXT NOT NULL,
    summary     TEXT NOT NULL,
    key_decisions TEXT NOT NULL DEFAULT '[]',
    task_ids    TEXT NOT NULL DEFAULT '[]',
    started_at  TEXT NOT NULL,
    ended_at    TEXT NOT NULL,
    total_cost  REAL NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS procedural_memory (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    pattern     TEXT NOT NULL,
    success_rate REAL NOT NULL DEFAULT 0,
    use_count   INTEGER NOT NULL DEFAULT 0,
    tags        TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS zettel_links (
    source_id   TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    strength    REAL NOT NULL DEFAULT 0,
    type        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id)
  );

  -- FTS5 virtual table for full-text search (Tier 1 semantic search)
  CREATE VIRTUAL TABLE IF NOT EXISTS semantic_fts USING fts5(
    id UNINDEXED,
    content,
    tags,
    content='semantic_memory',
    content_rowid='rowid'
  );

  -- FTS5 for episodic log
  CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
    id UNINDEXED,
    content,
    content='episodic_log',
    content_rowid='rowid'
  );

  -- Triggers to keep FTS5 in sync
  CREATE TRIGGER IF NOT EXISTS semantic_fts_insert
    AFTER INSERT ON semantic_memory BEGIN
      INSERT INTO semantic_fts(rowid, id, content, tags)
      VALUES (new.rowid, new.id, new.content, new.tags);
    END;

  CREATE TRIGGER IF NOT EXISTS semantic_fts_delete
    AFTER DELETE ON semantic_memory BEGIN
      INSERT INTO semantic_fts(semantic_fts, rowid, id, content, tags)
      VALUES ('delete', old.rowid, old.id, old.content, old.tags);
    END;

  CREATE TRIGGER IF NOT EXISTS semantic_fts_update
    AFTER UPDATE ON semantic_memory BEGIN
      INSERT INTO semantic_fts(semantic_fts, rowid, id, content, tags)
      VALUES ('delete', old.rowid, old.id, old.content, old.tags);
      INSERT INTO semantic_fts(rowid, id, content, tags)
      VALUES (new.rowid, new.id, new.content, new.tags);
    END;

  CREATE TRIGGER IF NOT EXISTS episodic_fts_insert
    AFTER INSERT ON episodic_log BEGIN
      INSERT INTO episodic_fts(rowid, id, content)
      VALUES (new.rowid, new.id, new.content);
    END;

  CREATE TRIGGER IF NOT EXISTS episodic_fts_delete
    AFTER DELETE ON episodic_log BEGIN
      INSERT INTO episodic_fts(episodic_fts, rowid, id, content)
      VALUES ('delete', old.rowid, old.id, old.content);
    END;

  CREATE TRIGGER IF NOT EXISTS episodic_fts_update
    AFTER UPDATE ON episodic_log BEGIN
      INSERT INTO episodic_fts(episodic_fts, rowid, id, content)
      VALUES ('delete', old.rowid, old.id, old.content);
      INSERT INTO episodic_fts(rowid, id, content)
      VALUES (new.rowid, new.id, new.content);
    END;
`;

// ─── Live Implementation ───

export const MemoryDatabaseLive = (config: MemoryConfig) =>
  Layer.scoped(
    MemoryDatabase,
    Effect.gen(function* () {
      // Ensure directory exists
      const dbDir = path.dirname(config.dbPath);
      yield* Effect.sync(() => {
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
      });

      // Open SQLite connection
      const db = yield* Effect.try({
        try: () => new Database(config.dbPath, { create: true }),
        catch: (e) =>
          new DatabaseError({
            message: `Failed to open database: ${e}`,
            operation: "migrate",
            cause: e,
          }),
      });

      // Run schema migrations
      yield* Effect.try({
        try: () => db.exec(SCHEMA_SQL),
        catch: (e) =>
          new DatabaseError({
            message: `Schema migration failed: ${e}`,
            operation: "migrate",
            cause: e,
          }),
      });

      // Register finalizer to close DB cleanly
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          try {
            db.close();
          } catch {
            /* ignore */
          }
        }),
      );

      const service: MemoryDatabaseService = {
        query: <T>(sql: string, params: readonly unknown[] = []) =>
          Effect.try({
            try: () => {
              const stmt = db.prepare(sql);
              return stmt.all(...(params as any[])) as T[];
            },
            catch: (e) =>
              new DatabaseError({
                message: `Query failed: ${e}\nSQL: ${sql}`,
                operation: "read",
                cause: e,
              }),
          }),

        exec: (sql: string, params: readonly unknown[] = []) =>
          Effect.try({
            try: () => {
              const stmt = db.prepare(sql);
              const result = stmt.run(...(params as any[]));
              return result.changes;
            },
            catch: (e) =>
              new DatabaseError({
                message: `Exec failed: ${e}\nSQL: ${sql}`,
                operation: "write",
                cause: e,
              }),
          }),

        transaction: <T>(fn: (db: MemoryDatabaseService) => Effect.Effect<T, DatabaseError>) =>
          Effect.gen(function* () {
            let result: unknown;
            yield* Effect.try({
              try: () => {
                const txn = db.transaction(() => {
                  result = Effect.runSync(fn(service));
                });
                txn();
              },
              catch: (e) =>
                new DatabaseError({
                  message: `Transaction failed: ${e}`,
                  operation: "write",
                  cause: e,
                }),
            });
            return result as T;
          }),

        close: () =>
          Effect.sync(() => {
            try {
              db.close();
            } catch {
              /* ignore */
            }
          }),
      };

      return service;
    }),
  );
