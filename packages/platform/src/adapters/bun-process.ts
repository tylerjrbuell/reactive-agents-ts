import type { ProcessAdapter, ProcessResult, SpawnedProcess } from "../types.js";

type BunIoOption = "pipe" | "inherit" | "ignore";

function mapIo(opt: "pipe" | "inherit" | "ignore" | undefined): BunIoOption {
  return opt ?? "pipe";
}

function wrapSpawnedProcess(proc: ReturnType<typeof Bun.spawn>): SpawnedProcess {
  return {
    get stdin() {
      return proc.stdin as WritableStream | null;
    },
    get stdout() {
      return proc.stdout as ReadableStream | null;
    },
    get stderr() {
      return proc.stderr as ReadableStream | null;
    },
    get pid(): number | undefined {
      return proc.pid;
    },
    get exited(): Promise<number> {
      return proc.exited;
    },
    async writeStdin(data: Uint8Array): Promise<void> {
      if (proc.stdin) {
        // Bun's FileSink write method
        (proc.stdin as { write(data: Uint8Array): void }).write(data);
      }
    },
    async flushStdin(): Promise<void> {
      if (proc.stdin) {
        const sink = proc.stdin as { flush?(): void | Promise<void> };
        if (typeof sink.flush === "function") {
          await sink.flush();
        }
      }
    },
    kill(signal?: number): void {
      proc.kill(signal);
    },
  };
}

async function collectStream(stream: ReadableStream | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

export function createBunProcess(): ProcessAdapter {
  return {
    spawn(
      cmd: string[],
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        stdin?: "pipe" | "inherit" | "ignore";
        stdout?: "pipe" | "inherit" | "ignore";
        stderr?: "pipe" | "inherit" | "ignore";
      },
    ): SpawnedProcess {
      const proc = Bun.spawn(cmd, {
        cwd: options?.cwd,
        env: options?.env,
        stdin: mapIo(options?.stdin),
        stdout: mapIo(options?.stdout),
        stderr: mapIo(options?.stderr),
      });
      return wrapSpawnedProcess(proc);
    },

    async exec(
      cmd: string[],
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        timeoutMs?: number;
      },
    ): Promise<ProcessResult> {
      const proc = Bun.spawn(cmd, {
        cwd: options?.cwd,
        env: options?.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;

      const timeoutPromise =
        options?.timeoutMs != null
          ? new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                timedOut = true;
                proc.kill();
                reject(new Error(`Process timed out after ${options.timeoutMs}ms`));
              }, options.timeoutMs);
            })
          : null;

      const collectPromise = async (): Promise<ProcessResult> => {
        const [stdout, stderr, exitCode] = await Promise.all([
          collectStream(proc.stdout as ReadableStream | null),
          collectStream(proc.stderr as ReadableStream | null),
          proc.exited,
        ]);
        return { stdout, stderr, exitCode };
      };

      try {
        const result = timeoutPromise
          ? await Promise.race([collectPromise(), timeoutPromise])
          : await collectPromise();
        return result;
      } finally {
        if (timeoutId != null) clearTimeout(timeoutId);
      }
    },
  };
}
