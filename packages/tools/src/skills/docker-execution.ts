// File: src/skills/docker-execution.ts
/**
 * Docker code execution tool — runs code in an isolated Docker container.
 * Safer than process-based execution for untrusted code.
 */
import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import { DEFAULT_DOCKER_CONFIG, makeDockerSandbox } from "../execution/docker-sandbox.js";
import { HANDLER_TIMEOUT_GRACE_MS } from "./timeout-grace.js";
import type { RunnerLanguage, DockerSandboxConfig } from "../execution/docker-sandbox.js";

/** Network sentence for the resolved sandbox network mode. */
const networkText = (network: DockerSandboxConfig["network"]): string =>
  network === "none"
    ? "Network is disabled (fetch and package installs fail). "
    : `Network access is enabled (Docker network "${network}"). `;

/**
 * Build the docker-execute definition from the sandbox config the handler
 * uses (same rule as `shellExecuteToolFor`): the description states the
 * resolved network, filesystem and limits, and `timeoutMs` follows the
 * configured kill plus the shared grace. Pass the same `config` given to
 * {@link makeDockerExecuteHandler}.
 */
export const dockerExecuteToolFor = (config?: Partial<DockerSandboxConfig>): ToolDefinition => {
  const resolved: DockerSandboxConfig = { ...DEFAULT_DOCKER_CONFIG, ...config };
  return {
  name: "docker-execute",
  description:
    "Execute code in an isolated Docker container with strict resource limits " +
    `(${resolved.memoryMb} MB memory, killed after ${resolved.timeoutMs / 1000}s). ` +
    "Supports JavaScript (Bun), Node.js, and Python. " +
    networkText(resolved.network) +
    (resolved.readOnlyFs ? "The filesystem is read-only except /tmp. " : "") +
    "Use console.log() (JS) or print() (Python) for output. " +
    "Returns { executed: true, output, exitCode, durationMs } on success.",
  parameters: [
    {
      name: "code",
      type: "string",
      description: "Code to execute inside the Docker container.",
      required: true,
    },
    {
      name: "language",
      type: "string",
      description: "Programming language: 'bun', 'node', or 'python'. Default: 'bun'.",
      required: false,
      default: "bun",
      enum: ["bun", "node", "python"],
    },
  ],
  returnType:
    "{ executed: true, output: string, exitCode: number, durationMs: number } on success; " +
    "{ executed: false, error: string } on failure",
  category: "code",
  riskLevel: "high",
  // Sandbox kill + grace, so the handler's own timeout result wins the race.
  timeoutMs: resolved.timeoutMs + HANDLER_TIMEOUT_GRACE_MS,
  requiresApproval: true,
  source: "builtin",
  produces: "file",
  };
};

/** Default docker-execute definition (default sandbox config). Use {@link dockerExecuteToolFor} with a custom config. */
export const dockerExecuteTool: ToolDefinition = dockerExecuteToolFor();

/**
 * Create a docker-execute handler with optional config overrides.
 */
export const makeDockerExecuteHandler = (
  config?: Partial<DockerSandboxConfig>,
) => {
  const sandbox = makeDockerSandbox(config);

  return (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const code = args.code as string;
      const language = (args.language as RunnerLanguage) ?? "bun";

      const result = yield* sandbox.execute(code, language).pipe(
        Effect.catchAll((err) =>
          Effect.succeed({
            output: "",
            stderr: err.message,
            exitCode: 1,
            durationMs: 0,
            truncated: false,
            image: "unavailable",
          }),
        ),
      );

      if (result.exitCode !== 0) {
        return {
          executed: false,
          error: result.stderr || `Process exited with code ${result.exitCode}`,
          output: result.output || "(no output)",
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          image: result.image,
          truncated: result.truncated,
        };
      }

      // Try to parse output as JSON for structured results
      let parsed: unknown = result.output;
      try {
        parsed = JSON.parse(result.output);
      } catch {
        // Keep as string
      }

      return {
        executed: true,
        result: parsed ?? null,
        output: result.output || "(no output)",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        image: result.image,
        truncated: result.truncated,
      };
    });
};
