/**
 * Judgment facade — `agent.judge()`, `agent.listJudgmentModels()`, and
 * `agent.judgeRank()` moved out of `reactive-agent.ts` (#217 / HS-247).
 *
 * The class methods on `ReactiveAgent` are thin delegates that construct the
 * {@link JudgmentFacadeDeps} object per call (so mutable class state like
 * `_lastReasoningSteps` is always read live) and forward here. No logic
 * changed — bodies were moved verbatim.
 */

import { Effect } from 'effect'
import { ManagedRuntime } from 'effect'
import { EventBus } from '@reactive-agents/core'
import { emitErrorSwallowed, errorTag } from '@reactive-agents/core'
import { JudgmentService } from '@reactive-agents/judgment'
import type {
    JudgmentAnswers,
    JudgmentEntry,
    JudgmentModel,
    QuestionSpecs,
} from '@reactive-agents/judgment'
import {
    judgeRank,
    type JudgeRankCandidate,
    type JudgeRankOptions,
    type JudgeRankQuestion,
    type JudgeRankResult,
} from '../judgment-rank.js'
import { buildAutoContext, mergeJudgmentState, type JudgeContextConfig } from '../judgment-context.js'
import type { ReasoningStep } from '@reactive-agents/reasoning'
import type { ChatMessage } from '../chat.js'

/**
 * `agent.judge()`'s options — a discriminated union on `includeContext` so
 * `state` is only optional when `includeContext` supplies it automatically
 * (fix round, final review #4). Before this, `state` was unconditionally
 * optional: `agent.judge({questions})` (no `state`, no `includeContext`)
 * typechecked but passed `undefined` through to `JudgmentService.ask()`,
 * which requires a real `JudgmentEntry` (itself `string | object | array |
 * null` — `null` is a legitimate explicit value, `undefined` never is) and
 * eventually reaches `JSON.stringify(entry)` in `@reactive-agents/judgment`'s
 * `llm-backend.ts`.
 *
 * You must pass one of `state` or `includeContext` (or both — a manual
 * `state` always wins on key collision with the auto-folded context, see
 * `mergeJudgmentState`). `agent.judge({questions})` alone is a compile error
 * — this is intentional, not a bug — and because the union's second member
 * is keyed on `includeContext`, TS reports that error as "`includeContext`
 * is missing" even when the fix you want is to add `state` instead. Read
 * that error as "supply state or includeContext", not "includeContext is
 * mandatory".
 */
export type JudgeInput<Q extends QuestionSpecs> = (
    | { readonly state: JudgmentEntry; readonly includeContext?: false }
    | { readonly includeContext: true | JudgeContextConfig; readonly state?: JudgmentEntry }
) & {
    readonly questions: Q
    readonly model?: string
    readonly images?: readonly string[]
}

/**
 * Explicit dependency surface for the judgment facade — exactly the
 * `ReactiveAgent` fields the moved methods read.
 */
export interface JudgmentFacadeDeps {
    readonly agentId: string
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>
    readonly judgmentAutoShadow: boolean
    /** _chatHistory is passed by reference; the facade reads it at call time. */
    readonly chatHistory: ChatMessage[]
    /** _lastReasoningSteps snapshot taken by the delegate at call time. */
    readonly lastReasoningSteps: readonly ReasoningStep[]
}

/**
 * Build the judgment facade object — the three public judge primitives,
 * moved verbatim from `reactive-agent.ts` internals.
 */
