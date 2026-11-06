// Pins where shell-execute points HOME and TMPDIR.
//
// A caller-supplied working directory (the run's workspace) is the user's
// project: `~`, dotfiles and tool caches must never land in it, and HOME must
// never be the real home. Only the handler's own throwaway sandbox doubles as
// HOME, as before.
import { describe, test, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { shellExecuteHandler } from "../../src/index.js";
import { runHostShell } from "../../src/skills/shell-host-process.js";

type ShellResult = { executed: boolean; output: string; exitCode?: number; error?: string };

const run = (handler: ReturnType<typeof shellExecuteHandler>, command: string) =>
  Effect.runPromise(handler({ command })) as Promise<ShellResult>;

const PRINT_HOME = `awk 'BEGIN{print ENVIRON["HOME"]; print ENVIRON["TMPDIR"]}'`;

describe("shell-execute HOME/TMPDIR seam", () => {
  const made: string[] = [];
  const workspace = () => {
    const dir = mkdtempSync("/tmp/rax-ws-");
    made.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("workspace cwd: HOME and TMPDIR are a scratch dir outside the workspace", async () => {
    const ws = workspace();
    const r = await run(shellExecuteHandler({ cwd: ws }), PRINT_HOME);
    expect(r.executed).toBe(true);
    const [home, tmp] = r.output.trim().split("\n");
    expect(home).toBeTruthy();
    expect(tmp).toBe(home!);
    expect(home).not.toBe(ws);
    expect(home!.startsWith(ws + "/")).toBe(false);
    expect(home).not.toBe(homedir());
    // The scratch dir is removed once the call ends.
    expect(existsSync(home!)).toBe(false);
  });

  test("workspace cwd: writes to ~ never land in the workspace", async () => {
    const ws = workspace();
    const r = await run(shellExecuteHandler({ cwd: ws }), "git config --global user.name probe");
    expect(r.executed).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(readdirSync(ws)).toEqual([]);
  });

  test("no workspace: HOME stays the handler's own sandbox", async () => {
    const r = await run(shellExecuteHandler(), `pwd && ${PRINT_HOME}`);
    expect(r.executed).toBe(true);
    const [cwd, home, tmp] = r.output.trim().split("\n");
    expect(home).toBe(cwd!);
    expect(tmp).toBe(cwd!);
  });

  test("runHostShell: scratch home is created per call and removed after", async () => {
    const ws = workspace();
    const r = await Effect.runPromise(
      Effect.promise(() =>
        runHostShell({
          command: PRINT_HOME,
          cwd: ws,
          path: "/usr/local/bin:/usr/bin:/bin",
          timeoutMs: 10_000,
          homeInCwd: false,
        }),
      ),
    );
    expect(r.exitCode).toBe(0);
    const home = r.stdout.trim().split("\n")[0]!;
    expect(home.startsWith(ws)).toBe(false);
    expect(existsSync(home)).toBe(false);
    const inCwd = await Effect.runPromise(
      Effect.promise(() =>
        runHostShell({
          command: PRINT_HOME,
          cwd: ws,
          path: "/usr/local/bin:/usr/bin:/bin",
          timeoutMs: 10_000,
          homeInCwd: true,
        }),
      ),
    );
    expect(inCwd.stdout.trim().split("\n")).toEqual([ws, ws]);
  });
});
