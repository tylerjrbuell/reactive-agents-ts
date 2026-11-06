// File: src/execution/sandbox-lifecycle.ts
/**
 * Sandbox container lifecycle — guarantees no `rax-sandbox-*` container
 * outlives the tool call that created it.
 *
 * Two-phase run (mirrors the MCP client's two-phase container discipline):
 *   1. `docker create` runs to completion (bounded by the call timeout), so the
 *      container provably exists before anything can interrupt the run.
 *   2. `docker start -a` attaches and streams output.
 *   3. `docker rm -f` runs as the release step on success, failure, timeout
 *      AND fiber interruption.
 *
 * The former single-phase `docker run` leaked: a timeout or interrupt that
 * fired while the CLI was still creating the container killed the CLI, but the
 * daemon finished the create — leaving a never-started container in `Created`
 * state, which `--rm` never removes (it only fires on exit).
 *
 * Every container carries labels ({@link SANDBOX_LABEL},
 * {@link SANDBOX_OWNER_LABEL}, {@link SANDBOX_DEADLINE_LABEL}) so
 * {@link reapStaleSandboxes} can remove leftovers from crashed processes while
 * never touching containers it did not create.
 */
import { Effect } from "effect";
import { hostname } from "node:os";
import { spawn } from "@reactive-agents/runtime-shim";
import type { SpawnResult } from "@reactive-agents/runtime-shim";
import { ToolExecutionError, ToolTimeoutError } from "../errors.js";
import type { DockerSandboxConfig } from "./docker-sandbox.js";

// ─── Labels ───

/** Marks a container as a reactive-agents sandbox (value `"1"`). The reaper only ever lists this label. */
export const SANDBOX_LABEL = "rax.sandbox";
/** `<hostname>:<pid>` of the process that created the container (diagnostics). */
export const SANDBOX_OWNER_LABEL = "rax.sandbox.owner";
/** Epoch ms after which the creating call has certainly finished with the container. */
export const SANDBOX_DEADLINE_LABEL = "rax.sandbox.deadline";
/** Slack past a container's deadline before the reaper treats it as abandoned. */
export const DEFAULT_REAP_GRACE_MS = 60_000;

/** Owner id stamped on every sandbox container this process creates. */
export const sandboxOwnerId = (): string => `${hostname()}:${process.pid}`;

// ─── Pure argument builder ───

/** Everything needed to build the `docker create` argv for one sandbox run. */
export interface SandboxCreateSpec {
  readonly name: string;
  readonly image: string;
  readonly cmd: readonly string[];
  readonly config: DockerSandboxConfig;
  /** Absolute seccomp profile path, or null to run without a custom profile. */
  readonly seccompPath: string | null;
  readonly owner: string;
  /** Epoch ms stamped as {@link SANDBOX_DEADLINE_LABEL}. */
  readonly deadlineMs: number;
  readonly mounts?: readonly string[];
  readonly tmpfs?: readonly string[];
  readonly workdir?: string;
}

/**
 * Build the `docker create` argv. Pure — pinned without Docker.
 * `--rm` is unconditional: no config spread can turn container removal off
 * (`DockerSandboxConfig.autoRemove` is deprecated and ignored).
 */
export const buildSandboxCreateArgs = (spec: SandboxCreateSpec): string[] => {
  const { config } = spec;
  return [
    "docker",
    "create",
    "--name", spec.name,
    "--rm",
    "--label", `${SANDBOX_LABEL}=1`,
    "--label", `${SANDBOX_OWNER_LABEL}=${spec.owner}`,
    "--label", `${SANDBOX_DEADLINE_LABEL}=${spec.deadlineMs}`,
    "--memory", `${config.memoryMb}m`,
    "--memory-swap", `${config.memoryMb}m`, // No swap — hard OOM
    "--cpus", String(config.cpuQuota),
    "--network", config.network,
    "--pids-limit", "50",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    ...(spec.seccompPath ? ["--security-opt", `seccomp=${spec.seccompPath}`] : []),
    ...(config.readOnlyFs ? ["--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m"] : []),
    ...(spec.mounts ?? []).flatMap((m) => ["-v", m]),
    ...(spec.tmpfs ?? []).flatMap((t) => ["--tmpfs", t]),
    ...(spec.workdir ? ["-w", spec.workdir] : []),
    // Prevent container from writing to the host filesystem (non-root nobody).
    "--user", "65534:65534",
    spec.image,
    ...spec.cmd,
  ];
};

// ─── Docker CLI helpers ───

const messageOf = (e: unknown): string =>
  e !== null && typeof e === "object" && "message" in e ? String(e.message) : String(e);

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Run a docker CLI command to completion. Never rejects: spawn failures map to
 * exit code -1. When `timeoutMs` elapses the CLI is SIGKILLed and `timedOut` set.
 */
