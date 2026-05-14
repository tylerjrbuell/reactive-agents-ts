import { createRequire } from "node:module";
import { isBun } from "./detect.js";
import type { DatabaseConstructor, DatabaseLike, StatementLike } from "./types.js";

const require = createRequire(import.meta.url);

// Node-sqlite shape (minimal subset we use)
interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}
interface NodeSqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

function wrapStatement(stmt: NodeSqliteStatement): StatementLike {
  return {
    run: (...params) => stmt.run(...params),
    get: (...params) => stmt.get(...params),
    all: (...params) => stmt.all(...params),
  };
}

function wrapNodeSqlite(
  NodeDb: new (path: string, opts?: unknown) => NodeSqliteDatabase,
): DatabaseConstructor {
  class WrappedDatabase implements DatabaseLike {
    private db: NodeSqliteDatabase;
    constructor(path: string, options?: { create?: boolean; readonly?: boolean }) {
      const opts = options
        ? { open: options.create ?? true, readOnly: options.readonly ?? false }
        : undefined;
      this.db = new NodeDb(path, opts);
    }
    exec(sql: string): void {
      this.db.exec(sql);
    }
    prepare(sql: string): StatementLike {
      return wrapStatement(this.db.prepare(sql));
    }
    query(sql: string): StatementLike {
      return wrapStatement(this.db.prepare(sql));
    }
    close(): void {
      this.db.close();
    }
  }
  return WrappedDatabase as unknown as DatabaseConstructor;
}

function createStubDatabase(): DatabaseConstructor {
  // In-memory stub — no persistence. Demos run, but no recall across processes.
  class StubDatabase implements DatabaseLike {
    constructor(_path: string, _opts?: unknown) {}
    exec(_sql: string): void {
      /* no-op */
    }
    prepare(_sql: string): StatementLike {
      return {
        run: () => ({ changes: 0 }),
        get: () => undefined,
        all: () => [],
      };
    }
    query(_sql: string): StatementLike {
      return this.prepare(_sql);
    }
    close(): void {
      /* no-op */
    }
  }
  return StubDatabase as unknown as DatabaseConstructor;
}

function loadDatabase(): DatabaseConstructor {
  if (isBun) {
    const { Database: BunDatabase } = require("bun:sqlite") as typeof import("bun:sqlite");
    return BunDatabase as unknown as DatabaseConstructor;
  }
  try {
    // Node 22.5+ has node:sqlite
    const mod = require("node:sqlite") as {
      DatabaseSync: new (path: string, opts?: unknown) => NodeSqliteDatabase;
    };
    return wrapNodeSqlite(mod.DatabaseSync);
  } catch {
    return createStubDatabase();
  }
}

export const Database: DatabaseConstructor = loadDatabase();
