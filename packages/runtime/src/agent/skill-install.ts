/**
 * `agent.loadSkill()` store write: install a parsed SKILL.md into the agent's
 * SkillStore, or reload it over a same-name skill without losing that skill's
 * state.
 *
 * A first load stores a fresh `installed` record (version 1, `trusted`). A
 * reload keeps the existing record's id, stats, confidence, source and
 * version history. Changed instructions become a new version (the prior
 * version is snapshotted first, so `agent.rollbackSkill()` can restore it);
 * unchanged instructions leave the version alone.
 *
 * Evolution mode: the caller's option wins, else the existing skill's mode,
 * else `locked` (installed skills do not evolve unless asked to).
 */
import { Effect } from 'effect'
import type { SkillEvolutionMode, SkillRecord } from '@reactive-agents/core'
import { SkillStoreService, type DatabaseError } from '@reactive-agents/memory'

/** Options for `agent.loadSkill()`. */
export interface LoadSkillOptions {
    /**
     * How the loaded skill may evolve. Default: a reloaded skill keeps its
     * current mode; a new one is `'locked'`. Pass `'auto'` to let run outcomes
     * refine, promote and roll it back.
     */
    readonly evolutionMode?: SkillEvolutionMode
}

/** The SKILL.md fields the install reads. */
export interface ParsedSkillFile {
    readonly name: string
    readonly description: string
    readonly instructions: string
}

const freshRecord = (
    parsed: ParsedSkillFile,
    agentId: string,
    evolutionMode: SkillEvolutionMode,
    now: Date,
): SkillRecord => ({
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
    evolutionMode,
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
    createdAt: now,
    updatedAt: now,
    contentVariants: { full: parsed.instructions, summary: null, condensed: null },
})

/**
 * The record a load writes. Pure. `existing` is the agent's current skill of
 * the same name, if any.
 */
export const installedSkillRecord = (
    parsed: ParsedSkillFile,
    agentId: string,
    existing: SkillRecord | null,
    options: LoadSkillOptions,
    now: Date,
): SkillRecord => {
    const evolutionMode = options.evolutionMode ?? existing?.evolutionMode ?? 'locked'
    if (existing === null) return freshRecord(parsed, agentId, evolutionMode, now)
    const changed = existing.instructions !== parsed.instructions
    return {
        ...existing,
        description: parsed.description,
        evolutionMode,
        updatedAt: now,
        ...(changed
            ? {
                  instructions: parsed.instructions,
                  version: existing.version + 1,
                  contentVariants: { full: parsed.instructions, summary: null, condensed: null },
              }
            : {}),
    }
}

/**
 * Write a parsed SKILL.md to the SkillStore. No-op without a SkillStore
 * (memory off or `skillPersistence: false`).
 */
export const installSkill = (
    parsed: ParsedSkillFile,
    agentId: string,
    options: LoadSkillOptions,
): Effect.Effect<void, DatabaseError> =>
    Effect.gen(function* () {
        const storeOpt = yield* Effect.serviceOption(SkillStoreService)
        if (storeOpt._tag !== 'Some') return
        const store = storeOpt.value
        const existing = yield* store.getByName(agentId, parsed.name)
        const now = new Date()
        const next = installedSkillRecord(parsed, agentId, existing, options, now)
        if (existing !== null && next.version !== existing.version) {
            // Snapshot the outgoing version (skipped when history already
            // holds it), then record the reloaded content as the new one.
            if (!existing.versionHistory.some((v) => v.version === existing.version)) {
                yield* store.addVersion(existing.id, {
                    version: existing.version,
                    instructions: existing.instructions,
                    config: existing.config,
                    refinedAt: existing.lastRefinedAt ?? existing.createdAt,
                    successRateAtRefinement: existing.successRate,
                    status: 'active',
                })
            }
            yield* store.addVersion(existing.id, {
                version: next.version,
                instructions: next.instructions,
                config: next.config,
                refinedAt: now,
                successRateAtRefinement: existing.successRate,
                status: 'active',
            })
        }
        yield* store.store(next)
    })
