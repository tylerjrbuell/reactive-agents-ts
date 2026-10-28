import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
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

/** One run's trace within a delegation tree. */
export interface TreeTrace {
  readonly runId: string;
  readonly startedAt: number;
  readonly raw: string;
}

/** First line of a file (bounded read), parsed; `undefined` when unreadable or not JSON. */
function firstEvent(file: string): Record<string, unknown> | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const line = buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The root run's trace followed by every descendant's trace (files whose events carry
 * `rootRunId === rootRunId`, as the tracer stamps them), ordered root first, then by start time.
 * Malformed ids never touch the filesystem; returns `[]` when the root has no trace file.
 * Candidates are bounded to files modified at or after the root started, so a large trace
 * directory is not read in full.
 */
export function readRunTreeTraces(rootRunId: string, dirs: readonly string[] = traceDirs()): TreeTrace[] {
  const rootRaw = readRunTraceFile(rootRunId, dirs);
  if (rootRaw === undefined) return [];
  const rootStart = Number((JSON.parse(rootRaw.split("\n")[0] ?? "{}") as { timestamp?: unknown }).timestamp ?? 0) || 0;
  const out: TreeTrace[] = [{ runId: rootRunId, startedAt: rootStart, raw: rootRaw }];
  const seen = new Set<string>([rootRunId]);
  const kids: TreeTrace[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const id = name.slice(0, -".jsonl".length);
      if (seen.has(id) || !SAFE_RUN_ID.test(id)) continue;
      const file = join(dir, name);
      try {
        if (statSync(file).mtimeMs < rootStart) continue;
      } catch {
        continue;
      }
      const first = firstEvent(file);
      if (!first || first.rootRunId !== rootRunId) continue;
      seen.add(id);
      kids.push({ runId: id, startedAt: Number(first.timestamp ?? 0) || 0, raw: readFileSync(file, "utf8") });
    }
  }
  kids.sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId));
  return [...out, ...kids];
}
