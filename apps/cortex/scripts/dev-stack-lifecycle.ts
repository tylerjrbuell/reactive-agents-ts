/**
 * Pid-file lifecycle for the Cortex dev stack (`dev-stack.ts start | stop | status`).
 *
 * A started child is detached into its own process group and described by one pid file in the
 * runtime dir. `stop` and `status` act ONLY on pids named by those files, and only while the
 * pid's command line still looks like what was started (a recycled pid is never signalled).
 * A listener this module did not start is never adopted and never killed.
 *
 * Pure rules (`parsePidRecord`, `cmdlineMatches`, `classify`, `pidFileName`, `resolveRunDir`) take
 * their inputs as arguments; process and socket access sits behind {@link Probes} so tests can
 * drive the same code with dummy children.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";

/** Which half of the stack a pid file describes. */
export type StackRole = "server" | "ui";

/** The JSON stored in one pid file. */
export interface PidRecord {
  readonly pid: number;
  readonly port: number;
  readonly role: StackRole;
  /** The server port of the stack this child belongs to (equals `port` for the server). */
  readonly stackPort: number;
  readonly startedAt: string;
  readonly cwd: string;
  readonly dbPath?: string;
  /** The exact argv the child was started with; used to confirm a pid is still ours. */
  readonly argv: readonly string[];
}

/** How a recorded pid relates to the live process table. */
export type PidState = "alive" | "dead" | "reused";

/** Process and socket access, injectable for tests. */
export interface Probes {
  readonly isAlive: (pid: number) => boolean;
  /** The command line tokens of `pid`, or undefined when it cannot be read. */
  readonly readCmdline: (pid: number) => readonly string[] | undefined;
  readonly isListening: (port: number) => Promise<boolean>;
}

/** Runtime dir: `CORTEX_RUN_DIR` when set, else `<cwd>/.cortex-run`. */
export function resolveRunDir(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  const fromEnv = env.CORTEX_RUN_DIR?.trim();
  return fromEnv ? resolve(fromEnv) : join(cwd, ".cortex-run");
}

/** `server-4399.pid` style name for a role and port. */
export function pidFileName(role: StackRole, port: number): string {
  return `${role}-${port}.pid`;
}

const isPort = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n < 65536;

/** Parse and validate pid-file text; undefined for anything that is not a well-formed record. */
export function parsePidRecord(text: string): PidRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.pid !== "number" || !Number.isInteger(r.pid) || r.pid <= 1) return undefined;
  if (!isPort(r.port) || !isPort(r.stackPort)) return undefined;
  if (r.role !== "server" && r.role !== "ui") return undefined;
  if (typeof r.startedAt !== "string" || typeof r.cwd !== "string") return undefined;
  if (!Array.isArray(r.argv) || r.argv.length === 0 || !r.argv.every((a) => typeof a === "string")) return undefined;
  if (r.dbPath !== undefined && typeof r.dbPath !== "string") return undefined;
  return {
    pid: r.pid,
    port: r.port,
    role: r.role,
    stackPort: r.stackPort,
    startedAt: r.startedAt,
    cwd: r.cwd,
    ...(r.dbPath !== undefined ? { dbPath: r.dbPath } : {}),
    argv: r.argv as string[],
  };
}

/**
 * True when `cmdline` is still the process this record started: every argv token after the
 * executable appears in the live command line. An empty or foreign command line never matches.
 */
export function cmdlineMatches(record: PidRecord, cmdline: readonly string[]): boolean {
  if (cmdline.length === 0) return false;
  const live = new Set(cmdline);
  return record.argv.slice(1).every((token) => live.has(token));
}

