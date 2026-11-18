/**
 * `dev-stack.ts start | stop | status`: the detached, pid-file flavour of the dev stack.
 *
 *   start  [--port N] [--ui-port N] [--cwd DIR] [--run-dir DIR] [--no-ui] [--timeout-ms N]
 *   stop   [--port N] [--run-dir DIR]
 *   status [--run-dir DIR]
 *
 * `--port` is the Cortex server port (env `CORTEX_PORT`, default 4321); `--ui-port` the Vite port
 * (env `CORTEX_UI_PORT`, default 5173). `--cwd` is the server's working directory, which decides
 * where its database lives (`<cwd>/.cortex/cortex.db`). The runtime dir (pid files and logs) is
 * `CORTEX_RUN_DIR` or `<invoking cwd>/.cortex-run`. `stop` kills only pids from those files.
 *
 * Exit codes: 0 ok, 1 failed (refused, never became ready, could not stop), 2 usage error.
 */
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  pidFileName,
  readRecords,
  resolveRunDir,
  startProcess,
  statusRows,
  stopRecords,
  terminateGroup,
  waitForPort,
  type PidRecord,
} from "./dev-stack-lifecycle.js";

const cortexRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

interface Flags {
  readonly values: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
}

const VALUE_FLAGS = ["port", "ui-port", "cwd", "run-dir", "timeout-ms"] as const;
const SWITCH_FLAGS = ["no-ui"] as const;

/** Parse `--flag value` and `--switch`; undefined on an unknown flag or a missing value. */
export function parseFlags(args: readonly string[]): Flags | undefined {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!a.startsWith("--")) return undefined;
    const name = a.slice(2);
    if ((SWITCH_FLAGS as readonly string[]).includes(name)) switches.add(name);
    else if ((VALUE_FLAGS as readonly string[]).includes(name)) {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) return undefined;
      values.set(name, v);
    } else return undefined;
  }
  return { values, switches };
}

const toPort = (raw: string | undefined, fallback: number): number | undefined => {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
};

const USAGE = "usage: dev-stack.ts start|stop|status [--port N] [--ui-port N] [--cwd DIR] [--run-dir DIR] [--no-ui] [--timeout-ms N]";

async function start(flags: Flags, env: NodeJS.ProcessEnv): Promise<number> {
  const port = toPort(flags.values.get("port") ?? env.CORTEX_PORT, 4321);
  const uiPort = toPort(flags.values.get("ui-port") ?? env.CORTEX_UI_PORT, 5173);
  const timeoutRaw = Number(flags.values.get("timeout-ms") ?? 60_000);
  const timeoutMs = Number.isInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined;
  if (port === undefined || uiPort === undefined || timeoutMs === undefined) {
    console.error(USAGE);
    return 2;
  }
  const withUi = !flags.switches.has("no-ui");
  if (withUi && port === uiPort) {
    console.error("server and UI ports must differ");
    return 2;
  }
  const cwd = resolve(flags.values.get("cwd") ?? cortexRoot);
  const runDir = resolve(flags.values.get("run-dir") ?? resolveRunDir(env, process.cwd()));
  const childEnv = { ...env, CORTEX_PORT: String(port), CORTEX_NO_OPEN: "1" };

  const started: PidRecord[] = [];
  const abort = async (reason: string): Promise<number> => {
    console.error(`dev-stack start failed: ${reason}`);
    // Only what THIS invocation started; a refusal because something already runs touches nothing.
    for (const r of started) {
      await terminateGroup(r.pid, 5000);
      rmSync(join(runDir, pidFileName(r.role, r.port)), { force: true });
    }
    return 1;
  };

  const server = await startProcess({
    role: "server",
    port,
    stackPort: port,
    argv: [process.execPath, "run", `${cortexRoot}/server/index.ts`],
    cwd,
    env: childEnv,
    runDir,
    dbPath: `${cwd}/.cortex/cortex.db`,
  });
  if (!server.ok) return abort(server.reason);
  started.push(server.record);

  if (withUi) {
    const ui = await startProcess({
      role: "ui",
      port: uiPort,
      stackPort: port,
      argv: [process.execPath, "run", "dev", "--port", String(uiPort), "--strictPort", "--host", "127.0.0.1"],
      cwd: `${cortexRoot}/ui`,
      env: childEnv,
      runDir,
    });
    if (!ui.ok) return abort(ui.reason);
    started.push(ui.record);
  }

  for (const rec of started) {
    const state = await waitForPort(rec, timeoutMs);
    if (state !== "ready") return abort(`${rec.role} on :${rec.port} ${state === "died" ? "exited early" : "did not answer in time"} (see ${runDir}/${rec.role}-${rec.port}.log)`);
  }
  console.log(`Cortex API: http://127.0.0.1:${port}`);
  if (withUi) console.log(`Cortex UI:  http://127.0.0.1:${uiPort}`);
  console.log(`run dir: ${runDir}  (stop with: dev-stack stop --port ${port})`);
  return 0;
}

async function stop(flags: Flags, env: NodeJS.ProcessEnv): Promise<number> {
  const port = flags.values.has("port") ? toPort(flags.values.get("port"), 0) : undefined;
  if (port === undefined && flags.values.has("port")) {
    console.error(USAGE);
    return 2;
  }
  const runDir = resolve(flags.values.get("run-dir") ?? resolveRunDir(env, process.cwd()));
  const outcomes = await stopRecords(runDir, port === undefined ? {} : { port });
  if (outcomes.length === 0) console.log("nothing to stop (no matching pid files)");
  for (const o of outcomes) console.log(`${o.record.role} :${o.record.port} pid ${o.record.pid}: ${o.result}`);
  return outcomes.some((o) => o.result === "failed") ? 1 : 0;
}

async function status(flags: Flags, env: NodeJS.ProcessEnv): Promise<number> {
  const runDir = resolve(flags.values.get("run-dir") ?? resolveRunDir(env, process.cwd()));
  const rows = await statusRows(runDir);
  const { malformed } = readRecords(runDir);
  if (rows.length === 0) console.log("no pid files");
  else console.log("role    pid      state   port   listening");
  for (const r of rows) {
    console.log(`${r.role.padEnd(7)} ${String(r.pid).padEnd(8)} ${r.state.padEnd(7)} ${String(r.port).padEnd(6)} ${r.listening ? "yes" : "no"}`);
  }
  for (const m of malformed) console.log(`ignored malformed pid file: ${m}`);
  return rows.some((r) => r.state !== "alive") ? 1 : 0;
}

/** Run a lifecycle subcommand; resolves to the process exit code. */
export async function runLifecycle(sub: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const flags = parseFlags(args);
  if (!flags) {
    console.error(USAGE);
    return 2;
  }
  if (sub === "start") return start(flags, env);
  if (sub === "stop") return stop(flags, env);
  if (sub === "status") return status(flags, env);
  console.error(USAGE);
  return 2;
}
