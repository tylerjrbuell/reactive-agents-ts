import { Database } from "bun:sqlite";
import type { DatabaseAdapter, DatabaseFactory, StatementAdapter } from "../types.js";

function wrapStatement(stmt: ReturnType<Database["prepare"]>): StatementAdapter {
  return {
    run(...params: unknown[]): void {
      stmt.run(...(params as Parameters<typeof stmt.run>));
    },
    get<T = unknown>(...params: unknown[]): T | undefined {
      return stmt.get(...(params as Parameters<typeof stmt.get>)) as T | undefined;
    },
    all<T = unknown>(...params: unknown[]): T[] {
      return stmt.all(...(params as Parameters<typeof stmt.all>)) as T[];
    },
    finalize(): void {
      stmt.finalize();
    },
  };
}

export function createBunDatabase(
  path: string,
  options?: { create?: boolean; readonly?: boolean },
): DatabaseAdapter {
  const create = options?.create ?? true;
  const readonly = options?.readonly ?? false;

  const db = new Database(path, { create, readonly });
  let open = true;

  return {
    prepare(sql: string): StatementAdapter {
      return wrapStatement(db.prepare(sql));
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    run(sql: string, ...params: unknown[]): void {
      db.prepare(sql).run(...(params as Parameters<ReturnType<Database["prepare"]>["run"]>));
    },

    queryAll<T = unknown>(sql: string, ...params: unknown[]): T[] {
      return db.prepare(sql).all(...(params as Parameters<ReturnType<Database["prepare"]>["all"]>)) as T[];
    },

    queryOne<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
      return db.prepare(sql).get(...(params as Parameters<ReturnType<Database["prepare"]>["get"]>)) as T | undefined;
    },

    close(): void {
      db.close();
      open = false;
    },

    get isOpen(): boolean {
      return open;
    },
  };
}
