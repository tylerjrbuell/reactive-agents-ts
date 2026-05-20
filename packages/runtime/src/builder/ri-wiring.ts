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

/** Extracted `EntropyScored` event payload — full struct from core. */
export type RiEntropyScore = Extract<AgentEvent, { _tag: 'EntropyScored' }>

/** Extracted `ReactiveDecision` event payload — full struct from core. */
export type RiControllerDecision = Extract<
    AgentEvent,
    { _tag: 'ReactiveDecision' }
>

/**
 * Slim context passed alongside a controller decision. Surfaces the
 * iteration index and prior entropy reading so user code can correlate
 * the decision with surrounding observability.
 */
export interface RiControllerDecisionContext {
    readonly iteration: number
    readonly entropyBefore: number
}

/**
 * Skill descriptor surfaced to lifecycle hooks. Derived from the
 * underlying `SkillActivated` / `SkillRefined` events; intentionally
 * narrower than the full event so consumers don't depend on the
 * envelope `_tag`.
 */
export interface RiSkillDescriptor {
    readonly name: string
    readonly version: number
    /** Present on activation hooks; omitted from refinement hooks. */
    readonly confidence?: string
    /** Present on activation hooks; omitted from refinement hooks. */
    readonly iteration?: number
    /** Present on refinement hooks; omitted from activation. */
    readonly taskCategory?: string
}

/** Outcome of the user-supplied controller-decision hook. */
export type RiDecisionVerdict = 'accept' | 'reject'

/** Outcome of the user-supplied skill-conflict hook. */
export type RiSkillConflictVerdict = 'merge' | 'surface' | 'ignore'

/**
 * Canonical shape of the user-supplied RI hooks bag.
 *
 * Mirrored by both the private `_riHooks` field on `ReactiveAgentBuilder`
 * and the inline overload type in `withReactiveIntelligence(...)`.
 *
 * HS-09 (2026-05-20 sweep): replaced the prior `: any` payload typings
 * with the concrete struct shapes the wiring shim passes to each hook,
 * so the public extension surface no longer lies about what consumers
 * receive.
 */
export interface RiHooks {
    onEntropyScored?: (score: RiEntropyScore, iteration: number) => void
    onControllerDecision?: (
        decision: RiControllerDecision,
        context: RiControllerDecisionContext,
    ) => RiDecisionVerdict | void
    onSkillActivated?: (skill: RiSkillDescriptor, trigger: string) => void
    onSkillRefined?: (
        skill: RiSkillDescriptor,
        previousVersion: number,
    ) => void
    onSkillConflict?: (a: string, b: string) => RiSkillConflictVerdict
    onMidRunAdjustment?: (
        type: string,
        before: unknown,
        after: unknown,
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
