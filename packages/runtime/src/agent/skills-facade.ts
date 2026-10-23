/**
 * Skills facade — `agent.skills()`, `agent.exportSkill()`,
 * `agent.loadSkill()`, and `agent.refineSkills()` moved out of
 * `reactive-agent.ts` (#217 / HS-247).
 *
 * The class methods on `ReactiveAgent` are thin delegates that construct the
 * {@link SkillsFacadeDeps} object per call, forward here, and run the
 * returned Effect through the agent's `ManagedRuntime`. Since Quality
 * program Task 6 (D1 bridge) the module boundary is Effect-native: every
 * method returns `Effect.Effect<A, E, R>` with a precise error channel and
 * the family's single Promise boundary lives in the shared shell helper
 * `runFacadeEffect` (`agent/run-facade-effect.ts`, called by the
 * `reactive-agent.ts` delegates).
 *
 * Rejection-VALUE identity vs. the pre-bridge async methods is preserved by
 * construction, via the defect channel:
 *   • incidental-throw sites (fs/path calls, `parseSKILLmd`, dynamic
 *     imports, the inner store-write `runPromise`) run inside
 *     `Effect.sync`/`Effect.promise`, whose thrown/rejected values become
 *     DEFECTS carrying the ORIGINAL instance (no wrapping, no stringifying —
 *     this is why the bridge exists: empirically on effect@3.19,
 *     `ManagedRuntime.runPromise` rejects typed failures AND defects with a
 *     fresh `FiberFailure` wrapper, so the shell bridge folds the channel via
 *     `Effect.either` and re-rejects the raw value verbatim);
 *   • the `E` channel carries only the DELIBERATE rejections the pre-bridge
 *     methods threw on purpose, with the same messages and construction
 *     sites (carried debt — no tagged errors mid-bridge; the error algebra
 *     belongs to a dedicated pass, not a structure bridge);
 *   • `loadSkill`'s store-write KEEPS its inner `deps.runtime.runPromise`:
 *     pre-bridge, a failing store reached callers as THAT call's
 *     `FiberFailure`, not the raw store error, so the inner boundary is
 *     preserved and its rejection folds to a defect carrying the same
 *     instance — byte-identical to the pre-bridge `await` of that call.
 *
 * The exported-typing of `skills()` is unchanged
 * (`import('@reactive-agents/core').SkillRecord[]`, deliberately loose —
 * see the original JSDoc history).
 */

import { Effect } from 'effect'
import { Context } from 'effect'
import { ManagedRuntime } from 'effect'

/**
 * Loose structural view of the `SkillStoreService` read surface, used by
 * `skills()`/`exportSkill()` (carried debt: the inline GenericTag shapes
 * from the pre-bridge bodies, key-interned against the real service —
 * GenericTag resolution is by key, so this matches the same way the inline
 * tags did).
 */
const SkillStoreListService = Context.GenericTag<{
    listAll: (agentId: string) => Effect.Effect<any[], unknown>
}>('SkillStoreService')

/**
 * Loose structural view of the `SkillStoreService` write surface, used by
 * `loadSkill()` (same key interning as {@link SkillStoreListService}).
 */
const SkillStoreUpsertService = Context.GenericTag<{
    store: (record: any) => Effect.Effect<string, unknown>
}>('SkillStoreService')

/**
 * Loose structural view of `SkillDistillerService`, used by
 * `refineSkills()`.
 */
const SkillDistillerService = Context.GenericTag<{
    distill: (agentId: string) => Effect.Effect<{ refined: number }, unknown>
}>('SkillDistillerService')

/** Explicit dependency surface — exactly the `ReactiveAgent` fields the moved methods read. */
export interface SkillsFacadeDeps {
    readonly agentId: string
    /**
     * The agent's ManagedRuntime. Since Task 6 (D1 bridge) the facade
     * methods return Effects and the class shell runs them; this field is
     * still read directly by `loadSkill`'s store-write section, whose inner
     * `runPromise` is preserved for rejection-VALUE identity (see its JSDoc).
     */
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>
}

/**
 * Build the skills facade object — the four public skills primitives,
 * moved from `reactive-agent.ts` internals and Effect-typed per Task 6.
 */
