/**
 * Skills facade — `agent.skills()`, `agent.exportSkill()`,
 * `agent.loadSkill()`, and `agent.refineSkills()` moved out of
 * `reactive-agent.ts` (#217 / HS-247).
 *
 * The class methods on `ReactiveAgent` are thin delegates that construct the
 * {@link SkillsFacadeDeps} object per call and forward here. Bodies were
 * moved verbatim; the exported-typing of `skills()` is unchanged
 * (`import('@reactive-agents/core').SkillRecord[]`, deliberately loose —
 * see the original JSDoc history).
 */

import { Effect } from 'effect'
import { Context } from 'effect'
import { ManagedRuntime } from 'effect'

/** Explicit dependency surface — exactly the `ReactiveAgent` fields the moved methods read. */
export interface SkillsFacadeDeps {
    readonly agentId: string
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>
}

/**
 * Build the skills facade object — the four public skills primitives,
 * moved verbatim from `reactive-agent.ts` internals.
 */
export const makeSkillsFacade = (deps: SkillsFacadeDeps) => {
    const facade = {
        /**
         * List all loaded skills for this agent (moved verbatim from
         * `ReactiveAgent.skills`).
         */
        async skills(): Promise<import('@reactive-agents/core').SkillRecord[]> {
            try {
                const agentId = deps.agentId
                return await deps.runtime.runPromise(
                    Effect.gen(function* () {
                        const store = yield* Effect.serviceOption(
                            Context.GenericTag<{
                                listAll: (
                                    agentId: string
                                ) => Effect.Effect<any[], unknown>
                            }>('SkillStoreService')
                        )
                        if (store._tag !== 'Some') return []
                        return yield* store.value.listAll(agentId)
                    })
                )
            } catch {
                return []
            }
        },

        /**
         * Export a skill to SKILL.md format (moved verbatim from
         * `ReactiveAgent.exportSkill`).
         */
        async exportSkill(name: string, outputPath?: string): Promise<string> {
            const allSkills = await facade.skills()
            const skill = allSkills.find((s: any) => s.name === name)
            if (!skill) throw new Error(`Skill "${name}" not found`)

            const fs = await import('node:fs')
            const path = await import('node:path')
            const dir = outputPath ?? path.join('.', '.agents', 'skills', name)
            fs.mkdirSync(dir, { recursive: true })

            const frontmatter = [
                '---',
                `name: ${skill.name}`,
                `description: ${skill.description}`,
                `# source: ${skill.source}`,
                `# confidence: ${skill.confidence}`,
                `# version: ${skill.version}`,
                '---',
            ].join('\n')

            const content = `${frontmatter}\n\n${skill.instructions}\n`
            const filePath = path.join(dir, 'SKILL.md')
            fs.writeFileSync(filePath, content)
            return filePath
        },

        /**
         * Load a SKILL.md skill at runtime (moved verbatim from
         * `ReactiveAgent.loadSkill`).
         */
        async loadSkill(skillPath: string): Promise<void> {
            const { parseSKILLmd } = await import(
                '@reactive-agents/reactive-intelligence'
            )
            const fs = await import('node:fs')
            const path = await import('node:path')

            const skillMdPath = fs.statSync(skillPath).isDirectory()
                ? path.join(skillPath, 'SKILL.md')
                : skillPath

            const parsed = parseSKILLmd(skillMdPath)
            if (!parsed)
                throw new Error(`Failed to parse SKILL.md at ${skillMdPath}`)

            const agentId = deps.agentId
            await deps.runtime.runPromise(
                Effect.gen(function* () {
                    const store = yield* Effect.serviceOption(
                        Context.GenericTag<{
                            store: (record: any) => Effect.Effect<string, unknown>
                        }>('SkillStoreService')
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
                })
            )
        },

        /**
         * Manually trigger a skill refinement pass (moved verbatim from
         * `ReactiveAgent.refineSkills`).
         */
        async refineSkills(): Promise<{ refined: number }> {
            try {
                const agentId = deps.agentId
                return await deps.runtime.runPromise(
                    Effect.gen(function* () {
                        const distiller = yield* Effect.serviceOption(
                            Context.GenericTag<{
                                distill: (
                                    agentId: string
                                ) => Effect.Effect<{ refined: number }, unknown>
                            }>('SkillDistillerService')
                        )
                        if (distiller._tag !== 'Some') return { refined: 0 }
                        return yield* distiller.value.distill(agentId)
                    })
                )
            } catch {
                return { refined: 0 }
            }
        },
    }
    return facade
}
