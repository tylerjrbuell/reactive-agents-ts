import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classify,
  cmdlineMatches,
  parsePidRecord,
  pidFileName,
  readRecords,
  realProbes,
  resolveRunDir,
  startProcess,
  statusRows,
  stopRecords,
  type PidRecord,
} from "../dev-stack-lifecycle.js";
import { parseFlags } from "../dev-stack-cli.js";

const dirs: string[] = [];
const servers: Server[] = [];
const strays: number[] = [];
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "dev-stack-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const s of servers) s.close();
  for (const pid of strays) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* gone */
      }
    }
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const record = (over: Partial<PidRecord> = {}): PidRecord => ({
  pid: 4242,
  port: 4399,
  role: "server",
  stackPort: 4399,
  startedAt: "2026-11-17T00:00:00.000Z",
  cwd: "/x",
  argv: ["bun", "run", "/repo/server/index.ts"],
  ...over,
});

/** Listen on an ephemeral loopback port; returns the port. */
const listen = (): Promise<number> =>
  new Promise((done) => {
    const s = createServer();
    servers.push(s);
    s.listen(0, "127.0.0.1", () => done((s.address() as { port: number }).port));
  });

/** A free port: listen, read, close. */
const freePort = async (): Promise<number> => {
  const s = createServer();
  const port = await new Promise<number>((done) => s.listen(0, "127.0.0.1", () => done((s.address() as { port: number }).port)));
  await new Promise<void>((done) => s.close(() => done()));
  return port;
};

/** Dummy "stack child": spawns a grandchild sleeper in its group and lingers. */
const dummyScript = (dir: string): string => {
  const file = join(dir, "dummy-child.js");
  writeFileSync(
    file,
    `const { spawn } = require("node:child_process");
const g = spawn("sleep", ["300"], { stdio: "ignore" });
require("node:fs").writeFileSync(process.argv[2], String(g.pid));
setInterval(() => {}, 1000);
`,
  );
  return file;
};

const alive = (pid: number): boolean => realProbes.isAlive(pid);
const until = async (fn: () => boolean, ms = 5000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
};

describe("pid record rules", () => {
  test("round trips a valid record and rejects malformed ones", () => {
    const r = record({ dbPath: "/x/.cortex/cortex.db" });
    expect(parsePidRecord(JSON.stringify(r))).toEqual(r);
    expect(parsePidRecord("not json")).toBeUndefined();
    expect(parsePidRecord(JSON.stringify({ ...r, pid: 1 }))).toBeUndefined();
    expect(parsePidRecord(JSON.stringify({ ...r, port: 70000 }))).toBeUndefined();
    expect(parsePidRecord(JSON.stringify({ ...r, role: "db" }))).toBeUndefined();
    expect(parsePidRecord(JSON.stringify({ ...r, argv: [] }))).toBeUndefined();
  });

  test("file names and run dir", () => {
    expect(pidFileName("server", 4399)).toBe("server-4399.pid");
    expect(resolveRunDir({}, "/repo")).toBe("/repo/.cortex-run");
    expect(resolveRunDir({ CORTEX_RUN_DIR: "/tmp/r" }, "/repo")).toBe("/tmp/r");
  });

  test("cmdline match ignores the executable but needs every other token", () => {
    const r = record();
    expect(cmdlineMatches(r, ["/usr/bin/bun", "run", "/repo/server/index.ts"])).toBe(true);
    expect(cmdlineMatches(r, ["vim", "notes.txt"])).toBe(false);
    expect(cmdlineMatches(r, [])).toBe(false);
  });

  test("classify: dead, reused (live pid, foreign command line) and alive", () => {
    const r = record();
    expect(classify(r, { isAlive: () => false, readCmdline: () => undefined })).toBe("dead");
    expect(classify(r, { isAlive: () => true, readCmdline: () => ["vim"] })).toBe("reused");
    expect(classify(r, { isAlive: () => true, readCmdline: () => undefined })).toBe("reused");
    expect(classify(r, { isAlive: () => true, readCmdline: () => ["bun", "run", "/repo/server/index.ts"] })).toBe("alive");
  });

  test("flag parsing", () => {
    expect(parseFlags(["--port", "4399", "--no-ui"])?.values.get("port")).toBe("4399");
    expect(parseFlags(["--bogus"])).toBeUndefined();
    expect(parseFlags(["--port"])).toBeUndefined();
  });
});

