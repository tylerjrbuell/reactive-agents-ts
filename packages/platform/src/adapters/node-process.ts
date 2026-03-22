/**
 * Node.js process adapter — wraps child_process behind ProcessAdapter.
 */
import { spawn as cpSpawn } from "node:child_process";
import type { ProcessAdapter, ProcessResult, SpawnedProcess } from "../types.js";

export function createNodeProcess(): ProcessAdapter {
  return {
    spawn(cmd, options): SpawnedProcess {
      const [command, ...args] = cmd;
      const proc = cpSpawn(command!, args, {
        cwd: options?.cwd,
        env: options?.env ? { ...process.env, ...options.env } : undefined,
        stdio: [
          options?.stdin ?? "pipe",
          options?.stdout ?? "pipe",
          options?.stderr ?? "pipe",
        ],
      });

      return {
        get stdin() {
          return proc.stdin;
        },
        get stdout() {
          return proc.stdout;
        },
        get stderr() {
          return proc.stderr;
        },
        get pid() {
          return proc.pid;
        },
        exited: new Promise<number>((resolve) => {
          proc.on("close", (code) => resolve(code ?? 1));
        }),
        async writeStdin(data: Uint8Array): Promise<void> {
          return new Promise<void>((resolve, reject) => {
            if (proc.stdin) {
              proc.stdin.write(data, (err) => (err ? reject(err) : resolve()));
            } else {
              resolve();
            }
          });
        },
        async flushStdin(): Promise<void> {
          // Node writable streams auto-flush; no-op.
        },
        kill(signal?: number): void {
          proc.kill(signal);
        },
      } satisfies SpawnedProcess;
    },

    async exec(cmd, options): Promise<ProcessResult> {
      const [command, ...args] = cmd;
      const proc = cpSpawn(command!, args, {
        cwd: options?.cwd,
        env: options?.env ? { ...process.env, ...options.env } : undefined,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      return new Promise<ProcessResult>((resolve, reject) => {
        proc.on("close", (code) => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code ?? 1 });
        });
        proc.on("error", (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(err);
        });

        if (options?.timeoutMs != null) {
          timeoutId = setTimeout(() => {
            proc.kill();
            reject(new Error(`Process timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs);
        }
      });
    },
  };
}
