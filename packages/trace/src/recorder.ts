// packages/trace/src/recorder.ts
import { Context, Effect, Layer, Ref } from "effect"
import { mkdir, appendFile, readdir, stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import type { TraceEvent } from "./events.js"
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { applyRedactors, defaultRedactors } from "@reactive-agents/observability";

// ─── Retention ───────────────────────────────────────────────────────────────
//
// Tracing is default-ON and every run appends a file, but nothing ever
// deleted one. Audited 2026-07-10: 113,824 files / 670 MB in
// ~/.reactive-agents/traces, including a single uncorrelated catch-all
// (llm-direct.jsonl) holding 110k+ exchanges. An observability store nobody
// can list is not observable.
//
// Policy, applied once per recorder layer init (per process), oldest-first by
// mtime, errors swallowed (retention must never break tracing itself):
//   - keep at most RA_TRACE_MAX_FILES run files   (default 500)
//   - drop run files older than RA_TRACE_MAX_AGE_DAYS (default 14)
//   - delete llm-direct.jsonl when it exceeds 25 MB (uncorrelated diagnostics;
//     run-attributed exchanges live in the per-run files)

const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_AGE_DAYS = 14;
const LLM_DIRECT_MAX_BYTES = 25 * 1024 * 1024;

// Run files are ULID-named (01….jsonl). Anything else (llm-direct.jsonl,
// structured-output.jsonl, classify-tool-relevance.jsonl, …) is an
// uncorrelated catch-all: it is appended to forever, so its mtime always
// looks fresh and the age/count rules never fire. Catch-alls get the size
// cap instead (observed 2026-07-10: structured-output.jsonl at 3.5 MB and
// growing after a single day).
const ULID_RUN_FILE = /^[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/;

async function pruneTraceDir(dir: string): Promise<void> {
  const maxFiles = Number(process.env.RA_TRACE_MAX_FILES ?? DEFAULT_MAX_FILES);
  const maxAgeMs =
    Number(process.env.RA_TRACE_MAX_AGE_DAYS ?? DEFAULT_MAX_AGE_DAYS) * 86_400_000;
  const now = Date.now();

  const names = await readdir(dir);
  const files: { path: string; mtime: number; size: number; name: string }[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    try {
      const s = await stat(join(dir, name));
      files.push({ path: join(dir, name), mtime: s.mtimeMs, size: s.size, name });
    } catch {
      // raced with a concurrent delete — skip
    }
  }

  for (const f of files) {
    if (!ULID_RUN_FILE.test(f.name)) {
      if (f.size > LLM_DIRECT_MAX_BYTES) await unlink(f.path).catch(() => {});
      continue;
    }
    if (maxAgeMs > 0 && now - f.mtime > maxAgeMs) await unlink(f.path).catch(() => {});
  }

  const survivors = files
    .filter((f) => ULID_RUN_FILE.test(f.name) && now - f.mtime <= maxAgeMs)
    .sort((a, b) => b.mtime - a.mtime);
  for (const f of survivors.slice(Math.max(0, maxFiles))) {
    await unlink(f.path).catch(() => {});
  }
}

// ─── Service Interface ───

export interface TraceRecorder {
  readonly emit: (ev: TraceEvent) => Effect.Effect<void, never>
  readonly snapshot: (runId: string) => Effect.Effect<readonly TraceEvent[], never>
  readonly flush: (runId: string) => Effect.Effect<void, never>
  readonly flushAll: () => Effect.Effect<void, never>
  readonly close: (runId: string) => Effect.Effect<void, never>
}

// ─── Service Tag ───

export class TraceRecorderService extends Context.Tag(
  "@reactive-agents/trace/Recorder",
)<TraceRecorderService, TraceRecorder>() {}

// ─── Options ───

export interface TraceRecorderOptions {
  /** Directory to write JSONL files. null = memory only. */
  readonly dir: string | null
}

// ─── Live Layer ───

export function TraceRecorderServiceLive(opts: TraceRecorderOptions): Layer.Layer<TraceRecorderService> {
  return Layer.effect(
    TraceRecorderService,
    Effect.gen(function* () {
      // Retention runs once per layer init, forked as a daemon so a huge
      // backlog (113k files when first shipped) never delays the first run.
      if (opts.dir !== null) {
        const dir = opts.dir;
        yield* Effect.forkDaemon(
          Effect.tryPromise({ try: () => pruneTraceDir(dir), catch: (e) => new Error(String(e)) }).pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "trace/src/recorder.ts:prune", tag: errorTag(err) }),
            ),
          ),
        );
      }

      // All events per runId (in-memory buffer)
      const buffers = yield* Ref.make(new Map<string, TraceEvent[]>())
      // Events pending disk write per runId
      const pending = yield* Ref.make(new Map<string, TraceEvent[]>())

      const emit = (ev: TraceEvent): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          yield* Ref.update(buffers, (m) => {
            const next = new Map(m)
            const cur = next.get(ev.runId) ?? []
            next.set(ev.runId, [...cur, ev])
            return next
          })
          if (opts.dir !== null) {
            yield* Ref.update(pending, (m) => {
              const next = new Map(m)
              const cur = next.get(ev.runId) ?? []
              next.set(ev.runId, [...cur, ev])
              return next
            })
          }
        })

      const snapshot = (runId: string): Effect.Effect<readonly TraceEvent[], never> =>
        Effect.gen(function* () {
          const m = yield* Ref.get(buffers)
          return m.get(runId) ?? []
        })

      const flush = (runId: string): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          if (opts.dir === null) return
          const dir = opts.dir
          const m = yield* Ref.get(pending)
          const events = m.get(runId) ?? []
          if (events.length === 0) return
          yield* Effect.tryPromise({
            try: () => mkdir(dir, { recursive: true }),
            catch: (e) => new Error(String(e)),
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "trace/src/recorder.ts:75", tag: errorTag(err) })))
          const path = join(dir, `${runId}.jsonl`)
          const rawBody = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
          // F8: redact secrets (API keys, bearer tokens) before they reach disk.
          // The in-memory snapshot (same-process debugging) keeps full fidelity.
          const body = yield* applyRedactors(rawBody, defaultRedactors)
          yield* Effect.tryPromise({
            try: () => appendFile(path, body),
            catch: (e) => new Error(String(e)),
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "trace/src/recorder.ts:81", tag: errorTag(err) })))
          yield* Ref.update(pending, (m) => {
            const next = new Map(m)
            next.set(runId, [])
            return next
          })
        })

      const flushAll = (): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          const m = yield* Ref.get(pending)
          for (const runId of m.keys()) {
            yield* flush(runId)
          }
        })

      const close = (runId: string): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          yield* flush(runId)
          yield* Ref.update(buffers, (m) => {
            const next = new Map(m)
            next.delete(runId)
            return next
          })
          yield* Ref.update(pending, (m) => {
            const next = new Map(m)
            next.delete(runId)
            return next
          })
        })

      return TraceRecorderService.of({ emit, snapshot, flush, flushAll, close })
    }),
  )
}
