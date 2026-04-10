// File: src/execution/docker-sandbox.ts
/**
 * Docker Sandbox — runs code in a hardened, isolated Docker container.
 *
 * Security model (12 layers):
 *   1.  Custom minimal images (`rax-sandbox:*`) — no shell, no package manager
 *   2.  Non-root execution (uid 65534, sandbox user)
 *   3.  --cap-drop ALL — zero Linux capabilities
 *   4.  --security-opt no-new-privileges — no privilege escalation
 *   5.  --network none — no network access (defense-in-depth)
 *   6.  --read-only — immutable root filesystem
 *   7.  --tmpfs /tmp (noexec, nosuid, 64 MB) — only writable mount
 *   8.  --pids-limit 50 — fork bomb prevention
 *   9.  --memory / --cpus — resource quotas
 *  10.  Seccomp profile — syscall allowlist (blocks mount, ptrace, bpf, etc.)
 *  11.  Named container with `docker kill` timeout — proper OOM/runaway cleanup
 *  12.  Output truncation — prevent context flooding from malicious output
 *
 * Falls back to upstream Alpine images when custom images are not built.
 */
import { Effect } from "effect";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ToolExecutionError, ToolTimeoutError } from "../errors.js";

// ─── Configuration ───

export interface DockerSandboxConfig {
  /** Base Docker image for execution (overridden by SANDBOX_IMAGES when available). */
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
  /** Maximum output characters (stdout + stderr). Prevents context flooding. */
  readonly maxOutputChars: number;
  /** Whether to use the custom seccomp profile for syscall filtering. */
  readonly useSeccomp: boolean;
  /**
   * Whether to prefer the hardened `rax-sandbox:*` images over upstream Alpine images.
   * When true (default), falls back to upstream if custom images are not built.
   */
  readonly preferHardenedImage: boolean;
}

export const DEFAULT_DOCKER_CONFIG: DockerSandboxConfig = {
  image: "oven/bun:1-alpine",
  memoryMb: 256,
  cpuQuota: 0.5,
  timeoutMs: 30_000,
  autoRemove: true,
  network: "none",
  readOnlyFs: true,
  maxOutputChars: 4000,
  useSeccomp: true,
  preferHardenedImage: true,
};

// ─── Prebuilt image names ───

/** Upstream (fallback) Alpine images — used when custom images are not available. */
export const RUNNER_IMAGES = {
  bun: "oven/bun:1-alpine",
  node: "node:22-alpine3.22",
  python: "python:3.12-alpine3.22",
} as const;

/** Hardened custom images — no shell, no package manager, non-root, minimal surface. */
export const SANDBOX_IMAGES = {
  bun: "rax-sandbox:bun",
  node: "rax-sandbox:node",
  python: "rax-sandbox:python",
} as const;

export type RunnerLanguage = keyof typeof RUNNER_IMAGES;

// ─── Seccomp profile path ───

/** Absolute path to the seccomp profile (co-located with Dockerfiles). */
export const SECCOMP_PROFILE_PATH = join(
  dirname(new URL(import.meta.url).pathname),
  "sandbox-image",
  "seccomp-sandbox.json",
);

// ─── Docker Availability & Image Checks ───

