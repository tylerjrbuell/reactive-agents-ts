import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Run ids are ULIDs / `cortex-run-…` slugs; anything else never touches the filesystem. */
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Directories the framework tracer writes `<runId>.jsonl` into, most specific first. */
export function traceDirs(): string[] {
  const fromEnv = process.env.CORTEX_TRACE_DIR?.trim();
  return [
    ...(fromEnv ? [resolve(fromEnv)] : []),
    join(homedir(), ".reactive-agents", "traces"),
    resolve(".reactive-agents", "traces"),
  ];
}

/**
 * Raw framework trace (JSONL) for a run, exactly as the tracer wrote it, or
 * `undefined` when the run id is malformed or no trace file exists (tracing off,
 * or the run predates it).
 */
export function readRunTraceFile(runId: string, dirs: readonly string[] = traceDirs()): string | undefined {
  if (!SAFE_RUN_ID.test(runId)) return undefined;
  for (const dir of dirs) {
    const file = join(dir, `${runId}.jsonl`);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return undefined;
}
