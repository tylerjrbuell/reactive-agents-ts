// File: src/skills/docker-execution.ts
/**
 * Docker code execution tool — runs code in an isolated Docker container.
 * Safer than process-based execution for untrusted code.
 */
import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import { makeDockerSandbox } from "../execution/docker-sandbox.js";
import type { RunnerLanguage, DockerSandboxConfig } from "../execution/docker-sandbox.js";

export const dockerExecuteTool: ToolDefinition = {
  name: "docker-execute",
  description:
    "Execute code in an isolated Docker container with strict resource limits. " +
    "Supports JavaScript (Bun), Node.js, and Python. " +
    "Network is disabled by default. Use console.log() (JS) or print() (Python) for output. " +
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
  timeoutMs: 30_000,
  requiresApproval: true,
  source: "builtin",
};

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