/** Classify a record: dead pid, a live pid that is no longer ours (reused), or alive and ours. */
export function classify(record: PidRecord, probes: Pick<Probes, "isAlive" | "readCmdline">): PidState {
  if (!probes.isAlive(record.pid)) return "dead";
  const cmdline = probes.readCmdline(record.pid);
  if (cmdline === undefined) return "reused"; // unverifiable: treat as not ours, never signal it
  return cmdlineMatches(record, cmdline) ? "alive" : "reused";
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Real process and socket probes (Linux `/proc`, `ps` elsewhere). */
export const realProbes: Probes = {
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  readCmdline(pid) {
    try {
      const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return raw.split("\0").filter((t) => t.length > 0);
    } catch {
      /* no /proc: fall through to ps */
    }
    try {
      const out = execFileSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" }).trim();
      return out ? out.split(/\s+/) : undefined;
    } catch {
      return undefined;
    }
  },
  isListening(port) {
    return new Promise((done) => {
      const sock = createConnection({ port, host: "127.0.0.1" });
      const finish = (v: boolean): void => {
        sock.destroy();
        done(v);
      };
      sock.setTimeout(500, () => finish(false));
      sock.once("connect", () => finish(true));
      sock.once("error", () => finish(false));
    });
  },
};

/** Read every well-formed pid file in `runDir` (malformed files are skipped and reported by name). */
export function readRecords(runDir: string): { records: { file: string; record: PidRecord }[]; malformed: string[] } {
  const records: { file: string; record: PidRecord }[] = [];
  const malformed: string[] = [];
  if (!existsSync(runDir)) return { records, malformed };
  for (const name of readdirSync(runDir).sort()) {
    if (!name.endsWith(".pid")) continue;
    const file = join(runDir, name);
    const record = parsePidRecord(readFileSync(file, "utf8"));
    if (record) records.push({ file, record });
    else malformed.push(name);
  }
  return { records, malformed };
}

/** What to start. */
export interface StartSpec {
  readonly role: StackRole;
  readonly port: number;
  readonly stackPort: number;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runDir: string;
  readonly dbPath?: string;
}

/** Outcome of {@link startProcess}. */
export type StartResult =
  | { readonly ok: true; readonly record: PidRecord; readonly logFile: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Start one detached child and write its pid file. Refuses when a live pid file for this role and
 * port exists, or when the port already answers (that listener is not ours: never adopted). A
 * stale file (dead or reused pid) is replaced.
 */
export async function startProcess(spec: StartSpec, probes: Probes = realProbes): Promise<StartResult> {
  mkdirSync(spec.runDir, { recursive: true });
  const file = join(spec.runDir, pidFileName(spec.role, spec.port));
  if (existsSync(file)) {
    const existing = parsePidRecord(readFileSync(file, "utf8"));
    if (existing && classify(existing, probes) === "alive") {
      return { ok: false, reason: `${spec.role} on :${spec.port} already running (pid ${existing.pid}); stop it first` };
    }
    rmSync(file, { force: true }); // stale
  }
  if (await probes.isListening(spec.port)) {
    return { ok: false, reason: `port ${spec.port} is already in use by a process this tool did not start; not touching it` };
  }
  const [cmd, ...args] = spec.argv;
  if (cmd === undefined) return { ok: false, reason: "empty argv" };
  const logFile = join(spec.runDir, `${spec.role}-${spec.port}.log`);
  const out = openSync(logFile, "a");
  const child = spawn(cmd, args, {
    cwd: spec.cwd,
    env: { ...spec.env } as NodeJS.ProcessEnv,
    detached: true,
    stdio: ["ignore", out, out],
  });
  closeSync(out);
  child.once("error", () => {
    /* surfaced as a missing pid or a failed readiness wait */
  });
  child.unref();
  if (child.pid === undefined) return { ok: false, reason: `could not spawn ${cmd}` };
  const record: PidRecord = {
    pid: child.pid,
    port: spec.port,
    role: spec.role,
    stackPort: spec.stackPort,
    startedAt: new Date().toISOString(),
    cwd: spec.cwd,
    ...(spec.dbPath !== undefined ? { dbPath: spec.dbPath } : {}),
    argv: spec.argv,
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { ok: true, record, logFile };
}

/** Poll until `port` answers, the pid dies, or `timeoutMs` passes. */
export async function waitForPort(
  record: PidRecord,
  timeoutMs: number,
  probes: Probes = realProbes,
): Promise<"ready" | "died" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probes.isListening(record.port)) return "ready";
    if (!probes.isAlive(record.pid)) return "died";
    await sleep(200);
  }
  return "timeout";
}

const groupAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal); // not a group leader: signal just the verified pid
    } catch {
      /* already gone */
    }
  }
};

/** SIGTERM the group, wait up to `graceMs`, SIGKILL leftovers. True when nothing is left. */
export async function terminateGroup(pid: number, graceMs: number, probes: Probes = realProbes): Promise<boolean> {
  const gone = (): boolean => !probes.isAlive(pid) && !groupAlive(pid);
  signalGroup(pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && !gone()) await sleep(50);
  if (!gone()) {
    signalGroup(pid, "SIGKILL");
    const killDeadline = Date.now() + 2000;
    while (Date.now() < killDeadline && !gone()) await sleep(50);
  }
  return gone();
}

/** One line of the stop report. */
export interface StopOutcome {
  readonly file: string;
  readonly record: PidRecord;
  readonly result: "stopped" | "stale-removed" | "not-ours-removed" | "failed";
}

/**
 * Stop the children named by pid files in `runDir` (only those matching `port` as their own or
 * their stack's server port when given). A pid that is dead or no longer ours only has its file
 * removed. Nothing without a pid file is ever signalled.
 */
export async function stopRecords(
  runDir: string,
  opts: { readonly port?: number; readonly graceMs?: number } = {},
  probes: Probes = realProbes,
): Promise<StopOutcome[]> {
  const { records } = readRecords(runDir);
  const picked = records.filter(({ record }) => opts.port === undefined || record.port === opts.port || record.stackPort === opts.port);
  const outcomes: StopOutcome[] = [];
  for (const { file, record } of picked) {
    const state = classify(record, probes);
    if (state === "dead") {
      rmSync(file, { force: true });
      outcomes.push({ file, record, result: "stale-removed" });
    } else if (state === "reused") {
      rmSync(file, { force: true });
      outcomes.push({ file, record, result: "not-ours-removed" });
    } else {
      const ok = await terminateGroup(record.pid, opts.graceMs ?? 5000, probes);
      if (ok) rmSync(file, { force: true });
      outcomes.push({ file, record, result: ok ? "stopped" : "failed" });
    }
  }
  return outcomes;
}

/** One row of the status table. */
export interface StatusRow {
  readonly role: StackRole;
  readonly pid: number;
  readonly state: PidState;
  readonly port: number;
  readonly listening: boolean;
  readonly startedAt: string;
}

/** Report each recorded child: pid, alive/dead/reused, port and whether it answers. */
export async function statusRows(runDir: string, probes: Probes = realProbes): Promise<StatusRow[]> {
  const rows: StatusRow[] = [];
  for (const { record } of readRecords(runDir).records) {
    rows.push({
      role: record.role,
      pid: record.pid,
      state: classify(record, probes),
      port: record.port,
      listening: await probes.isListening(record.port),
      startedAt: record.startedAt,
    });
  }
  return rows;
}
