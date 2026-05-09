/**
 * Reactive Intelligence hook subscription wiring.
 *
 * After the agent is built, subscribe each user-supplied RI hook
 * (`onEntropyScored`, `onControllerDecision`, `onMidRunAdjustment`,
 * `onSkillActivated`, `onSkillRefined`, `onSkillConflict`) to its
 * corresponding EventBus event so the callbacks actually fire during
 * runs.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import type { AgentEvent } from '@reactive-agents/core'

/**
 * Canonical shape of the user-supplied RI hooks bag.
 *
 * Mirrored by both the private `_riHooks` field on `ReactiveAgentBuilder`
 * and the inline overload type in `withReactiveIntelligence(...)`. The
 * `any` typings on payload positions match the public API surface; this
 * module is purely a wiring shim and does not narrow them.
 */
export interface RiHooks {
    onEntropyScored?: (score: any, iteration: number) => void
    onControllerDecision?: (
        decision: any,
        context: any
    ) => 'accept' | 'reject' | any
    onSkillActivated?: (skill: any, trigger: string) => void
    onSkillRefined?: (skill: any, previousVersion: any) => void
    onSkillConflict?: (a: any, b: any) => 'merge' | 'surface' | 'ignore'
    onMidRunAdjustment?: (
        type: string,
        before: unknown,
        after: unknown
    ) => void
}

/**
 * Minimal structural shape of the built agent we depend on. Avoids a
 * circular import on `ReactiveAgent` itself (defined in builder.ts).
 */
interface RiAgent {
    subscribe<T extends AgentEvent['_tag']>(
        tag: T,
        handler: (event: Extract<AgentEvent, { _tag: T }>) => void
    ): Promise<() => void>
}

/**
 * Subscribe each defined RI hook to its corresponding EventBus event on
 * the just-built agent. No-op for hooks that are undefined.
 *
 * Skill lifecycle events (`SkillActivated`, `SkillRefined`,
 * `SkillConflictDetected`) are defined in
 * `@reactive-agents/core/services/event-bus.ts` (W2 FIX-6, Apr 28 2026).
 */
export const wireRiHooks = async (
    agent: RiAgent,
    hooks: RiHooks
): Promise<void> => {
    if (hooks.onEntropyScored) {
        await agent.subscribe('EntropyScored', (event) =>
            hooks.onEntropyScored!(event, event.iteration)
        )
    }
    if (hooks.onControllerDecision) {
        await agent.subscribe('ReactiveDecision', (event) =>
            hooks.onControllerDecision!(event, {
                iteration: event.iteration,
                entropyBefore: event.entropyBefore,
            })
        )
    }
    if (hooks.onMidRunAdjustment) {
        await agent.subscribe('InterventionDispatched', (event) =>
            hooks.onMidRunAdjustment!(
                'intervention',
                { decisionType: event.decisionType },
                { patchKind: event.patchKind }
            )
        )
    }
    // Skill lifecycle hooks (W2 FIX-6) — events defined at
    // core/services/event-bus.ts:986-990; subscribers added here so the
    // 3 advertised hooks (onSkillActivated/onSkillRefined/onSkillConflict)
    // actually fire instead of silently storing dead callbacks.
    if (hooks.onSkillActivated) {
        await agent.subscribe('SkillActivated', (event) =>
            hooks.onSkillActivated!(
                {
                    name: event.skillName,
                    version: event.version,
                    confidence: event.confidence,
                    iteration: event.iteration,
                },
                event.trigger
            )
        )
    }
    if (hooks.onSkillRefined) {
        await agent.subscribe('SkillRefined', (event) =>
            hooks.onSkillRefined!(
                {
                    name: event.skillName,
                    version: event.newVersion,
                    taskCategory: event.taskCategory,
                },
                event.previousVersion
            )
        )
    }
    if (hooks.onSkillConflict) {
        await agent.subscribe('SkillConflictDetected', (event) =>
            hooks.onSkillConflict!(event.skillA, event.skillB)
        )
    }
}
