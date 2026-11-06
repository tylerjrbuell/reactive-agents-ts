import { Effect } from "effect";
import type { ToolDefinition } from "../../types.js";
import { ToolExecutionError } from "../../errors.js";
import { defaultCliRunner, splitCommand, capCliOutput, timedOutCliFields, type CliRunner } from "./cli-runner.js";
import { CLI_KILL_TIMEOUT_MS, HANDLER_TIMEOUT_GRACE_MS } from "../timeout-grace.js";

export type GwsCliResult = {
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

export const gwsCliTool: ToolDefinition = {
  name: "gws-cli",
  description:
    "Run any Google Workspace CLI (`gws`) command. " +
    "PREREQUISITE: the `gws` binary must be installed and authenticated via `gws auth login`. " +
    "If it is not installed, this tool will return an error — do NOT retry, just report the error. " +
    "Provides access to Gmail, Google Calendar, Google Drive, and other Workspace services. " +
    "Pass the subcommand + flags as `command`, e.g. `calendar events list`, " +
    "`gmail messages list --query unread`, `drive files list`. " +
    "Do NOT include the leading `gws` keyword. " +
    "Returns stdout, stderr, and exit code. Non-zero exits are surfaced as errors.",
  parameters: [
    {
      name: "command",
      type: "string",
      description: 'gws subcommand + flags, e.g. "calendar events list" or "gmail messages list --query unread".',
      required: true,
    },
  ],
  category: "productivity",
  riskLevel: "medium",
  timeoutMs: CLI_KILL_TIMEOUT_MS + HANDLER_TIMEOUT_GRACE_MS,
  requiresApproval: false,
  source: "builtin",
  produces: "data",
};

export const makeGwsCliHandler =
  (runner: CliRunner = defaultCliRunner) =>
  (args: Record<string, unknown>): Effect.Effect<GwsCliResult, ToolExecutionError> =>
    Effect.tryPromise({
      try: async () => {
        const command = (args.command as string | undefined)?.trim() ?? "";
        if (command.length === 0) {
          throw new Error("command must not be empty");
        }

        const cmdArgs = splitCommand(command);
        const start = Date.now();
        const run = await runner("gws", cmdArgs, CLI_KILL_TIMEOUT_MS);
        const durationMs = Date.now() - start;

        if (run.timedOut) {
          return { command: `gws ${command}`, durationMs, ...timedOutCliFields(run, CLI_KILL_TIMEOUT_MS) };
        }
        if (run.exitCode !== 0) {
          const detail = run.stderr.trim() || run.stdout.trim();
          throw new Error(`gws ${command} failed with exit ${run.exitCode}: ${detail}`);
        }

        const { stdout, truncated } = capCliOutput(run.stdout);
        return { command: `gws ${command}`, stdout, stderr: run.stderr, exitCode: run.exitCode, durationMs, truncated };
      },
      catch: (e) =>
        new ToolExecutionError({
          message: e instanceof Error ? e.message : String(e),
          toolName: "gws-cli",
          cause: e,
        }),
    });

export const gwsCliHandler = makeGwsCliHandler();