const runCli = async (argv: readonly string[], timeoutMs?: number): Promise<CliResult> => {
  let proc: SpawnResult;
  try {
    proc = spawn([...argv], { stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    return { code: -1, stdout: "", stderr: messageOf(e), timedOut: false };
  }
  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          try { proc.kill("SIGKILL"); } catch { /* already gone */ }
        }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    return { code: code ?? 1, stdout, stderr, timedOut };
  } catch (e) {
    return { code: -1, stdout: "", stderr: messageOf(e), timedOut };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Force-remove a container by name or id. Best effort; never fails. */
export const removeSandboxContainer = (name: string): Effect.Effect<void> =>
  Effect.promise(() => runCli(["docker", "rm", "-f", name])).pipe(Effect.asVoid);

/**
 * Phase 1: create the container. Bounded by `timeoutMs`; on any failure the
 * name is force-removed before failing, so a half-finished create never leaks.
 */
export const createSandboxContainer = (
  argv: readonly string[],
  name: string,
  timeoutMs: number,
): Effect.Effect<void, ToolExecutionError | ToolTimeoutError> =>
  Effect.gen(function* () {
    const r = yield* Effect.promise(() => runCli(argv, timeoutMs));
    if (r.code === 0 && !r.timedOut) return;
    yield* removeSandboxContainer(name);
    if (r.timedOut) {
      return yield* Effect.fail(
        new ToolTimeoutError({
          message: `Docker execution timed out after ${timeoutMs}ms (container create)`,
          toolName: "docker-execute",
          timeoutMs,
        }),
      );
    }
    return yield* Effect.fail(
      new ToolExecutionError({
        message: `Docker container create failed: ${r.stderr.trim() || `exit ${r.code}`}`,
        toolName: "docker-execute",
        cause: undefined,
      }),
    );
  });

/** Raw output of an attached sandbox run. */
export interface SandboxAttachResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}

/**
 * Phase 2: start the created container attached and collect its output.
 * Timeout SIGKILLs the attached CLI and `docker kill`s the container; fiber
 * interruption SIGKILLs the CLI. Container removal is the caller's release step.
 */
export const attachSandboxContainer = (
  name: string,
  timeoutMs: number,
): Effect.Effect<SandboxAttachResult, ToolExecutionError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const proc = spawn(["docker", "start", "-a", name], { stdout: "pipe", stderr: "pipe" });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void runCli(["docker", "kill", name]);
        try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      }, timeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout as ReadableStream).text(),
          new Response(proc.stderr as ReadableStream).text(),
          proc.exited,
        ]);
        return { stdout, stderr, exitCode: exitCode ?? 1, timedOut };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Docker execution failed: ${messageOf(e)}`,
        toolName: "docker-execute",
        cause: e,
      }),
  });

/**
 * Run `effect` as a promise that is interrupted when `signal` aborts. Used by
 * promise-based tool handlers so a cancelled tool call reaches the sandbox
 * effect (and its container-removal release step) instead of orphaning it.
 */
export const runSandboxEffect = <A, E>(
  signal: AbortSignal,
  effect: Effect.Effect<A, E>,
): Promise<A> => Effect.runPromise(effect, { signal });

// ─── Reaper ───

/** One labeled sandbox container as listed by `docker ps -a`. */
export interface SandboxListing {
  readonly id: string;
  /** Docker state: created | running | paused | restarting | removing | exited | dead. */
  readonly state: string;
  /** Parsed {@link SANDBOX_DEADLINE_LABEL}; undefined when absent or malformed. */
  readonly deadlineMs: number | undefined;
}

/** Format passed to `docker ps --format`; parsed by {@link parseSandboxListing}. */
export const SANDBOX_LISTING_FORMAT = `{{.ID}}\t{{.State}}\t{{.Label "${SANDBOX_DEADLINE_LABEL}"}}`;

/** Parse `docker ps --format SANDBOX_LISTING_FORMAT` output. Pure. */
export const parseSandboxListing = (stdout: string): SandboxListing[] =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id = "", state = "", deadline = ""] = line.split("\t");
      const parsed = Number(deadline);
      return {
        id,
        state: state.toLowerCase(),
        deadlineMs: deadline !== "" && Number.isFinite(parsed) ? parsed : undefined,
      };
    })
    .filter((l) => l.id.length > 0);

/**
 * Pick the stale containers. Pure. Exited/dead → stale (their run is over).
 * Anything else (created, running, paused, ...) is stale only once its
 * deadline plus `graceMs` has passed — a live concurrent run is never touched.
 * Without a parseable deadline a non-exited container is left alone.
 */
export const selectStaleSandboxes = (
  listings: readonly SandboxListing[],
  nowMs: number,
  graceMs: number = DEFAULT_REAP_GRACE_MS,
): string[] =>
  listings
    .filter((l) => l.state !== "removing")
    .filter(
      (l) =>
        l.state === "exited" ||
        l.state === "dead" ||
        (l.deadlineMs !== undefined && nowMs > l.deadlineMs + graceMs),
    )
    .map((l) => l.id);

/** Outcome of one reaper pass. */
export interface ReapResult {
  /** Container ids the reaper force-removed. */
  readonly removed: readonly string[];
}

/**
 * Best-effort removal of stale sandbox containers left by crashed or killed
 * processes. Lists ONLY containers carrying `rax.sandbox=1` — never touches
 * any other container. Never fails.
 */
export const reapStaleSandboxes = (
  options: { readonly nowMs?: number; readonly graceMs?: number } = {},
): Effect.Effect<ReapResult> =>
  Effect.gen(function* () {
    const listing = yield* Effect.promise(() =>
      runCli(
        ["docker", "ps", "-a", "--filter", `label=${SANDBOX_LABEL}=1`, "--format", SANDBOX_LISTING_FORMAT],
        15_000,
      ),
    );
    if (listing.code !== 0) return { removed: [] };
    const stale = selectStaleSandboxes(
      parseSandboxListing(listing.stdout),
      options.nowMs ?? Date.now(),
      options.graceMs,
    );
    for (const id of stale) yield* removeSandboxContainer(id);
    return { removed: stale };
  });
