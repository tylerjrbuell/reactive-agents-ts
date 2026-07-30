import { Effect, Layer, Ref } from 'effect'
import { EventBus } from '@reactive-agents/core'
import { ObservabilityService } from '@reactive-agents/observability'
import type { ObsLike } from './engine/runtime-context.js'
import { emitErrorSwallowed, errorTag } from '@reactive-agents/core'

/**
 * Live console line for the kernel's tool-result COMPRESSION decisions — the
 * moment a result the model asked for is replaced by a bounded preview+ref
 * because it overflowed the per-result budget.
 *
 * This is the signal whose absence cost a full debugging session (2026-07-30):
 * a 25-KB gh-cli result was silently crushed to a ~1.2-KB preview of author-URL
 * noise, the model couldn't see the commit data, and it fabricated the answer —
 * and NONE of it was visible without `RA_PROMPT_DUMP` archaeology. The root was
 * a budget/wire window divergence (budget froze to a 2048 fallback while the
 * wire num_ctx got the real 32768); a single line showing `raw→shown (budget @
 * window)` makes that class of failure obvious on sight, tightening the
 * diagnose loop from a multi-run dump hunt to one glance.
 *
 * The kernel already emits every render as a typed event
 * (`ProjectionRenderedEmitted` — `emitProjectionRendered` in
 * `packages/reasoning/src/kernel/utils/diagnostics.ts`), now carrying the
 * resolved `window`/`tier` and a `compressions` list. This layer subscribes and
 * prints ONLY when a result was compressed this turn — a full-fidelity render is
 * silent (no noise on the happy path). The same enriched event replays via
 * `rax diagnose replay --only=projection-rendered`, so the post-hoc path sees
 * the identical data.
 *
 * Modeled directly on `RuntimeToolSurfaceReporterLive` (tool-surface-reporter.ts)
 * — same `Layer.scopedDiscard(Effect.acquireRelease(...))` shape, unconditional,
 * self-gated on obs/verbosity, no-op when observability isn't printing.
 */
const fmtBytes = (n: number): string =>
    n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`

export const RuntimeContextCompressionReporterLive = Layer.scopedDiscard(
    Effect.acquireRelease(
        Effect.gen(function* () {
            const obsOpt = yield* Effect.serviceOption(
                ObservabilityService
            ).pipe(
                Effect.catchAll(() => Effect.succeed({ _tag: 'None' as const }))
            )
            const obs: ObsLike | null =
                obsOpt._tag === 'Some'
                    ? (obsOpt.value as unknown as ObsLike)
                    : null
            if (!obs) return () => {}

            const verbosity =
                (obs.verbosity?.() as
                    | 'minimal'
                    | 'normal'
                    | 'verbose'
                    | 'debug'
                    | undefined) ?? 'normal'
            if (verbosity === 'minimal') return () => {}

            const eventBus = yield* EventBus
            // taskId+tool -> last-printed raw size, so an unchanged compression
            // reprinted every iteration (the same stale result re-projected each
            // turn) doesn't spam identical lines.
            const lastSeenRef = yield* Ref.make(new Map<string, number>())

            const unsubscribe = yield* eventBus.subscribe((event) =>
                Effect.gen(function* () {
                    if (event._tag !== 'ProjectionRenderedEmitted') return
                    const compressions = event.compressions ?? []
                    if (compressions.length === 0) return
                    const winStr =
                        event.window !== undefined
                            ? `, window ${event.window}${event.tier ? ` (${event.tier})` : ''}`
                            : ''
                    for (const c of compressions) {
                        const dedupeKey = `${event.taskId}:${c.tool}`
                        const last = yield* Ref.get(lastSeenRef)
                        if (last.get(dedupeKey) === c.rawChars) continue
                        yield* Ref.update(lastSeenRef, (m) =>
                            new Map(m).set(dedupeKey, c.rawChars)
                        )
                        const pct =
                            c.rawChars > 0
                                ? Math.round((c.shownChars / c.rawChars) * 100)
                                : 100
                        yield* obs
                            .info(
                                `◉ [ctx]        ${c.tool} result ${fmtBytes(c.rawChars)}→${fmtBytes(c.shownChars)} (${pct}%, budget ${fmtBytes(c.budget)}${winStr}) — compressed to preview+ref`
                            )
                            .pipe(
                                Effect.catchAll((err) =>
                                    emitErrorSwallowed({
                                        site: 'runtime/src/context-compression-reporter.ts:print',
                                        tag: errorTag(err),
                                    })
                                )
                            )
                    }
                }).pipe(
                    Effect.catchAll((err) =>
                        emitErrorSwallowed({
                            site: 'runtime/src/context-compression-reporter.ts:subscribe',
                            tag: errorTag(err),
                        })
                    )
                )
            )
            return unsubscribe
        }),
        (unsubscribe) => Effect.sync(() => unsubscribe())
    )
)
