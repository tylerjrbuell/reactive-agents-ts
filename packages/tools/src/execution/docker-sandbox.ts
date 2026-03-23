// File: src/execution/docker-sandbox.ts
/**
 * Docker Sandbox — runs code in an isolated Docker container.
 * Provides stronger isolation than Bun.spawn for untrusted code execution.
 *
 * Requires Docker daemon access. Falls back to process sandbox if unavailable.
 */
import { Effect } from "effect";
import { getPlatformSync } from "@reactive-agents/platform";
import { ToolExecutionError, ToolTimeoutError } from "../errors.js";

// ─── Configuration ───

export interface DockerSandboxConfig {
  /** Base Docker image for execution. */
  readonly image: string;
  /** Memory limit in MB. */
  readonly memoryMb: number;
  /** CPU quota (1.0 = 1 full core). */
  readonly cpuQuota: number;
  /** Execution timeout in ms. */
  readonly timeoutMs: number;
  /** Whether to remove container after execution. */
  readonly autoRemove: boolean;
  /** Network mode: "none" for full isolation, "host" for network access. */
  readonly network: "none" | "host" | "bridge";
  /** Read-only filesystem (prevents writes outside /tmp). */
  readonly readOnlyFs: boolean;
}

export const DEFAULT_DOCKER_CONFIG: DockerSandboxConfig = {
  image: "oven/bun:1-alpine",
  memoryMb: 256,
  cpuQuota: 0.5,
  timeoutMs: 30_000,
  autoRemove: true,
  network: "none",
  readOnlyFs: true,
};

// ─── Prebuilt image names ───

export const RUNNER_IMAGES = {
  bun: "oven/bun:1-alpine",
  node: "node:22-alpine",
  python: "python:3.12-alpine",
} as const;

export type RunnerLanguage = keyof typeof RUNNER_IMAGES;

// ─── Docker Availability Check ───

const isDockerAvailable = async (): Promise<boolean> => {
  try {
    const result = await getPlatformSync().process.exec(["docker", "info"], { timeoutMs: 10_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

// ─── Docker Sandbox ───

export interface DockerSandbox {
  /** Execute code in a Docker container. */
  readonly execute: (
    code: string,
    language: RunnerLanguage,
    config?: Partial<DockerSandboxConfig>,
  ) => Effect.Effect<DockerExecResult, ToolExecutionError | ToolTimeoutError>;
  /** Check if Docker is available. */
  readonly available: () => Effect.Effect<boolean, never>;
}

export interface DockerExecResult {
  readonly output: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly containerId?: string;
}

/**
 * Create a Docker sandbox for isolated code execution.
 */
export const makeDockerSandbox = (
  baseConfig: Partial<DockerSandboxConfig> = {},
): DockerSandbox => {
  const defaults = { ...DEFAULT_DOCKER_CONFIG, ...baseConfig };

  const buildRunCommand = (
    code: string,
    language: RunnerLanguage,
  ): string[] => {
    switch (language) {
      case "bun":
        return ["bun", "--eval", code];
      case "node":
        return ["node", "--eval", code];
      case "python":
        return ["python3", "-c", code];
    }
  };

  return {
    execute: (code, language, configOverrides) =>
      Effect.gen(function* () {
        const config = { ...defaults, ...configOverrides };
        const image = RUNNER_IMAGES[language] ?? config.image;
        const start = performance.now();

        const dockerAvail = yield* Effect.tryPromise({
          try: () => isDockerAvailable(),
          catch: () =>
            new ToolExecutionError({
              message: "Failed to check Docker availability",
              toolName: "docker-execute",
              cause: undefined,
            }),
        });

        if (!dockerAvail) {
          return yield* Effect.fail(
            new ToolExecutionError({
              message:
                "Docker is not available. Install Docker or use the process-based code-execute tool instead.",
              toolName: "docker-execute",
              cause: undefined,
            }),
          );
        }

        const runCmd = buildRunCommand(code, language);

        // Build docker run command with security constraints
        const dockerArgs = [
          "docker",
          "run",
          ...(config.autoRemove ? ["--rm"] : []),
          "--memory",
          `${config.memoryMb}m`,
          "--cpus",
          String(config.cpuQuota),
          "--network",
          config.network,
          "--pids-limit",
          "50",
          "--security-opt",
          "no-new-privileges",
          ...(config.readOnlyFs ? ["--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m"] : []),
          "--cap-drop",
          "ALL",
          image,
          ...runCmd,
        ];

        const result = yield* Effect.tryPromise({
          try: async () => {
            const execResult = await getPlatformSync().process.exec(dockerArgs, {
              env: {
                PATH: process.env.PATH ?? "/usr/bin:/bin",
                HOME: "/tmp",
              },
              timeoutMs: config.timeoutMs,
            });

            return {
              output: execResult.stdout.trim(),
              stderr: execResult.stderr.trim(),
              exitCode: execResult.exitCode,
              durationMs: performance.now() - start,
            } satisfies DockerExecResult;
          },
          catch: (e) =>
            new ToolExecutionError({
              message: `Docker execution failed: ${e instanceof Error ? e.message : String(e)}`,
              toolName: "docker-execute",
              cause: e,
            }),
        });

        if (result.durationMs >= config.timeoutMs) {
          return yield* Effect.fail(
            new ToolTimeoutError({
              message: `Docker execution timed out after ${config.timeoutMs}ms`,
              toolName: "docker-execute",
              timeoutMs: config.timeoutMs,
            }),
          );
        }

        return result;
      }),

    available: () =>
      Effect.tryPromise({
        try: () => isDockerAvailable(),
        catch: () => false as never,
      }),
  };
};
