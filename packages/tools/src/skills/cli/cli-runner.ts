import { execFile } from "node:child_process";

/** Result of a CLI subprocess invocation. */
export type CliRunResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

/**
 * Injectable CLI runner — swap the real implementation for a mock in tests.
 * @param cmd  The binary to execute (e.g. "git").
 * @param args Argument array passed directly to execFile (no shell expansion).
 * @param timeoutMs Hard kill timeout.
 */
export type CliRunner = (
  cmd: string,
  args: string[],
  timeoutMs: number,
) => Promise<CliRunResult>;

/** Production runner — uses node:child_process.execFile (no shell). */
export const defaultCliRunner: CliRunner = (cmd, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code !== undefined && typeof err.code === "number") {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? err.message, exitCode: err.code });
      } else if (err) {
        reject(err);
      } else {
        resolve({ stdout, stderr, exitCode: 0 });
      }
    });
  });

/** Maximum bytes returned in stdout/stderr before truncation. */
export const MAX_OUTPUT_BYTES = 32_768;

/**
 * Splits a user-facing command string (e.g. "log --oneline -5") into an arg
 * array suitable for execFile. Handles single-quoted segments so callers can
 * pass `--query 'name=report'` without shell interpretation.
 */
export function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (ch === "'" && !inSingleQuote) {
      inSingleQuote = true;
    } else if (ch === "'" && inSingleQuote) {
      inSingleQuote = false;
    } else if (ch === " " && !inSingleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) args.push(current);
  return args;
}