export const makeJudgmentFacade = (deps: JudgmentFacadeDeps) => ({
    /**
     * Ask a calibrated typed judgment question (Choice/Score/Noul, with
     * probabilities) via the `JudgmentService` configured by
     * `.withJudgment()`.
     *
     * This is the public composable judgment primitive — the same
     * `JudgmentService.ask()` internal harness sites will opt into per-site
     * (`.withJudgment({ sites: {...} })`), exposed directly for user code
     * to compose calibrated decisions without going through a run.
     *
     * @param input - `state` (the JSON-compatible context to judge, optional
     *   when `includeContext` supplies it automatically), `questions` (named
     *   Choice/Score/Noul specs, answered in one batch), and the optional
     *   `includeContext` auto-context option (Phase D). `includeContext`
     *   accepts either `true` (every context layer on - recent chat
     *   history, recent tool observations, and the full last-run
     *   reasoning-step trace - each with its own default) or a
     *   `JudgeContextConfig` object (`{ messages?, toolResults?,
     *   reasoningSteps? }`) to opt into only the named layers, each itself
     *   `boolean | { window?, ... }` for per-layer tuning. A layer absent
     *   from the object form is OFF, unlike bare `true` where every layer
     *   defaults on. `images` is an optional array of base64-encoded image
     *   strings (PNG, JPEG, or WebP) supplied in caller order and forwarded
     *   verbatim to the judgment backend. Use a vision-capable decision model
     *   such as `clef` or `clef-flash`; the runtime does not fetch URLs or
     *   data URLs. Text-only backends reject non-empty images with
     *   `JudgmentUnsupported` at the service guard.
     * @throws Error if `.withJudgment()` was not called during build —
     *   `JudgmentService` is genuinely absent from the runtime's Layer
     *   graph in that case, not silently stubbed.
     *
     * @example
     * ```typescript
     * const { risky } = await agent.judge({
     *   state: { action: "delete all files in /tmp" },
     *   questions: {
     *     risky: { type: "noul", instructions: "Is this action destructive?" },
     *   },
     * });
     * if (risky.probability > 0.7) { ... }
     * ```
     *
     * @example Auto-context (Phase D) — fold recent history + tool
     * observations into `state` instead of hand-assembling it:
     * ```typescript
     * // Before: hand-assembled state
     * const { onTrack } = await agent.judge({
     *   state: { history: agent.chatHistory, lastToolResult: someObservation },
     *   questions: { onTrack: { type: "noul", instructions: "Is progress on track?" } },
     * });
     *
     * // After: includeContext does it for you
     * const { onTrack } = await agent.judge({
     *   questions: { onTrack: { type: "noul", instructions: "Is progress on track?" } },
     *   includeContext: true,
     * });
     *
     * // Or opt into just the reasoning trace, nothing else:
     * const { onTrack } = await agent.judge({
     *   questions: { onTrack: { type: "noul", instructions: "Is progress on track?" } },
     *   includeContext: { reasoningSteps: true },
     * });
     * ```
     * Precedence: an explicit `state` field always wins on key collision —
     * `includeContext` only fills gaps a manual `state` doesn't cover.
     *
     * `state` is only optional when `includeContext` is truthy (`true` or a
     * `JudgeContextConfig` object) — `judge()` has no honest value to send
     * the backend otherwise, so omitting BOTH `state` and `includeContext`
     * is a compile-time type error, not a silent `undefined` reaching
     * `JudgmentService.ask()` (fix round, final review #4). `state: null`
     * remains valid (a real `JudgmentEntry` value) — this only closes the
     * gap where `state` was missing entirely.
     *
     * Moved verbatim (body + this JSDoc) from `ReactiveAgent.judge` for #217;
     * the class method on `ReactiveAgent` is now a one-line delegate.
     */
    async judge<Q extends QuestionSpecs>(input: JudgeInput<Q>): Promise<JudgmentAnswers<Q>> {
        const { questions, model, images } = input
        let mergedState: JudgmentEntry
        let contextMerged: boolean
        if (input.includeContext) {
            contextMerged = true
            mergedState = mergeJudgmentState(
                input.state,
                buildAutoContext(
                    {
                        chatHistory: deps.chatHistory,
                        reasoningSteps: deps.lastReasoningSteps,
                    },
                    input.includeContext
                )
            ) as JudgmentEntry
        } else {
            contextMerged = false
            mergedState = input.state
        }
        const agentId = deps.agentId
        const autoShadowed = deps.judgmentAutoShadow
        return deps.runtime.runPromise(
            Effect.gen(function* () {
                if (autoShadowed) {
                    return yield* Effect.fail(
                        new Error(
                            'agent.judge() requires .withJudgment() to be called during build() — this agent only carries auto-shadow sampling, not an explicit judge backend.'
                        )
                    )
                }
                const judgmentOpt = yield* Effect.serviceOption(JudgmentService)
                if (judgmentOpt._tag !== 'Some') {
                    return yield* Effect.fail(
                        new Error(
                            'agent.judge() requires .withJudgment() to be called during build() — JudgmentService is not configured on this agent.'
                        )
                    )
                }
                // Phase D: surface which judge() calls used includeContext auto-merge
                // via the framework's own "Custom" event variant — the JudgmentService's
                // JudgmentEvaluated/JudgmentFailed events live in @reactive-agents/judgment,
                // outside this task's packages/runtime/** authority, so this rides the
                // existing extension-event channel rather than that package's schema.
                if (contextMerged) {
                    yield* EventBus.pipe(
                        Effect.flatMap((eb) =>
                            eb.publish({
                                _tag: 'Custom' as const,
                                type: 'judgment:context-merged',
                                payload: { agentId, contextMerged },
                            } as import('@reactive-agents/core').AgentEvent)
                        ),
                        Effect.catchAll((err) =>
                            emitErrorSwallowed({ site: 'runtime/src/reactive-agent.ts:judge', tag: errorTag(err) })
                        )
                    ) as Effect.Effect<void>
                }
                const askInput: { state: JudgmentEntry; questions: Q; model?: string; images?: readonly string[] } = { state: mergedState, questions, model }
                if (images !== undefined && images.length > 0) {
                    askInput.images = images
                }
                return yield* judgmentOpt.value.ask(askInput)
            })
        )
    },

    /**
     * List the models/aliases available to `judge()` on this agent's JudgmentService backend.
     *
     * Delegates to the wired `JudgmentService.listModels()` — surfaces the catalog
     * for backends like `jev` that maintain one. Backends without a catalog (e.g. `llm`)
     * reject with a `JudgmentUnsupported` failure.
     *
     * @returns Promise resolving to an array of available judgment models
     * @throws Error if `.withJudgment()` was not called during build
     * @throws Rejects (does NOT throw a bare `JudgmentUnsupported` you can
     *   `instanceof`-check) when the backend has no model catalog. This
     *   Promise is backed by `ManagedRuntime.runPromise()`, which rejects
     *   with a `FiberFailure` wrapper around the underlying tagged error, not
     *   the tagged error itself — `error instanceof JudgmentUnsupported` is
     *   `false` on the real rejection. The rejection's `message` names the
     *   missing catalog (e.g. `Backend "llm" has no model catalog`); match on
     *   that if you need to distinguish this case from other failures.
     *
     * @example
     * ```typescript
     * const agent = ReactiveAgents.create()
     *   .withProvider("anthropic")
     *   .withJudgment({ backend: "jev" })
     *   .build();
     *
     * const models = await agent.listJudgmentModels();
     * models.forEach(m => console.log(`${m.name}: ${m.description}`));
     * ```
     *
     * Moved verbatim (body + this JSDoc) from `ReactiveAgent.listJudgmentModels`
     * for #217; the class method on `ReactiveAgent` is now a one-line delegate.
     */
    async listJudgmentModels(): Promise<ReadonlyArray<JudgmentModel>> {
        const autoShadowed = deps.judgmentAutoShadow
        return deps.runtime.runPromise(
            Effect.gen(function* () {
                if (autoShadowed) {
                    return yield* Effect.fail(
                        new Error(
                            'agent.listJudgmentModels() requires .withJudgment() to be called during build() — JudgmentService is not configured on this agent.'
                        )
                    )
                }
                const judgmentOpt = yield* Effect.serviceOption(JudgmentService)
                if (judgmentOpt._tag !== 'Some') {
                    return yield* Effect.fail(
                        new Error(
                            'agent.listJudgmentModels() requires .withJudgment() to be called during build() — JudgmentService is not configured on this agent.'
                        )
                    )
                }
                return yield* judgmentOpt.value.listModels()
            })
        )
    },

    /**
     * Score-rank candidates against one question via the `JudgmentService`
     * configured by `.withJudgment()` — the batched primitive behind the
     * judgment cookbook's re-ranking recipe.
     *
     * Batches every candidate into a single `ask()` call when they fit the
     * effective cap (`opts.chunkCap` clamped to the backend's advertised
     * `maxQuestions`, defaulting to `DEFAULT_JUDGE_RANK_CHUNK_CAP` in
     * `judgment-rank.ts`), chunking into multiple `ask()` calls otherwise —
     * real leverage over hand-rolling `Promise.all(candidates.map(c =>
     * agent.judge(...)))`, which fires one round trip PER candidate
     * regardless of count.
     *
     * @param candidates - Candidates to rank, each with a caller-chosen `id`
     *   (returned unchanged in the result) and a `state` judged against `question`.
     * @param question - The single Score question every candidate is judged
     *   against: `instructions` plus an ordered `criteria` rubric.
     * @param opts - Optional `chunkCap` (candidates per `ask()` call) and `model`.
     * @returns Candidates sorted best-first (highest score first); ties keep
     *   the candidates' original relative order (stable sort). **May be
     *   SHORTER than `candidates`** — a candidate the backend answers with
     *   something other than a Score answer (non-conforming custom backend)
     *   is silently dropped rather than surfaced as a partial-failure
     *   marker; diff the returned ids against `candidates` if you need to
     *   detect drops.
     * @throws Error if `.withJudgment()` was not called during build —
     *   `JudgmentService` is genuinely absent from the runtime's Layer
     *   graph in that case, not silently stubbed.
     *
     * @example
     * ```typescript
     * const ranked = await agent.judgeRank(
     *   drafts.map((text, i) => ({ id: String(i), state: { text } })),
     *   {
     *     instructions: "How well does this draft answer the user's question?",
     *     criteria: ["poor", "weak", "adequate", "strong", "excellent"],
     *   }
     * );
     * const best = drafts[Number(ranked[0].id)];
     * ```
     *
     * Moved verbatim (body + this JSDoc) from `ReactiveAgent.judgeRank` for #217;
     * the class method on `ReactiveAgent` is now a one-line delegate.
     */
    async judgeRank(
        candidates: readonly JudgeRankCandidate[],
        question: JudgeRankQuestion,
        opts: JudgeRankOptions = {}
    ): Promise<ReadonlyArray<JudgeRankResult>> {
        const autoShadowed = deps.judgmentAutoShadow
        return deps.runtime.runPromise(
            Effect.gen(function* () {
                if (autoShadowed) {
                    return yield* Effect.fail(
                        new Error(
                            'agent.judgeRank() requires .withJudgment() to be called during build() — JudgmentService is not configured on this agent.'
                        )
                    )
                }
                const judgmentOpt = yield* Effect.serviceOption(JudgmentService)
                if (judgmentOpt._tag !== 'Some') {
                    return yield* Effect.fail(
                        new Error(
                            'agent.judgeRank() requires .withJudgment() to be called during build() — JudgmentService is not configured on this agent.'
                        )
                    )
                }
                return yield* judgeRank(judgmentOpt.value, candidates, question, opts)
            })
        )
    },
})
