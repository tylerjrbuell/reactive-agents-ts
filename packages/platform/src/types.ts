// ── Database Adapter ──────────────────────────────────────────────────────

export interface StatementAdapter {
  run(...params: unknown[]): void;
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
  finalize?(): void;
}

export interface DatabaseAdapter {
  prepare(sql: string): StatementAdapter;
  exec(sql: string): void;
  run(sql: string, ...params: unknown[]): void;
  queryAll<T = unknown>(sql: string, ...params: unknown[]): T[];
  queryOne<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * NOTE: bun:sqlite supports `prepare<TRow, TParams>(sql)` generics.
 * better-sqlite3 does not. The StatementAdapter does NOT use generics —
 * all consumers must strip generic type parameters from prepare() calls
 * during migration and cast results manually.
 */

export type DatabaseFactory = (path: string, options?: { create?: boolean; readonly?: boolean }) => DatabaseAdapter;

// ── Process Adapter ───────────────────────────────────────────────────────

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface SpawnedProcess {
  readonly stdin: WritableStream | NodeJS.WritableStream | null;
  readonly stdout: ReadableStream | NodeJS.ReadableStream | null;
  readonly stderr: ReadableStream | NodeJS.ReadableStream | null;
  readonly pid: number | undefined;
  readonly exited: Promise<number>;
  writeStdin(data: Uint8Array): Promise<void>;
  flushStdin(): Promise<void>;
  kill(signal?: number): void;
}

export interface ProcessAdapter {
  spawn(cmd: string[], options?: {
    cwd?: string;
    env?: Record<string, string>;
    stdin?: "pipe" | "inherit" | "ignore";
    stdout?: "pipe" | "inherit" | "ignore";
    stderr?: "pipe" | "inherit" | "ignore";
  }): SpawnedProcess;

  exec(cmd: string[], options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<ProcessResult>;
}

// ── Server Adapter ────────────────────────────────────────────────────────

export interface ServerHandle {
  readonly port: number;
  readonly hostname: string;
  stop(): Promise<void>;
}

export interface ServerAdapter {
  serve(options: {
    port: number;
    hostname?: string;
    fetch: (request: Request) => Response | Promise<Response>;
  }): Promise<ServerHandle>;
}

// ── Platform Bundle ───────────────────────────────────────────────────────

export interface PlatformAdapters {
  readonly runtime: "bun" | "node";
  readonly database: DatabaseFactory;
  readonly process: ProcessAdapter;
  readonly server: ServerAdapter;
}
