// Resolve a runId or path to a trace JSONL file location.
//
// Accepts:
//   - absolute path to a .jsonl file
//   - relative path to a .jsonl file
//   - bare runId (resolves to ~/.reactive-agents/traces/<runId>.jsonl)
//   - "latest" alias (most-recently-modified .jsonl in default dir)
//
// Returns the absolute path or throws with a helpful "did-you-mean" if no
// match is found in the default trace directory.

import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";

export const DEFAULT_TRACE_DIR =
  process.env.REACTIVE_AGENTS_TRACE_DIR ?? join(homedir(), ".reactive-agents", "traces");

export async function resolveTracePath(idOrPath: string): Promise<string> {
  // Absolute / relative path that exists
  if (idOrPath.endsWith(".jsonl")) {
    const abs = isAbsolute(idOrPath) ? idOrPath : resolve(process.cwd(), idOrPath);
    if (existsSync(abs)) return abs;
    throw new Error(`Trace file not found at ${abs}`);
  }

  // "latest" — most recently modified file in default dir
  if (idOrPath === "latest") {
    const files = await listTraces();
    if (files.length === 0) {
      throw new Error(`No traces found in ${DEFAULT_TRACE_DIR}. Run an agent first.`);
    }
    return files[0]!.path;
  }

  // Bare runId — look in default dir
  const candidate = join(DEFAULT_TRACE_DIR, `${idOrPath}.jsonl`);
  if (existsSync(candidate)) return candidate;

  // Did-you-mean: scan and offer suggestions
  const files = await listTraces();
  const matches = files
    .filter((f) => f.runId.toLowerCase().includes(idOrPath.toLowerCase()))
    .slice(0, 5);
  const suggestion =
    matches.length > 0
      ? `\nDid you mean:\n  ${matches.map((m) => m.runId).join("\n  ")}`
      : `\n${files.length} traces in ${DEFAULT_TRACE_DIR}; latest: ${files[0]?.runId ?? "(none)"}`;
  throw new Error(`No trace found for runId "${idOrPath}".${suggestion}`);
}

export interface TraceFileInfo {
  readonly runId: string;
  readonly path: string;
  readonly mtime: Date;
  readonly sizeBytes: number;
}

export async function listTraces(dir = DEFAULT_TRACE_DIR): Promise<TraceFileInfo[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const jsonl = entries.filter((e) => e.endsWith(".jsonl"));
  const infos = await Promise.all(
    jsonl.map(async (name) => {
      const path = join(dir, name);
      const s = await stat(path);
      return { runId: name.replace(/\.jsonl$/, ""), path, mtime: s.mtime, sizeBytes: s.size };
    }),
  );
  return infos.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
