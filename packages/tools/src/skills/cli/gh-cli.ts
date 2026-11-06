import { Effect } from "effect";
import type { ToolDefinition } from "../../types.js";
import { ToolExecutionError } from "../../errors.js";
import { defaultCliRunner, splitCommand, capCliOutput, timedOutCliFields, type CliRunner } from "./cli-runner.js";
import { CLI_KILL_TIMEOUT_MS, HANDLER_TIMEOUT_GRACE_MS } from "../timeout-grace.js";

export type GhCliResult = {
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

export const ghCliTool: ToolDefinition = {
  name: "gh-cli",
  description:
    "Run any GitHub CLI (`gh`) command. Requires `gh` installed and authenticated. " +
    "Pass the subcommand + flags as `command`, e.g. `pr list --state open`, " +
    "`issue view 42`, `run list --limit 5`. Do NOT include the leading `gh` keyword. " +
    "Tip: add `--json <fields>` to get machine-readable JSON output. " +
    "Returns stdout, stderr, and exit code. Non-zero exits are surfaced as errors.",
  parameters: [
    {
      name: "command",
      type: "string",
      description: 'gh subcommand + flags, e.g. "pr list --state open --json number,title,state".',
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

export const makeGhCliHandler =
  (runner: CliRunner = defaultCliRunner) =>
  (args: Record<string, unknown>): Effect.Effect<GhCliResult, ToolExecutionError> =>
    Effect.tryPromise({
      try: async () => {
        const command = (args.command as string | undefined)?.trim() ?? "";
        if (command.length === 0) {
          throw new Error("command must not be empty");
        }

        const cmdArgs = splitCommand(command);
        const start = Date.now();
        const run = await runner("gh", cmdArgs, CLI_KILL_TIMEOUT_MS);
        const durationMs = Date.now() - start;

        if (run.timedOut) {
          return { command: `gh ${command}`, durationMs, ...timedOutCliFields(run, CLI_KILL_TIMEOUT_MS) };
        }
        if (run.exitCode !== 0) {
          const detail = run.stderr.trim() || run.stdout.trim();
          throw new Error(`gh ${command} failed with exit ${run.exitCode}: ${detail}`);
        }

        const { stdout, truncated } = capCliOutput(run.stdout);
        return { command: `gh ${command}`, stdout, stderr: run.stderr, exitCode: run.exitCode, durationMs, truncated };
      },
      catch: (e) =>
        new ToolExecutionError({
          message: e instanceof Error ? e.message : String(e),
          toolName: "gh-cli",
          cause: e,
        }),
    });

export const ghCliHandler = makeGhCliHandler();
