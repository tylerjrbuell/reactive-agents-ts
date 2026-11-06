/**
 * shell-execute tool definition, built from the resolved shell config.
 *
 * The description is what the model reads to decide where files are and which
 * commands it may run, so it must state the real environment: the working
 * directory (run workspace, a configured cwd, a private /tmp sandbox, or a
 * throwaway Docker container), the allowed and not-enabled commands, and the
 * path confinement the handler enforces. A static "sandboxed /tmp" text made a
 * workspace-mode shell look like a temp sandbox (owner report 2026-11-06).
 *
 * Leaf module: imports policy values from `shell-execution.ts`, which never
 * imports back, so the top-level {@link shellExecuteTool} sees initialized data.
 */
import type { ToolDefinition } from "../types.js";
import { sandboxDockerEnabled } from "../flags.js";
import {
  DEFAULT_ALLOWED_COMMANDS,
  OPT_IN_COMMANDS,
  resolveCommandAccess,
  type ShellExecuteConfig,
} from "./shell-execution.js";

/**
 * How the runtime hosts the handler. `runWorkspace: true` means the handler is
 * wrapped so each run executes in that run's file root (the workspace), which
 * is only known per run, so the description states the rule, not a path.
 */
export interface ShellToolSurface {
  readonly runWorkspace?: boolean;
}

/** Interpreters whose inline code `dockerEscalation` routes into a container. */
const ESCALATABLE = ["node", "bun", "python", "python3"];

/** The model-facing sentence naming where commands run. */
function describeLocation(
  config: ShellExecuteConfig | undefined,
  surface: ShellToolSurface | undefined,
  docker: boolean,
): string {
  if (docker) {
    return (
      "Runs each command in a throwaway Docker container (no network, read-only root, " +
      "no host directory mounted; nothing persists between calls)."
    );
  }
  const cwd = config?.cwd;
  if (surface?.runWorkspace === true) {
    return cwd === undefined
      ? "Runs in the run's workspace directory (the same root file-read and file-write use); " +
          "with no workspace set, in a private temporary directory under /tmp."
      : `Runs in "${cwd}" inside the run's workspace directory (the same root file-read and file-write use).`;
  }
  if (cwd === undefined) {
    return "Runs in a private temporary directory under /tmp, created empty for this agent.";
  }
  if (config?.allowUnsafeCwd !== true && !cwd.startsWith("/tmp")) {
    return `The configured working directory ${cwd} is outside /tmp and allowUnsafeCwd is not set, so every call is refused.`;
  }
  return `Runs in ${cwd}.`;
}

/**
 * Build the shell-execute definition for a resolved config. Mode resolution
 * mirrors `shellExecuteHandler`: `config.sandbox`, else `RA_SANDBOX=docker`,
 * else host. Only `description` and the parameter text vary by config.
 */
export function shellExecuteToolFor(
  config?: ShellExecuteConfig,
  surface?: ShellToolSurface,
): ToolDefinition {
  const docker = (config?.sandbox ?? (sandboxDockerEnabled() ? "docker" : "host")) === "docker";
  const allowed = [
    ...new Set([
      ...(config?.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS),
      ...(config?.additionalCommands ?? []),
      ...resolveCommandAccess(config?.commandAccess),
    ]),
  ];
  const notEnabled = OPT_IN_COMMANDS.filter((c) => !allowed.includes(c));
  const escalated =
    !docker && config?.dockerEscalation?.enabled === true
      ? ESCALATABLE.filter((c) => allowed.includes(c))
      : [];

  const description = [
    `Execute a shell command. ${describeLocation(config, surface, docker)}`,
    "Paths must stay inside the working directory: absolute paths elsewhere, `..` escapes and ~ are refused. " +
      "Each call is a fresh shell starting there (cd does not persist).",
    `Allowed commands: ${allowed.join(", ")}.`,
    notEnabled.length > 0 ? `Not enabled (developer opt-in required): ${notEnabled.join(", ")}.` : "",
    escalated.length > 0
      ? `Inline code for ${escalated.join(", ")} (-e/--eval/-c) runs in an isolated Docker container with no host files.`
      : "",
    config?.blockedPatterns
      ? "Commands matching the configured block-list are refused."
      : "Always blocked: rm, sudo, chmod 7xx, chown, kill, mkfs, dd, eval, piping into a shell, " +
        "find -exec/-delete, git -c, trailing &.",
    "No shell expansion ($VAR, ${...}, $(...), backticks) or process substitution.",
    "Returns { executed, output, exitCode, stderr, truncated }.",
  ]
    .filter((s) => s !== "")
    .join(" ");

  return {
    name: "shell-execute",
    description,
    parameters: [
      {
        name: "command",
        type: "string",
        description:
          "The shell command to execute. Every piped or chained segment must start with an allowed command. " +
          "Use paths relative to the working directory. " +
          "Examples: 'git log --oneline -5', 'ls -la', 'cat README.md'.",
        required: true,
      },
    ],
    returnType:
      "{ executed: true, output: string, stderr: string, exitCode: number, truncated: boolean, fullOutput?: string, fullStderr?: string } | " +
      "{ executed: false, success: false, error: string } — the success: false on denials marks it a FAILED observation (error-recovery guidance fires)",
    category: "system",
    riskLevel: "high",
    timeoutMs: 30_000,
    requiresApproval: true,
    source: "builtin",
    // CAN write files via redirects / commands — file producer (audit 01-F1 / C2).
    produces: "file",
  };
}

/**
 * Default-mode definition (no config, not workspace-hosted). Kept for callers
 * that need the tool's name/flags without a config; runtime registration
 * should use {@link shellExecuteToolFor} with the resolved terminal config.
 */
export const shellExecuteTool: ToolDefinition = shellExecuteToolFor();
