/**
 * Shared interface types for the runtime-shim package.
 * Each consumer implementation (bun-impl, node-impl, stub-impl) satisfies these.
 */

export interface StatementLike {
  run(...params: unknown[]): { changes: number; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown | undefined;
  all(...params: unknown[]): unknown[];
}

export interface DatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  /** Bun convenience: same as prepare() on Node-backed impls */
  query(sql: string): StatementLike;
  close(): void;
}

export interface DatabaseConstructor {
  new (path: string, options?: { create?: boolean; readonly?: boolean }): DatabaseLike;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "pipe" | "ignore" | "inherit";
  stdout?: "pipe" | "ignore" | "inherit";
  stderr?: "pipe" | "ignore" | "inherit";
  timeout?: number;
}

export interface SpawnResult {
  pid: number;
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  kill(signal?: string | number): void;
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
  fetch: (req: Request) => Response | Promise<Response>;
}

export interface ServerLike {
  port: number;
  hostname: string;
  url: URL;
  stop(closeActiveConnections?: boolean): void;
}

export interface GlobLike {
  scan(opts?: { cwd?: string; onlyFiles?: boolean }): AsyncIterable<string>;
}
