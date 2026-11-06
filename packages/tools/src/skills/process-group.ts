/**
 * Spawn one host process in its own process group and kill the whole group on
 * timeout. Shared by `shell-execute` (host mode) and `code-execute` (host
 * mode): killing only the direct child left grandchildren alive, and one that
 * held stdout kept the read open past the kill.
 */
import { spawn } from "node:child_process";
import { constants } from "node:os";
import type { Readable } from "node:stream";

const signals: Readonly<Record<string, number>> = constants.signals;

/** One process to run. */
export interface ProcessGroupRequest {
  /** Executable followed by its arguments (no shell unless argv[0] is one). */
  readonly argv: readonly [string, ...string[]];
  /** Working directory of the process. */
  readonly cwd: string;
  /** Full environment of the process (nothing is inherited). */
  readonly env: Readonly<Record<string, string>>;
  /** Kill the process group after this many milliseconds. */
  readonly timeoutMs: number;
}

/** Raw process outcome. Output gathered before a kill is kept. */
export interface ProcessGroupResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** `true` when the timeout fired and the process group was killed. */
  readonly timedOut: boolean;
}

/** Collect a child stream to a UTF-8 string. */
function collect(stream: Readable | null): Promise<string> {
  if (!stream) return Promise.resolve("");
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/**
 * Run `argv` and collect its output. On POSIX the child leads its own process
 * group (`detached`) and the timeout sends SIGKILL to the whole group; on
 * Windows only the child is killed.
 */
export async function runProcessGroup(req: ProcessGroupRequest): Promise<ProcessGroupResult> {
  const groupKill = process.platform !== "win32";
  const [cmd, ...args] = req.argv;
  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: req.cwd,
    env: { ...req.env },
    detached: groupKill,
  });

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      if (groupKill && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      // Process group may already have exited
    }
  }, req.timeoutMs);

  const exited = new Promise<number>((resolve) => {
    child.on("error", () => resolve(127));
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 + (signals[signal] ?? 0) : 1)));
  });
  const [stdout, stderr, exitCode] = await Promise.all([collect(child.stdout), collect(child.stderr), exited]);
  clearTimeout(timeoutId);
  return { stdout, stderr, exitCode, timedOut };
}
