import { Effect } from "effect";
import type { ToolDefinition } from "../../types.js";
import { ToolExecutionError } from "../../errors.js";
import { defaultCliRunner, splitCommand, MAX_OUTPUT_BYTES, type CliRunner } from "./cli-runner.js";

export type GwsCliResult = {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly truncated?: true;
};

export const gwsCliTool: ToolDefinition = {
  name: "gws-cli",
  description:
    "Run any Google Workspace CLI (`gws`) command. Requires the `gws` binary installed " +
    "and authenticated via `gws auth login`. Provides access to Gmail, Google Calendar, " +
    "Google Drive, and other Workspace services. " +
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
  timeoutMs: 30_000,
  requiresApproval: false,
  source: "builtin",
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
        const run = await runner("gws", cmdArgs, gwsCliTool.timeoutMs ?? 30_000);
        const durationMs = Date.now() - start;

        if (run.exitCode !== 0) {
          const detail = run.stderr.trim() || run.stdout.trim();
          throw new Error(`gws ${command} failed with exit ${run.exitCode}: ${detail}`);
        }

        let stdout = run.stdout;
        let truncated: true | undefined;
        if (stdout.length > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + `\n\n[output truncated at ${MAX_OUTPUT_BYTES} bytes]`;
          truncated = true;
        }

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
