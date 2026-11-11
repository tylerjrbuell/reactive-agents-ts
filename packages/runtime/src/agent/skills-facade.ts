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

import { Context, Effect, Option } from 'effect'
import { ManagedRuntime } from 'effect'
import type { SkillEvolutionMode, SkillRecord } from '@reactive-agents/core'
import { MemoryNotFoundError, SkillStoreService, type DatabaseError } from '@reactive-agents/memory'
import { publishSkillEvent } from '../engine/finalize/skill-outcomes.js'
import { MemoryNotEnabledError } from './memory-facade.js'
import { installSkill, type LoadSkillOptions } from './skill-install.js'
import {
    SkillDistillerService,
    makeSkillDistillerService,
} from '@reactive-agents/reactive-intelligence'
import {
    NO_SKILL_REFINEMENT,
    buildSkillDistillerDeps,
    toSkillRefinementResult,
    type SkillRefinementResult,
} from './skill-refine.js'

/** Explicit dependency surface — exactly the `ReactiveAgent` fields the moved methods read. */
export interface SkillsFacadeDeps {
    readonly agentId: string
    /**
     * The agent's ManagedRuntime. Since Task 6 (D1 bridge) the facade
     * methods return Effects and the class shell runs them; this field is
     * still read directly by `loadSkill`'s store-write section, whose inner
     * `runPromise` is preserved for rejection-VALUE identity (see its JSDoc).
     * That section's gen composes only `Effect.serviceOption` (requirement-
     * free on effect@3.19) plus a service-instance call (`store`, typed
     * `R = never`), so the precise runtime view here is `never`.
     */
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>
}

/** Versions a manual `rollbackSkill` moved between. */
export interface SkillRollbackResult {
    readonly fromVersion: number
    readonly toVersion: number
}

/** Errors `rollbackSkill` / `setSkillMode` reject with (tagged, raw through the bridge). */
export type SkillControlError = MemoryNotEnabledError | MemoryNotFoundError | DatabaseError

type SkillStore = Context.Tag.Service<typeof SkillStoreService>

/** The SkillStore, or `MemoryNotEnabledError` when the agent has none. */
const skillStore: Effect.Effect<SkillStore, MemoryNotEnabledError> = Effect.serviceOption(SkillStoreService).pipe(
    Effect.flatMap(
        Option.match({
            onNone: () =>
                Effect.fail(
                    new MemoryNotEnabledError({
                        message: 'skill control needs a SkillStore: build the agent with .withMemory() (skillPersistence on)',
                    }),
                ),
            onSome: Effect.succeed,
        }),
    ),
)

/** A skill by name, or `MemoryNotFoundError`. */
const skillByName = (
    store: SkillStore,
    agentId: string,
    name: string,
): Effect.Effect<SkillRecord, MemoryNotFoundError | DatabaseError> =>
    store.getByName(agentId, name).pipe(
        Effect.flatMap((skill) =>
            skill === null
                ? Effect.fail(new MemoryNotFoundError({ memoryId: name, message: `Skill "${name}" not found` }))
                : Effect.succeed(skill),
        ),
    )

/**
 * Build the skills facade object — the public skills primitives,
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
            SkillStoreService
        > {
            const agentId = deps.agentId
            return Effect.gen(function* () {
                const store = yield* Effect.serviceOption(SkillStoreService)
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
        ): Effect.Effect<string, Error, SkillStoreService> {
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
         *
         * Reloading a skill the agent already stores keeps its version
         * history, stats and confidence; changed instructions become a new
         * version. `options.evolutionMode` sets the mode (default: keep the
         * stored mode, `'locked'` for a new skill).
         */
        loadSkill(skillPath: string, options: LoadSkillOptions = {}): Effect.Effect<void, Error> {
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

                // Record build + version bookkeeping: agent/skill-install.ts.
                yield* Effect.promise(() =>
                    deps.runtime.runPromise(
                        installSkill(parsed, deps.agentId, options),
                    ),
                )
            })
        },

        /**
         * Restore a stored skill's previous version and publish
         * `SkillRolledBack` with `reason: 'manual'` (no `taskId`: no run
         * triggered it). Resolves the versions moved between.
         *
         * Rejects with `MemoryNotEnabledError` without a SkillStore, and with
         * `MemoryNotFoundError` for an unknown name or a skill with no
         * previous version.
         */
        rollbackSkill(name: string): Effect.Effect<SkillRollbackResult, SkillControlError> {
            return Effect.gen(function* () {
                const store = yield* skillStore
                const current = yield* skillByName(store, deps.agentId, name)
                yield* store.rollback(current.id)
                const restored = yield* store.get(current.id)
                const result: SkillRollbackResult = {
                    fromVersion: current.version,
                    toVersion: restored?.version ?? current.version - 1,
                }
                yield* publishSkillEvent({ _tag: 'SkillRolledBack', skillName: name, ...result, reason: 'manual' })
                return result
            })
        },

        /**
         * Set how a stored skill may evolve: `'locked'` stops refinement,
         * promotion and regression rollback; `'auto'` lets run outcomes drive
         * them; `'suggest'` proposes refinements without applying them. An
         * in-place update: version history is untouched.
         *
         * Rejects with `MemoryNotEnabledError` without a SkillStore, and with
         * `MemoryNotFoundError` for an unknown name.
         */
        setSkillMode(name: string, mode: SkillEvolutionMode): Effect.Effect<void, SkillControlError> {
            return Effect.gen(function* () {
                const store = yield* skillStore
                const current = yield* skillByName(store, deps.agentId, name)
                yield* store.update(current.id, { evolutionMode: mode })
            })
        },

        /**
         * Run one skill refinement pass and report per-skill outcomes.
         *
         * Distiller source: a `SkillDistillerService` the runtime already
         * provides wins; otherwise one is built from the agent's own
         * SkillStore, episodic memory and LLM (`agent/skill-refine.ts`),
         * which publishes `SkillRefined` per refined skill. Neither present
         * (memory off or `skillPersistence: false`): zero counts.
         *
         * Effect-typed: `E = never` — a pass that cannot run at all (typed
         * failure or defect) yields zero counts, as before the bridge.
         * Per-skill failures are counted in `failed` by the distiller.
         */
        refineSkills(): Effect.Effect<SkillRefinementResult, never> {
            const agentId = deps.agentId
            return Effect.gen(function* () {
                const provided = yield* Effect.serviceOption(
                    SkillDistillerService,
                )
                if (provided._tag === 'Some')
                    return toSkillRefinementResult(
                        yield* provided.value.distill(agentId),
                    )
                const distillerDeps = yield* buildSkillDistillerDeps()
                if (distillerDeps === null) return NO_SKILL_REFINEMENT
                const distiller = yield* SkillDistillerService.pipe(
                    Effect.provide(makeSkillDistillerService(distillerDeps)),
                )
                return toSkillRefinementResult(yield* distiller.distill(agentId))
            }).pipe(
                Effect.catchAll(() => Effect.succeed(NO_SKILL_REFINEMENT)),
                Effect.catchAllDefect(() => Effect.succeed(NO_SKILL_REFINEMENT)),
            )
        },
    }
    return facade
}
