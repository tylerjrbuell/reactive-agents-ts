/**
 * Node.js database adapter — wraps better-sqlite3 behind DatabaseAdapter.
 */
import type { DatabaseAdapter, StatementAdapter } from "../types.js";

function wrapStatement(stmt: any): StatementAdapter {
  return {
    run(...params: unknown[]): void {
      stmt.run(...params);
    },
    get<T = unknown>(...params: unknown[]): T | undefined {
      const result = stmt.get(...params);
      return (result == null ? undefined : result) as T | undefined;
    },
    all<T = unknown>(...params: unknown[]): T[] {
      return stmt.all(...params) as T[];
    },
  };
}

export function createNodeDatabase(
  path: string,
  options?: { create?: boolean; readonly?: boolean },
): DatabaseAdapter {
  let BetterSqlite3: any;
  try {
    BetterSqlite3 = require("better-sqlite3");
  } catch {
    throw new Error(
      "SQLite support on Node.js requires better-sqlite3. Install it:\n" +
        "  npm install better-sqlite3\n" +
        "  # or: yarn add better-sqlite3",
    );
  }

  // better-sqlite3 uses { readonly, fileMustExist } — not { create }.
  // "create: true" (default) maps to fileMustExist: false.
  const db = new BetterSqlite3(path, {
    readonly: options?.readonly ?? false,
    fileMustExist: !(options?.create ?? true),
  });

  return {
    prepare(sql: string): StatementAdapter {
      return wrapStatement(db.prepare(sql));
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    run(sql: string, ...params: unknown[]): void {
      db.prepare(sql).run(...params);
    },

    queryAll<T = unknown>(sql: string, ...params: unknown[]): T[] {
      return db.prepare(sql).all(...params) as T[];
    },

    queryOne<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
      const result = db.prepare(sql).get(...params);
      return (result == null ? undefined : result) as T | undefined;
    },

    close(): void {
      db.close();
    },

    get isOpen(): boolean {
      return db.open;
    },
  };
}
