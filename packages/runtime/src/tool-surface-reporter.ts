import { Effect, Layer, Ref } from 'effect'
import { EventBus } from '@reactive-agents/core'
import { ObservabilityService } from '@reactive-agents/observability'
import type { ObsLike } from './engine/runtime-context.js'
import { emitErrorSwallowed, errorTag } from '@reactive-agents/core'

/**
 * Live console line for the kernel's ACTUAL per-iteration visible tool
 * surface — not the full tool registry.
 *
 * `tools-registry.ts`'s `[strategy]` line prints `ToolService.listTools()`,
 * the full registered catalog, once at setup. That is misleading on its own
 * (2026-07-29, user confusion running scratch.ts): a user reasonably reads
 * "tools: web-search, file-write, ..." as "the agent can call these," but
 * lazy disclosure (tool-surface.ts) prunes the actual per-iteration visible
 * set down from that list, and post-TE-1 (classifier no longer default-on)
 * the gap between "registered" and "visible this turn" can be large.
 *
 * The kernel already emits the real answer every iteration as a public,
 * typed event (`ToolSurfaceResolvedEmitted` — `emitToolSurfaceResolved` in
 * `packages/reasoning/src/kernel/utils/diagnostics.ts`), with `visible`,
 * `callable`, and a per-tool reason map. This layer subscribes to that event
 * and prints a line whenever the visible set changes, so a user watching
 * normal-verbosity console output sees the truth without needing
 * `rax:diagnose replay --only=tool-surface-resolved`.
 *
 * Deliberately unconditional (unlike the opt-in cortex reporter) — the whole
 * point is that a user should not have to discover a new `.withXyz()` call
 * to get an accurate answer to "what can my agent actually call." It
 * self-gates on `obs`/verbosity exactly like every other console line in
 * this package, so it is a true no-op when observability isn't configured to
 * print (no EventBus subscription is made in that case).
 *
 * Modeled directly on `RuntimeCortexReporterLive` (cortex-reporter.ts) —
 * same `Layer.scopedDiscard(Effect.acquireRelease(...))` shape, so
 * subscribe/unsubscribe is tied to this layer's own scope rather than to any
 * single task run (a built agent's EventBus and this layer both live for the
 * agent's lifetime across multiple `.run()`/`.chat()` calls).
 */
export const RuntimeToolSurfaceReporterLive = Layer.scopedDiscard(
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
            // taskId -> last-printed visible set, so an unchanged surface across
            // iterations doesn't reprint identically on every turn.
            const lastVisibleRef = yield* Ref.make(new Map<string, string>())

            const unsubscribe = yield* eventBus.subscribe((event) =>
                Effect.gen(function* () {
                    if (event._tag !== 'ToolSurfaceResolvedEmitted') return
                    const key = [...event.visible].sort().join(',')
                    const last = yield* Ref.get(lastVisibleRef)
                    if (last.get(event.taskId) === key) return
                    yield* Ref.update(lastVisibleRef, (m) =>
                        new Map(m).set(event.taskId, key)
                    )
                    const names =
                        event.visible.length > 0
                            ? event.visible.join(', ')
                            : '(none)'
                    yield* obs.info(`◉ [tools]   visible: ${names}`).pipe(
                        Effect.catchAll((err) =>
                            emitErrorSwallowed({
                                site: 'runtime/src/tool-surface-reporter.ts:print',
                                tag: errorTag(err),
                            })
                        )
                    )
                }).pipe(
                    Effect.catchAll((err) =>
                        emitErrorSwallowed({
                            site: 'runtime/src/tool-surface-reporter.ts:subscribe',
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
