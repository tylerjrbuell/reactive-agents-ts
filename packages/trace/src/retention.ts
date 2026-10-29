// packages/trace/src/retention.ts
//
// Trace retention with provenance. 2026-10-29 failure-mode census: unit tests
// wrote ~2,900 synthetic traces into the real corpus and the old count-based
// prune (newest 500) deleted real-model runs to make room for noise.
//
// Policy (oldest-first, errors swallowed, never breaks tracing):
//   - Every run file is classified by its first `run-started` line:
//     provider "test" or model starting "test" => synthetic; anything else
//     (including unreadable/unknown) => real. Unknown is protected as real.
//   - Synthetic: deleted when older than RA_TRACE_SYNTHETIC_MAX_AGE_HOURS
//     (default 24) and, beyond RA_TRACE_SYNTHETIC_MAX_FILES (default 200),
//     oldest first. Synthetic noise can never displace real runs.
//   - Real: deleted only when BOTH older than RA_TRACE_REAL_MAX_AGE_DAYS
//     (default 90) AND outside the newest RA_TRACE_REAL_MIN_RUNS (default 500);
//     plus a generous total-size cap RA_TRACE_REAL_MAX_BYTES (default 4 GiB)
//     that drops oldest real runs beyond it.
//   - Files modified within the last 10 minutes are never deleted (a live run
//     in another process may still be appending).
//   - Catch-all (non-ULID) files: deleted when over 25 MB (appended forever,
//     mtime always fresh, so age rules cannot apply).
import { readdir, stat, open, unlink } from "node:fs/promises"
import { join } from "node:path"

const ULID_RUN_FILE = /^[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/
const CATCHALL_MAX_BYTES = 25 * 1024 * 1024
const ACTIVE_GRACE_MS = 10 * 60_000
const HEAD_BYTES = 128 * 1024

export type TraceProvenance = "real" | "synthetic"

/** Resolved retention bounds. */
export interface RetentionPolicy {
  readonly syntheticMaxAgeMs: number
  readonly syntheticMaxFiles: number
  readonly realMinRuns: number
  readonly realMaxAgeMs: number
  readonly realMaxBytes: number
}

/** A run file as seen by the planner. */
export interface TraceFileInfo {
  readonly name: string
  readonly mtime: number
  readonly size: number
  readonly provenance: TraceProvenance
}

const num = (v: string | undefined, d: number): number => {
  const n = Number(v)
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d
}

/** Read the policy from `RA_TRACE_*` env vars (see file header for defaults). */
export function retentionPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): RetentionPolicy {
  return {
    syntheticMaxAgeMs: num(env.RA_TRACE_SYNTHETIC_MAX_AGE_HOURS, 24) * 3_600_000,
    syntheticMaxFiles: num(env.RA_TRACE_SYNTHETIC_MAX_FILES, 200),
    realMinRuns: num(env.RA_TRACE_REAL_MIN_RUNS, 500),
    realMaxAgeMs: num(env.RA_TRACE_REAL_MAX_AGE_DAYS, 90) * 86_400_000,
    realMaxBytes: num(env.RA_TRACE_REAL_MAX_BYTES, 4 * 1024 ** 3),
  }
}

/** Classify a trace from its first line. Test provider/model => synthetic; unknown => real. */
export function classifyProvenance(firstLine: string): TraceProvenance {
  const provider = /"provider":"([^"]*)"/.exec(firstLine)?.[1]
  const model = /"model":"([^"]*)"/.exec(firstLine)?.[1]
  if (provider === "test" || (model !== undefined && model.startsWith("test"))) return "synthetic"
  return "real"
}

/**
 * Pure planner: names of run files to delete. Newest-first ordering by mtime.
 */
export function planRunPrune(
  files: readonly TraceFileInfo[],
  policy: RetentionPolicy,
  now: number,
): string[] {
  const doomed = new Set<string>()
  const idle = (f: TraceFileInfo) => now - f.mtime > ACTIVE_GRACE_MS
  const newestFirst = [...files].sort((a, b) => b.mtime - a.mtime)

  const synth = newestFirst.filter((f) => f.provenance === "synthetic")
  synth.forEach((f, i) => {
    if (!idle(f)) return
    if (now - f.mtime > policy.syntheticMaxAgeMs || i >= policy.syntheticMaxFiles) doomed.add(f.name)
  })

  const real = newestFirst.filter((f) => f.provenance === "real")
  let bytes = 0
  real.forEach((f, i) => {
    bytes += f.size
    if (!idle(f)) return
    const protectedByCount = i < policy.realMinRuns
    const tooOld = now - f.mtime > policy.realMaxAgeMs
    if (!protectedByCount && tooOld) doomed.add(f.name)
    else if (bytes > policy.realMaxBytes && !protectedByCount) doomed.add(f.name)
  })
  return [...doomed]
}

async function firstLine(path: string): Promise<string> {
  const fh = await open(path, "r")
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
    const text = buf.toString("utf8", 0, bytesRead)
    const nl = text.indexOf("\n")
    return nl === -1 ? text : text.slice(0, nl)
  } finally {
    await fh.close()
  }
}

/** Apply the retention policy to `dir`. Safe to run concurrently; never throws per-file. */
export async function pruneTraceDir(dir: string, policy: RetentionPolicy = retentionPolicyFromEnv()): Promise<void> {
  const now = Date.now()
  const runs: TraceFileInfo[] = []
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".jsonl")) continue
    const path = join(dir, name)
    try {
      const s = await stat(path)
      if (!ULID_RUN_FILE.test(name)) {
        if (s.size > CATCHALL_MAX_BYTES) await unlink(path).catch(() => {})
        continue
      }
      const provenance = classifyProvenance(await firstLine(path).catch(() => ""))
      runs.push({ name, mtime: s.mtimeMs, size: s.size, provenance })
    } catch {
      // raced with a concurrent delete — skip
    }
  }
  for (const name of planRunPrune(runs, policy, now)) await unlink(join(dir, name)).catch(() => {})
}
