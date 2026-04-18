import { Effect } from "effect";
import type { ToolDefinition } from "../../types.js";
import { ToolExecutionError } from "../../errors.js";
import { defaultCliRunner, splitCommand, MAX_OUTPUT_BYTES, type CliRunner } from "./cli-runner.js";

export type GitCliResult = {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly truncated?: true;
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
  timeoutMs: 30_000,
  requiresApproval: false,
  source: "builtin",
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
        const run = await runner("git", cmdArgs, gitCliTool.timeoutMs ?? 30_000);
        const durationMs = Date.now() - start;

        if (run.exitCode !== 0) {
          const detail = run.stderr.trim() || run.stdout.trim();
          throw new Error(`git ${command} failed with exit ${run.exitCode}: ${detail}`);
        }

        let stdout = run.stdout;
        let truncated: true | undefined;
        if (stdout.length > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + `\n\n[output truncated at ${MAX_OUTPUT_BYTES} bytes]`;
          truncated = true;
        }

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
