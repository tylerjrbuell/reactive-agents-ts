import { createRequire } from "node:module";
import { isBun } from "./detect.js";
import type { SpawnOptions, SpawnResult } from "./types.js";

const require = createRequire(import.meta.url);

interface BunSpawnApi {
  spawn(cmd: string[], opts?: Record<string, unknown>): {
    pid: number;
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array> | number | null;
    stderr: ReadableStream<Uint8Array> | number | null;
    kill(signal?: string | number): void;
  };
}

function spawnBun(cmd: string[], options: SpawnOptions): SpawnResult {
  const Bun = (globalThis as { Bun?: BunSpawnApi }).Bun;
  if (!Bun) throw new Error("spawnBun called when Bun runtime not present");
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin ?? "ignore",
    stdout: options.stdout ?? "inherit",
    stderr: options.stderr ?? "inherit",
  });
  return {
    pid: proc.pid,
    exited: proc.exited,
    stdout: proc.stdout instanceof ReadableStream ? proc.stdout : null,
    stderr: proc.stderr instanceof ReadableStream ? proc.stderr : null,
    kill: (signal?: string | number) => proc.kill(signal),
  };
}

function spawnNode(cmd: string[], options: SpawnOptions): SpawnResult {
  const { spawn: nodeSpawn } = require("node:child_process") as typeof import("node:child_process");
  const [bin, ...args] = cmd;
  if (!bin) throw new Error("spawn: empty command array");

  const stdioMap = (kind: "stdin" | "stdout" | "stderr"): "pipe" | "ignore" | "inherit" => {
    const v = options[kind];
    if (v === "pipe" || v === "ignore" || v === "inherit") return v;
    return kind === "stdin" ? "ignore" : "inherit";
  };

  const child = nodeSpawn(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [stdioMap("stdin"), stdioMap("stdout"), stdioMap("stderr")],
    timeout: options.timeout,
  });

  const toWebStream = (readable: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> | null => {
    if (!readable) return null;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        readable.on("data", (chunk: Buffer | string) => {
          controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
        });
        readable.on("end", () => controller.close());
        readable.on("error", (err) => controller.error(err));
      },
    });
  };

  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });

  return {
    pid: child.pid ?? 0,
    exited,
    stdout: toWebStream(child.stdout),
    stderr: toWebStream(child.stderr),
    kill: (signal?: string | number) => {
      if (typeof signal === "string") child.kill(signal as NodeJS.Signals);
      else child.kill();
    },
  };
}

export function spawn(cmd: string[], options: SpawnOptions = {}): SpawnResult {
  if (isBun) return spawnBun(cmd, options);
  return spawnNode(cmd, options);
}
