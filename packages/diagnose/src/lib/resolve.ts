// Resolve a runId or path to a trace JSONL file location.
//
// Accepts:
//   - absolute path to a .jsonl file
//   - relative path to a .jsonl file
//   - bare runId (resolves against every candidate trace dir)
//   - "latest" alias (most-recently-modified .jsonl across all candidate dirs)
//
// Returns the absolute path or throws with a helpful "did-you-mean" if no
// match is found in any candidate directory.
//
// Root fix 2026-09-04: this used to look ONLY in `~/.reactive-agents/traces`.
// The runtime builder's `.withTracing()` had its own, independently-hardcoded
// default of the cwd-relative `.reactive-agents/traces` (fixed separately in
// `packages/runtime/src/builder.ts`, but existing trace directories written
// under that stale default still exist on disk and other write paths could
// still diverge in the future) — so a trace written by an explicit
// `.withTracing()` call was silently invisible to every `rax diagnose`
// command. Instead of relying on every writer picking the same directory,
// the CLI now searches a fixed, ordered list of candidate directories and
// merges what it finds.

import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";

/**
 * Ordered, deduplicated list of directories to search for trace files.
 *
 * `REACTIVE_AGENTS_TRACE_DIR` is an explicit override — when set, it is the
 * ONLY directory searched (matches the pre-existing single-dir contract for
 * anyone already relying on it, e.g. `packages/benchmarks/src/replay-record.ts`
 * temporarily pointing traces at an isolated scratch dir for a bench run).
 * Otherwise every run-writing default this codebase has ever used is
 * searched: the canonical home-dir location, plus the cwd-relative one a
 * cwd-relative `.withTracing()` call can still produce.
 */
export function candidateTraceDirs(cwd: string = process.cwd()): string[] {
  const override = process.env.REACTIVE_AGENTS_TRACE_DIR;
  if (override && override.length > 0) return [override];

  const dirs = [
    join(homedir(), ".reactive-agents", "traces"),
    join(cwd, ".reactive-agents", "traces"),
  ];
  return [...new Set(dirs)];
}

/** Back-compat single-dir default — the first (canonical) candidate. */
export const DEFAULT_TRACE_DIR = candidateTraceDirs()[0]!;

export async function resolveTracePath(idOrPath: string): Promise<string> {
  // Absolute / relative path that exists
  if (idOrPath.endsWith(".jsonl")) {
    const abs = isAbsolute(idOrPath) ? idOrPath : resolve(process.cwd(), idOrPath);
    if (existsSync(abs)) return abs;
    throw new Error(`Trace file not found at ${abs}`);
  }

  const dirs = candidateTraceDirs();

  // "latest" — most recently modified file across every candidate dir
  if (idOrPath === "latest") {
    const files = await listTraces(dirs);
    if (files.length === 0) {
      throw new Error(`No traces found in: ${dirs.join(", ")}. Run an agent first.`);
    }
    return files[0]!.path;
  }

  // Bare runId — check each candidate dir in order
  for (const dir of dirs) {
    const candidate = join(dir, `${idOrPath}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }

  // Did-you-mean: scan every candidate dir and offer suggestions
  const files = await listTraces(dirs);
  const matches = files
    .filter((f) => f.runId.toLowerCase().includes(idOrPath.toLowerCase()))
    .slice(0, 5);
  const suggestion =
    matches.length > 0
      ? `\nDid you mean:\n  ${matches.map((m) => m.runId).join("\n  ")}`
      : `\n${files.length} traces across ${dirs.join(", ")}; latest: ${files[0]?.runId ?? "(none)"}`;
  throw new Error(`No trace found for runId "${idOrPath}".${suggestion}`);
}

export interface TraceFileInfo {
  readonly runId: string;
  readonly path: string;
  readonly mtime: Date;
  readonly sizeBytes: number;
}

async function listTracesInDir(dir: string): Promise<TraceFileInfo[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const jsonl = entries.filter((e) => e.endsWith(".jsonl"));
  return Promise.all(
    jsonl.map(async (name) => {
      const path = join(dir, name);
      const s = await stat(path);
      return { runId: name.replace(/\.jsonl$/, ""), path, mtime: s.mtime, sizeBytes: s.size };
    }),
  );
}

/**
 * List trace files across every candidate directory (or an explicit `dirs`
 * override), merged and sorted newest-first. A runId present in more than
 * one directory (e.g. old cwd-relative traces alongside new home-dir ones)
 * keeps only its most-recently-modified copy.
 */
export async function listTraces(
  dirs: string | readonly string[] = candidateTraceDirs(),
): Promise<TraceFileInfo[]> {
  const dirList = typeof dirs === "string" ? [dirs] : dirs;
  const perDir = await Promise.all(dirList.map(listTracesInDir));
  const byRunId = new Map<string, TraceFileInfo>();
  for (const info of perDir.flat()) {
    const existing = byRunId.get(info.runId);
    if (!existing || info.mtime > existing.mtime) byRunId.set(info.runId, info);
  }
  return [...byRunId.values()].sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