/** Check if Docker daemon is reachable. */
const isDockerAvailable = async (): Promise<boolean> => {
  try {
    const proc = Bun.spawn(["docker", "info"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
};

/** Check if a specific Docker image exists locally. */
const isImageAvailable = async (image: string): Promise<boolean> => {
  try {
    const proc = Bun.spawn(["docker", "image", "inspect", image], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
};

/**
 * Build a hardened sandbox image from the co-located Dockerfiles.
 * Returns true if the build succeeded.
 */
export const buildSandboxImage = async (
  language: RunnerLanguage,
): Promise<boolean> => {
  const dockerfileDir = join(
    dirname(new URL(import.meta.url).pathname),
    "sandbox-image",
  );
  const dockerfilePath = join(dockerfileDir, `Dockerfile.${language}`);

  if (!existsSync(dockerfilePath)) return false;

  try {
    const proc = Bun.spawn(
      ["docker", "build", "-t", SANDBOX_IMAGES[language], "-f", dockerfilePath, dockerfileDir],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    return proc.exitCode === 0;
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
  /** Build hardened sandbox images for all languages. Returns per-language results. */
  readonly buildImages: () => Effect.Effect<
    Record<RunnerLanguage, boolean>,
    ToolExecutionError
  >;
  /** Check which sandbox images are available locally. */
  readonly imageStatus: () => Effect.Effect<
    Record<RunnerLanguage, { hardened: boolean; fallback: boolean }>,
    never
  >;
}

export interface DockerExecResult {
  readonly output: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly containerId?: string;
  /** Whether stdout was truncated due to maxOutputChars. */
  readonly truncated: boolean;
  /** The Docker image that was actually used for execution. */
  readonly image: string;
}

/**
 * Resolve the best available image for a language.
 * Prefers hardened rax-sandbox:* images, falls back to upstream Alpine.
 */
const resolveImage = async (
  language: RunnerLanguage,
  preferHardened: boolean,
  configImage: string,
): Promise<string> => {
  if (preferHardened) {
    const hardened = SANDBOX_IMAGES[language];
    if (await isImageAvailable(hardened)) return hardened;
  }
  // Fall back to upstream
  return RUNNER_IMAGES[language] ?? configImage;
};

/**
 * Create a Docker sandbox for isolated code execution.
 *
 * The sandbox automatically uses hardened `rax-sandbox:*` images when
 * available, falling back to upstream Alpine images. Build the hardened
 * images once with `sandbox.buildImages()` or the CLI build script.
 */
export const makeDockerSandbox = (
  baseConfig: Partial<DockerSandboxConfig> = {},
): DockerSandbox => {
  const defaults = { ...DEFAULT_DOCKER_CONFIG, ...baseConfig };

  /** Build the runtime command for the container entrypoint. */
  const buildRunCommand = (
    code: string,
    language: RunnerLanguage,
    image: string,
  ): string[] => {
    // Hardened images have the binary as ENTRYPOINT, so we only pass args.
    // Upstream images need the full binary path.
    const isHardened = Object.values(SANDBOX_IMAGES).includes(image as typeof SANDBOX_IMAGES[RunnerLanguage]);
    switch (language) {
      case "bun":
        return isHardened ? ["--eval", code] : ["bun", "--eval", code];
      case "node":
        return isHardened ? ["--eval", code] : ["node", "--eval", code];
      case "python":
        return isHardened ? ["-c", code] : ["python3", "-c", code];
    }
  };

  /**
   * Kill and remove a container by name. Fire-and-forget.
   * Uses `docker kill` (SIGKILL) then `docker rm -f` for cleanup.
   */
  const killContainer = async (name: string): Promise<void> => {
    try {
      const kill = Bun.spawn(["docker", "kill", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await kill.exited;
    } catch { /* best effort */ }
    try {
      const rm = Bun.spawn(["docker", "rm", "-f", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await rm.exited;
    } catch { /* best effort */ }
  };

  return {
    execute: (code, language, configOverrides) =>
      Effect.gen(function* () {
        const config = { ...defaults, ...configOverrides };
        const start = performance.now();

        // ── 1. Docker availability ──
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

        // ── 2. Resolve image (hardened or fallback) ──
        const image = yield* Effect.tryPromise({
          try: () => resolveImage(language, config.preferHardenedImage, config.image),
          catch: () =>
            new ToolExecutionError({
              message: "Failed to resolve Docker image",
              toolName: "docker-execute",
              cause: undefined,
            }),
        });

        const runCmd = buildRunCommand(code, language, image);

        // ── 3. Generate unique container name for lifecycle management ──
        const containerName = `rax-sandbox-${randomUUID().slice(0, 12)}`;

        // ── 4. Build docker run command with full security hardening ──
        const seccompPath = config.useSeccomp && existsSync(SECCOMP_PROFILE_PATH)
          ? SECCOMP_PROFILE_PATH
          : null;

        const dockerArgs = [
          "docker",
          "run",
          "--name", containerName,
          ...(config.autoRemove ? ["--rm"] : []),
          "--memory", `${config.memoryMb}m`,
          "--memory-swap", `${config.memoryMb}m`, // No swap — hard OOM
          "--cpus", String(config.cpuQuota),
          "--network", config.network,
          "--pids-limit", "50",
          "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges",
          ...(seccompPath
            ? ["--security-opt", `seccomp=${seccompPath}`]
            : []),
          ...(config.readOnlyFs
            ? ["--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m"]
            : []),
          // Prevent container from writing to host filesystem
          "--user", "65534:65534",
          image,
          ...runCmd,
        ];

        // ── 5. Execute with proper timeout via docker kill ──
        const result = yield* Effect.tryPromise({
          try: async () => {
            // Pass through host env for Docker CLI (socket, context, config).
            // Container env is isolated by Docker — this only affects the `docker` command itself.
            const proc = Bun.spawn(dockerArgs, {
              stdout: "pipe",
              stderr: "pipe",
            });

            let timedOut = false;
            const timeoutId = setTimeout(async () => {
              timedOut = true;
              // Kill the container by name — more reliable than killing the docker CLI process
              await killContainer(containerName);
              try { proc.kill(); } catch { /* noop */ }
            }, config.timeoutMs);

            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();
            const exitCode = await proc.exited;

            clearTimeout(timeoutId);

            // ── 6. Truncate output ──
            const maxChars = config.maxOutputChars;
            let outputTrimmed = stdout.trim();
            let truncated = false;
            if (outputTrimmed.length > maxChars) {
              outputTrimmed = outputTrimmed.slice(0, maxChars);
              truncated = true;
            }

            let stderrTrimmed = stderr.trim();
            if (stderrTrimmed.length > maxChars) {
              stderrTrimmed = stderrTrimmed.slice(0, maxChars);
            }

            return {
              output: outputTrimmed,
              stderr: stderrTrimmed,
              exitCode: exitCode ?? 1,
              durationMs: performance.now() - start,
              containerId: containerName,
              truncated,
              image,
              timedOut,
            };
          },
          catch: (e) =>
            new ToolExecutionError({
              message: `Docker execution failed: ${e instanceof Error ? e.message : String(e)}`,
              toolName: "docker-execute",
              cause: e,
            }),
        });

        if (result.timedOut || result.durationMs >= config.timeoutMs) {
          return yield* Effect.fail(
            new ToolTimeoutError({
              message: `Docker execution timed out after ${config.timeoutMs}ms`,
              toolName: "docker-execute",
              timeoutMs: config.timeoutMs,
            }),
          );
        }

        return {
          output: result.output,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          containerId: result.containerId,
          truncated: result.truncated,
          image: result.image,
        };
      }),

    available: () =>
      Effect.tryPromise({
        try: () => isDockerAvailable(),
        catch: () => false as never,
      }),

    buildImages: () =>
      Effect.tryPromise({
        try: async () => {
          const languages: RunnerLanguage[] = ["bun", "node", "python"];
          const results = {} as Record<RunnerLanguage, boolean>;
          for (const lang of languages) {
            results[lang] = await buildSandboxImage(lang);
          }
          return results;
        },
        catch: (e) =>
          new ToolExecutionError({
            message: `Failed to build sandbox images: ${e instanceof Error ? e.message : String(e)}`,
            toolName: "docker-execute",
            cause: e,
          }),
      }),

    imageStatus: () =>
      Effect.tryPromise({
        try: async () => {
          const languages: RunnerLanguage[] = ["bun", "node", "python"];
          const results = {} as Record<RunnerLanguage, { hardened: boolean; fallback: boolean }>;
          for (const lang of languages) {
            results[lang] = {
              hardened: await isImageAvailable(SANDBOX_IMAGES[lang]),
              fallback: await isImageAvailable(RUNNER_IMAGES[lang]),
            };
          }
          return results;
        },
        catch: () => ({
          bun: { hardened: false, fallback: false },
          node: { hardened: false, fallback: false },
          python: { hardened: false, fallback: false },
        }) as never,
      }),
  };
};