export const makeSkillsFacade = (deps: SkillsFacadeDeps) => {
    const facade = {
        /**
         * List all loaded skills for this agent (moved verbatim from
         * `ReactiveAgent.skills`).
         *
         * Effect-typed: `E = never` — the pre-bridge outer `try/catch`
         * swallowed BOTH typed failures and defects into the `[]` fallback;
         * mirrored by `catchAll` + `catchAllDefect`. `SkillStoreService`
         * absent (`None`) still yields `[]`; a present store's exact array
         * passes through by identity.
         */
        skills(): Effect.Effect<
            import('@reactive-agents/core').SkillRecord[],
            never,
            typeof SkillStoreListService
        > {
            const agentId = deps.agentId
            return Effect.gen(function* () {
                const store = yield* Effect.serviceOption(SkillStoreListService)
                if (store._tag !== 'Some') return []
                return yield* store.value.listAll(agentId)
            }).pipe(
                // Pre-bridge `catch { return [] }` around the awaited
                // inner runPromise caught rejections from BOTH channels.
                Effect.catchAll(() => Effect.succeed([])),
                Effect.catchAllDefect(() => Effect.succeed([])),
            )
        },

        /**
         * Export a skill to SKILL.md format (moved verbatim from
         * `ReactiveAgent.exportSkill`).
         *
         * Effect-typed: `E = Error` is only the DELIBERATE not-found
         * rejection (pre-bridge message kept verbatim); fs/path dynamic
         * imports and sync throws fold to defects carrying the original
         * instance via `Effect.promise`/`Effect.sync` and are re-raised raw
         * by the class-shell bridge — the same values the async method
         * rejected with.
         */
        exportSkill(
            name: string,
            outputPath?: string,
        ): Effect.Effect<string, Error, typeof SkillStoreListService> {
            return Effect.gen(function* () {
                const allSkills = yield* facade.skills()
                const skill = allSkills.find((s: any) => s.name === name)
                if (!skill)
                    return yield* Effect.fail(
                        new Error(`Skill "${name}" not found`),
                    )

                const fs = yield* Effect.promise(() => import('node:fs'))
                const path = yield* Effect.promise(() => import('node:path'))
                const dir = yield* Effect.sync(
                    () => outputPath ?? path.join('.', '.agents', 'skills', name),
                )
                yield* Effect.sync(() =>
                    fs.mkdirSync(dir, { recursive: true }),
                )

                const frontmatter = [
                    '---',
                    `name: ${skill.name}`,
                    `description: ${skill.description}`,
                    `# source: ${skill.source}`,
                    `# confidence: ${skill.confidence}`,
                    `# version: ${skill.version}`,
                    '---',
                ].join('\n')

                const filePath = yield* Effect.sync(() => {
                    const fp = path.join(dir, 'SKILL.md')
                    fs.writeFileSync(
                        fp,
                        `${frontmatter}\n\n${skill.instructions}\n`,
                    )
                    return fp
                })
                return filePath
            })
        },

        /**
         * Load a SKILL.md skill at runtime (moved verbatim from
         * `ReactiveAgent.loadSkill`).
         *
         * Effect-typed: `E = Error` is only the DELIBERATE not-parsed
         * rejection (pre-bridge message verbatim); statSync / `parseSKILLmd`
         * / dynamic-import failures fold to defects carrying the original
         * instance.
         *
         * IDENTITY EXCEPTION (documented, Task 6): the store-write section
         * KEEPS its inner `deps.runtime.runPromise`. Pre-bridge, a failing
         * store reached callers as THAT runPromise call's `FiberFailure`
         * rejection value, not the raw store error — folding the gen into
         * the outer effect would deliver the raw error instead and change
         * the value. So the inner boundary is preserved, wrapped in
         * `Effect.promise` so its rejection folds to a defect carrying the
         * same instance unchanged, and the shell bridge re-raises it
         * verbatim. Fiber parenting for this section is therefore unchanged
         * from pre-bridge.
         */
        loadSkill(skillPath: string): Effect.Effect<void, Error> {
            return Effect.gen(function* () {
                const { parseSKILLmd } = yield* Effect.promise(() =>
                    import('@reactive-agents/reactive-intelligence'),
                )
                const fs = yield* Effect.promise(() => import('node:fs'))
                const path = yield* Effect.promise(() => import('node:path'))

                const skillMdPath = yield* Effect.sync(
                    () =>
                        fs.statSync(skillPath).isDirectory()
                            ? path.join(skillPath, 'SKILL.md')
                            : skillPath,
                )

                const parsed = yield* Effect.sync(() =>
                    parseSKILLmd(skillMdPath),
                )
                if (!parsed)
                    return yield* Effect.fail(
                        new Error(`Failed to parse SKILL.md at ${skillMdPath}`),
                    )

                const agentId = deps.agentId
                yield* Effect.promise(() =>
                    deps.runtime.runPromise(
                        Effect.gen(function* () {
                            const store = yield* Effect.serviceOption(
                                SkillStoreUpsertService,
                            )
                            if (store._tag !== 'Some') return
                            yield* store.value.store({
                                id: `installed-${parsed.name}`,
                                name: parsed.name,
                                description: parsed.description,
                                agentId,
                                source: 'installed',
                                instructions: parsed.instructions,
                                version: 1,
                                versionHistory: [],
                                config: {
                                    strategy: 'reactive',
                                    temperature: 0.7,
                                    maxIterations: 5,
                                    promptTemplateId: 'default',
                                    systemPromptTokens: 0,
                                    compressionEnabled: false,
                                },
                                evolutionMode: 'locked',
                                confidence: 'trusted',
                                successRate: 0,
                                useCount: 0,
                                refinementCount: 0,
                                taskCategories: [],
                                modelAffinities: [],
                                base: parsed.instructions,
                                avgPostActivationEntropyDelta: 0,
                                avgConvergenceIteration: 0,
                                convergenceSpeedTrend: [],
                                conflictsWith: [],
                                lastActivatedAt: null,
                                lastRefinedAt: null,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                                contentVariants: {
                                    full: parsed.instructions,
                                    summary: null,
                                    condensed: null,
                                },
                            })
                        }),
                    ),
                )
            })
        },

        /**
         * Manually trigger a skill refinement pass (moved verbatim from
         * `ReactiveAgent.refineSkills`).
         *
         * Effect-typed: `E = never` — mirrors the pre-bridge outer
         * `try/catch` that swallowed typed failures AND defects into the
         * `{ refined: 0 }` fallback; `SkillDistillerService` absent still
         * yields `{ refined: 0 }`.
         */
        refineSkills(): Effect.Effect<
            { refined: number },
            never,
            typeof SkillDistillerService
        > {
            const agentId = deps.agentId
            return Effect.gen(function* () {
                const distiller = yield* Effect.serviceOption(
                    SkillDistillerService,
                )
                if (distiller._tag !== 'Some') return { refined: 0 }
                return yield* distiller.value.distill(agentId)
            }).pipe(
                // Pre-bridge `catch { return { refined: 0 } }` around the
                // awaited inner runPromise caught rejections from BOTH
                // channels.
                Effect.catchAll(() => Effect.succeed({ refined: 0 })),
                Effect.catchAllDefect(() => Effect.succeed({ refined: 0 })),
            )
        },
    }
    return facade
}