describe("lifecycle with a dummy child", () => {
  test("start writes a pid file; status sees it; stop kills the whole group and removes the file", async () => {
    const dir = scratch();
    const runDir = join(dir, "run");
    const gpidFile = join(dir, "grandchild.pid");
    const port = await freePort();
    const res = await startProcess({
      role: "server",
      port,
      stackPort: port,
      argv: [process.execPath, dummyScript(dir), gpidFile],
      cwd: dir,
      env: process.env,
      runDir,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    strays.push(res.record.pid);
    expect(existsSync(join(runDir, `server-${port}.pid`))).toBe(true);
    expect(parsePidRecord(readFileSync(join(runDir, `server-${port}.pid`), "utf8"))?.pid).toBe(res.record.pid);
    expect(await until(() => existsSync(gpidFile))).toBe(true);
    const gpid = Number(readFileSync(gpidFile, "utf8"));
    strays.push(gpid);

    const rows = await statusRows(runDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "server", pid: res.record.pid, state: "alive", port, listening: false });

    // A second start for the same port is refused while the first is alive.
    const again = await startProcess({ role: "server", port, stackPort: port, argv: res.record.argv, cwd: dir, env: process.env, runDir });
    expect(again.ok).toBe(false);

    const out = await stopRecords(runDir, { port, graceMs: 2000 });
    expect(out.map((o) => o.result)).toEqual(["stopped"]);
    expect(await until(() => !alive(res.record.pid) && !alive(gpid))).toBe(true);
    expect(existsSync(join(runDir, `server-${port}.pid`))).toBe(false);
  });

  test("start refuses a port a foreign listener holds, and leaves that listener alone", async () => {
    const dir = scratch();
    const runDir = join(dir, "run");
    const foreign = await listen();
    const res = await startProcess({
      role: "server",
      port: foreign,
      stackPort: foreign,
      argv: [process.execPath, dummyScript(dir), join(dir, "g.pid")],
      cwd: dir,
      env: process.env,
      runDir,
    });
    expect(res.ok).toBe(false);
    expect(readRecords(runDir).records).toHaveLength(0);
    expect(await realProbes.isListening(foreign)).toBe(true);
  });

  test("stop never signals a foreign process: no pid file, filtered port, or reused pid", async () => {
    const dir = scratch();
    const runDir = join(dir, "run");
    const foreign = spawn("sleep", ["300"], { stdio: "ignore", detached: true });
    foreign.unref();
    const fpid = foreign.pid as number;
    strays.push(fpid);

    // 1. No pid file at all: stop has nothing to do.
    expect(await stopRecords(runDir, {})).toEqual([]);
    expect(alive(fpid)).toBe(true);

    // 2. A pid file for another port is not touched by a filtered stop.
    const other = record({ pid: fpid, port: 4501, stackPort: 4501, argv: ["sleep", "300"] });
    await import("node:fs").then((fs) => {
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(join(runDir, pidFileName("server", 4501)), JSON.stringify(other));
    });
    expect(await stopRecords(runDir, { port: 4999 })).toEqual([]);
    expect(alive(fpid)).toBe(true);

    // 3. A pid file whose pid was recycled by a foreign process (command line differs): file is
    //    dropped, the process is not signalled.
    const reused = record({ pid: fpid, port: 4502, stackPort: 4502, argv: ["bun", "run", "/repo/server/index.ts"] });
    const file = join(runDir, pidFileName("server", 4502));
    writeFileSync(file, JSON.stringify(reused));
    const out = await stopRecords(runDir, { port: 4502, graceMs: 300 });
    expect(out.map((o) => o.result)).toEqual(["not-ours-removed"]);
    expect(existsSync(file)).toBe(false);
    expect(alive(fpid)).toBe(true);
  });

  test("a dead pid's stale file is removed by stop and replaced by start", async () => {
    const dir = scratch();
    const runDir = join(dir, "run");
    const port = await freePort();
    const gone = spawn("true", [], { stdio: "ignore" });
    await new Promise((r) => gone.once("exit", r));
    const stale = record({ pid: gone.pid as number, port, stackPort: port, argv: ["true"] });
    await import("node:fs").then((fs) => {
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(join(runDir, pidFileName("server", port)), JSON.stringify(stale));
    });
    expect((await stopRecords(runDir, { port })).map((o) => o.result)).toEqual(["stale-removed"]);

    await import("node:fs").then((fs) => fs.writeFileSync(join(runDir, pidFileName("server", port)), JSON.stringify(stale)));
    const res = await startProcess({
      role: "server",
      port,
      stackPort: port,
      argv: [process.execPath, dummyScript(dir), join(dir, "g.pid")],
      cwd: dir,
      env: process.env,
      runDir,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      strays.push(res.record.pid);
      expect((await stopRecords(runDir, { port, graceMs: 2000 })).map((o) => o.result)).toEqual(["stopped"]);
    }
  });
});
