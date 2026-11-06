import { execFile } from "node:child_process";
import { constants } from "node:os";
import { timeoutMarker } from "../shell-host-process.js";

/** Result of a CLI subprocess invocation. */
export type CliRunResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** `true` when the kill timeout fired; stdout/stderr hold the output gathered before it. */
  readonly timedOut?: boolean;
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
      if (!err) {
        resolve({ stdout, stderr, exitCode: 0 });
      } else if (err.killed && err.code === null) {
        // Killed at the timeout: keep the partial output instead of dropping it.
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 128 + signalNumber(err.signal), timedOut: true });
      } else if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Binary not found — produce a clear error so the model stops immediately
        reject(new Error(`Executable not found in $PATH: "${cmd}". Install it before using this tool.`));
      } else if (typeof (err as NodeJS.ErrnoException).code === "number") {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? err.message, exitCode: (err as NodeJS.ErrnoException).code as unknown as number });
      } else {
        reject(err);
      }
    });
  });

/** Signal number for an exit-code-style `128 + n`; 0 when unknown. */
function signalNumber(signal: NodeJS.Signals | null | undefined): number {
  const table: Readonly<Record<string, number>> = constants.signals;
  return signal ? table[signal] ?? 0 : 0;
}

/** Maximum bytes returned in stdout/stderr before truncation. */
export const MAX_OUTPUT_BYTES = 32_768;

/** Cap stdout at {@link MAX_OUTPUT_BYTES}, marking the cut. */
export function capCliOutput(stdout: string): { readonly stdout: string; readonly truncated?: true } {
  if (stdout.length <= MAX_OUTPUT_BYTES) return { stdout };
  return { stdout: stdout.slice(0, MAX_OUTPUT_BYTES) + `\n\n[output truncated at ${MAX_OUTPUT_BYTES} bytes]`, truncated: true };
}

/** Output fields of a timed-out CLI run ({@link timedOutCliFields}). */
export interface TimedOutCliFields {
  readonly stdout: string;
  readonly truncated?: true;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: true;
  readonly note?: string;
}

/**
 * Result fields for a CLI run killed at its timeout: the partial output plus
 * `timedOut: true` and a note naming the limit (same marker as shell-execute).
 * Returned to the model as data, not raised as an error, so the output
 * gathered before the kill is not lost.
 */
export function timedOutCliFields(run: CliRunResult, timeoutMs: number): TimedOutCliFields {
  return {
    ...capCliOutput(run.stdout),
    stderr: run.stderr,
    exitCode: run.exitCode,
    ...timeoutMarker(true, timeoutMs),
  };
}

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
