import { Effect } from "effect";
import type { ToolDefinition } from "../../types.js";
import { ToolExecutionError } from "../../errors.js";
import { defaultCliRunner, splitCommand, capCliOutput, timedOutCliFields, type CliRunner } from "./cli-runner.js";
import { CLI_KILL_TIMEOUT_MS, HANDLER_TIMEOUT_GRACE_MS } from "../timeout-grace.js";

export type GitCliResult = {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly truncated?: true;
  /** Killed at the timeout; `stdout` is the partial output. */
  readonly timedOut?: true;
  readonly note?: string;
};

export const gitCliTool: ToolDefinition = {
  name: "git-cli",
  description:
    "Run any git subcommand in the current working directory. " +
    "Pass the subcommand and flags as `command`, e.g. `status`, `log --oneline -10`, " +
    "`diff HEAD~1`, `branch -a`. Do NOT include the leading `git` keyword. " +
    "Returns stdout, stderr, and exit code. Non-zero exit codes are surfaced as errors.",
  parameters: [
    {
      name: "command",
      type: "string",
      description: 'git subcommand + flags, e.g. "log --oneline -5" or "status --short".',
      required: true,
    },
  ],
  category: "vcs",
  riskLevel: "medium",
  timeoutMs: CLI_KILL_TIMEOUT_MS + HANDLER_TIMEOUT_GRACE_MS,
  requiresApproval: false,
  source: "builtin",
  produces: "data",
};

export const makeGitCliHandler =
  (runner: CliRunner = defaultCliRunner) =>
  (args: Record<string, unknown>): Effect.Effect<GitCliResult, ToolExecutionError> =>
    Effect.tryPromise({
      try: async () => {
        const command = (args.command as string | undefined)?.trim() ?? "";
        if (command.length === 0) {
          throw new Error("command must not be empty");
        }

        const cmdArgs = splitCommand(command);
        const start = Date.now();
        const run = await runner("git", cmdArgs, CLI_KILL_TIMEOUT_MS);
        const durationMs = Date.now() - start;

        if (run.timedOut) {
          return { command: `git ${command}`, durationMs, ...timedOutCliFields(run, CLI_KILL_TIMEOUT_MS) };
        }
        if (run.exitCode !== 0) {
          const detail = run.stderr.trim() || run.stdout.trim();
          throw new Error(`git ${command} failed with exit ${run.exitCode}: ${detail}`);
        }

        const { stdout, truncated } = capCliOutput(run.stdout);
        return { command: `git ${command}`, stdout, stderr: run.stderr, exitCode: run.exitCode, durationMs, truncated };
      },
      catch: (e) =>
        new ToolExecutionError({
          message: e instanceof Error ? e.message : String(e),
          toolName: "git-cli",
          cause: e,
        }),
    });

export const gitCliHandler = makeGitCliHandler();
