import { createRequire } from "node:module";
import { isBun } from "./detect.js";
import type { DatabaseConstructor, DatabaseLike, StatementLike } from "./types.js";

let _require: NodeJS.Require | undefined;
function nodeRequire(): NodeJS.Require {
  return (_require ??= createRequire(import.meta.url));
}

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
      if (options) {
        const opts = { open: options.create ?? true, readOnly: options.readonly ?? false };
        this.db = new NodeDb(path, opts);
      } else {
        this.db = new NodeDb(path);
      }
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
    transaction<F extends (...args: never[]) => unknown>(fn: F): F {
      const wrapped = (...args: never[]) => {
        this.db.exec("BEGIN");
        try {
          const result = fn(...args);
          this.db.exec("COMMIT");
          return result;
        } catch (err) {
          this.db.exec("ROLLBACK");
          throw err;
        }
      };
      return wrapped as unknown as F;
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
    transaction<F extends (...args: never[]) => unknown>(fn: F): F {
      return fn;
    }
    close(): void {
      /* no-op */
    }
  }
  return StubDatabase as unknown as DatabaseConstructor;
}

function loadDatabase(): DatabaseConstructor {
  if (isBun) {
    try {
      const { Database: BunDatabase } = nodeRequire()("bun:sqlite") as typeof import("bun:sqlite");
      return BunDatabase as unknown as DatabaseConstructor;
    } catch {
      return createStubDatabase();
    }
  }
  try {
    // Node 22.5+ has node:sqlite. require() succeeding is NOT enough:
    // WebContainer/browser runtimes resolve the module but ship a
    // non-functional DatabaseSync (no working .exec) — that surfaced as
    // "this.db.exec is not a function" at runtime. Probe an in-memory
    // instance and fall back to the no-op stub if it isn't usable.
    const mod = nodeRequire()("node:sqlite") as {
      DatabaseSync: new (path: string, opts?: unknown) => NodeSqliteDatabase;
    };
    const probe = new mod.DatabaseSync(":memory:");
    if (typeof probe.exec !== "function" || typeof probe.prepare !== "function") {
      throw new Error("node:sqlite present but non-functional");
    }
    probe.exec("CREATE TABLE __probe__(x)");
    probe.close();
    return wrapNodeSqlite(mod.DatabaseSync);
  } catch {
    return createStubDatabase();
  }
}

let _impl: DatabaseConstructor | undefined;
function resolveDatabase(): DatabaseConstructor {
  return (_impl ??= loadDatabase());
}

/**
 * Cross-runtime SQLite database (`bun:sqlite` on Bun, `node:sqlite` on Node
 * 22.5+, an in-memory no-op stub where neither works).
 *
 * The backend loads lazily on the first `new Database(...)`, not at import.
 * Node prints `ExperimentalWarning: SQLite is an experimental feature` the
 * moment `node:sqlite` is loaded, so an eager load made every importer of the
 * package (agents with no memory, `rax-diagnose`) print it. The warning now
 * appears only when a database is actually opened.
 *
 * The constructor returns the backend's own instance, so prototype checks
 * against `Database` do not hold; type against `DatabaseLike` instead.
 */
class LazyDatabase {
  constructor(path: string, options?: { create?: boolean; readonly?: boolean }) {
    const Impl = resolveDatabase();
    // Returning an object from a constructor makes `new` yield it.
    return new Impl(path, options);
  }
}

export const Database: DatabaseConstructor = LazyDatabase as unknown as DatabaseConstructor;
