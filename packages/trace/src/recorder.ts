// packages/trace/src/recorder.ts
import { Context, Effect, Layer, Ref } from "effect"
import { mkdir, appendFile } from "node:fs/promises"
import { join } from "node:path"
import type { TraceEvent } from "./events.js"

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
          }).pipe(Effect.catchAll(() => Effect.void))
          const path = join(dir, `${runId}.jsonl`)
          const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
          yield* Effect.tryPromise({
            try: () => appendFile(path, body),
            catch: (e) => new Error(String(e)),
          }).pipe(Effect.catchAll(() => Effect.void))
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
