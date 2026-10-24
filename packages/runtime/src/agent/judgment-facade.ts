/**
 * Judgment facade — `agent.judge()`, `agent.listJudgmentModels()`, and
 * `agent.judgeRank()` moved out of `reactive-agent.ts` (#217 / HS-247).
 *
 * The class methods on `ReactiveAgent` are thin delegates that construct the
 * {@link JudgmentFacadeDeps} object per call (so mutable class state like
 * `_lastReasoningSteps` is always read live) and forward here. No logic
 * changed — bodies were moved verbatim.
 *
 * Since Quality program Task 8 (D1 bridge, family 2 — the Task 6 template,
 * PR #274, applied to judgment) the module boundary is Effect-native: every
 * method is a SYNCHRONOUS method returning `Effect.Effect<A, E, R>` with a
 * precise error channel, and the family's only Promise boundary is the class
 * shell running the returned Effect through the shared `runFacadeEffect`
 * helper (`agent/run-facade-effect.ts`, called by the `reactive-agent.ts`
 * delegates). Rejection-VALUE identity vs. the pre-bridge async methods is
 * preserved in two classes, deliberately:
 *   • the `E` channel carries ONLY the deliberate "requires .withJudgment()"
 *     rejections the pre-bridge code failed on purpose — same messages, same
 *     construction sites (count-neutral; no tagged-error algebra migration
 *     mid-bridge). The shell bridge re-raises each exact `Error` instance
 *     verbatim. Pre-bridge these rode the outer `runPromise` and reached
 *     callers as its `FiberFailure` wrapper; post-bridge callers receive the
 *     `Error` itself. Every consumer test in this repo matches these
 *     rejections on message text, which is byte-identical either way.
 *   • BACKEND failures (`ask()` rejects such as a text-only backend refusing
 *     `images`, `listModels()` `JudgmentUnsupported` "no model catalog", the
 *     `judgeRank` helper's `chunkCap`/duplicate-id guards) KEEP an INNER
 *     `deps.runtime.runPromise` boundary wrapped in `Effect.promise`:
 *     pre-bridge they reached callers as THAT call's `FiberFailure` wrapper,
 *     not the raw tagged error, so the inner boundary is preserved and its
 *     rejection folds to a defect carrying the same instance — the shell
 *     bridge re-raises that wrapper verbatim, byte-identical to the
 *     pre-bridge `await` (Task 6 `loadSkill` precedent). Tripwired by
 *     `packages/runtime/tests/seam-agent-judgment-facade.test.ts`.
 *   • `judge()`'s auto-context prologue (`buildAutoContext` /
 *     `mergeJudgmentState`) runs inside `Effect.sync`, so a throw there
 *     folds to a defect carrying the original instance and the bridge
 *     re-raises it raw — the same value the pre-bridge async method rejected
 *     with.
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
    /**
     * The agent's ManagedRuntime. Since Task 8 (D1 bridge) the facade
     * methods return Effects that the class shell runs via
     * `runFacadeEffect`; this field is still read directly by each method's
     * PRESERVED inner backend-call boundary (`ask()` / `listModels()` / the
     * `judgeRank` helper, each run through `runPromise` inside
     * `Effect.promise`) — see the file header for why that boundary is
     * load-bearing for rejection-VALUE identity. All three sites run service-
     * instance effects only (`ask`, `listModels`, `judgeRank` — each typed
     * `R = never`), so the precise runtime view here is `never`.
     */
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>
    readonly judgmentAutoShadow: boolean
    /** chatHistory is passed by reference; the facade reads it when the effect runs (immediately, within the delegate call). */
    readonly chatHistory: ChatMessage[]
    /** _lastReasoningSteps snapshot taken by the delegate at call time. */
    readonly lastReasoningSteps: readonly ReasoningStep[]
}

/**
 * Build the judgment facade object — the three public judge primitives,
 * moved from `reactive-agent.ts` internals and Effect-typed per Task 8.
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
     * @returns Effect whose success value is the answered `JudgmentAnswers`
     *   map. Its `E` channel carries ONLY the deliberate
     *   "requires .withJudgment()" rejections — `JudgmentService` is
     *   genuinely absent from the runtime's Layer graph when
     *   `.withJudgment()` was not called during build, not silently
     *   stubbed — and the class-shell bridge re-raises that exact `Error`
     *   instance (message unchanged from pre-bridge). Backend rejects (e.g.
     *   a text-only backend refusing `images` with `JudgmentUnsupported`)
     *   keep the pre-bridge behavior: they run through the preserved inner
     *   `deps.runtime.runPromise` boundary, so callers receive the same
     *   `FiberFailure` wrapper carrying the same message as before Task 8.
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
     * Task 8 (D1 bridge) converted the wrapper to a synchronous
     * Effect-returning method; the inner flow (prologue → deliberate
     * rejection arms → context-merge publish → backend `ask`) is otherwise
     * unchanged.
     */
    judge<Q extends QuestionSpecs>(
        input: JudgeInput<Q>
    ): Effect.Effect<JudgmentAnswers<Q>, Error, typeof JudgmentService | typeof EventBus> {
        return Effect.gen(function* () {
            const { questions, model, images } = input
            const mergedState = yield* Effect.sync((): JudgmentEntry => {
                if (input.includeContext) {
                    return mergeJudgmentState(
                        input.state,
                        buildAutoContext(
                            {
                                chatHistory: deps.chatHistory,
                                reasoningSteps: deps.lastReasoningSteps,
                            },
                            input.includeContext
                        )
                    ) as JudgmentEntry
                }
                return input.state
            })
            const contextMerged = Boolean(input.includeContext)
            const agentId = deps.agentId
            const autoShadowed = deps.judgmentAutoShadow
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
            // PRESERVED inner boundary (Task 8, Task 6 loadSkill precedent):
            // a failing `ask()` reached pre-bridge callers as THIS
            // runPromise call's FiberFailure wrapper, not the raw tagged
            // error. Keeping the boundary and folding its rejection through
            // Effect.promise (→ defect carrying the same instance → shell
            // bridge re-raises it verbatim) keeps that observable value
            // byte-identical.
            return yield* Effect.promise(() =>
                deps.runtime.runPromise(judgmentOpt.value.ask(askInput))
            )
        })
    },

    /**
     * List the models/aliases available to `judge()` on this agent's JudgmentService backend.
     *
     * Delegates to the wired `JudgmentService.listModels()` — surfaces the catalog
     * for backends like `jev` that maintain one. Backends without a catalog (e.g. `llm`)
     * reject with a `JudgmentUnsupported` failure.
     *
     * @returns Effect resolving to an array of available judgment models.
     * @throws Error if `.withJudgment()` was not called during build —
     *   since Task 8 (D1 bridge) this deliberate rejection rides the Effect
     *   `E` channel and the class-shell bridge (`runFacadeEffect`) re-raises
     *   the exact `Error` instance; pre-bridge it surfaced wrapped in a
     *   `FiberFailure`, with the same message either way.
     * @throws Rejects (does NOT hand back a bare `JudgmentUnsupported` for
     *   you to catch as such) when the backend has no model catalog. The
     *   backend call keeps its own inner `ManagedRuntime.runPromise()`
     *   boundary (preserved for rejection-VALUE identity, Task 8 / Task 6
     *   `loadSkill` precedent), so — exactly as pre-bridge — the rejection
     *   is a `FiberFailure` wrapper around the underlying tagged error, not
     *   the tagged error itself. The rejection's `message` names the
     *   missing catalog (e.g. `Backend "llm" has no model catalog`); match
     *   on that if you need to distinguish this case from other failures.
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
     * Task 8 (D1 bridge) converted the wrapper to a synchronous
     * Effect-returning method; the inner flow (deliberate rejection arms →
     * backend `listModels()` through the preserved inner boundary) is
     * otherwise unchanged.
     */
    listJudgmentModels(): Effect.Effect<ReadonlyArray<JudgmentModel>, Error, typeof JudgmentService> {
        return Effect.gen(function* () {
            const autoShadowed = deps.judgmentAutoShadow
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
            // PRESERVED inner boundary — see the method JSDoc and the
            // `judge()` arm above for why a backend rejection must keep
            // arriving as this runPromise call's FiberFailure wrapper.
            return yield* Effect.promise(() =>
                deps.runtime.runPromise(judgmentOpt.value.listModels())
            )
        })
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
     * @returns Effect resolving to candidates sorted best-first (highest
     *   score first); ties keep the candidates' original relative order
     *   (stable sort). **May be SHORTER than `candidates`** — a candidate the
     *   backend answers with something other than a Score answer
     *   (non-conforming custom backend) is silently dropped rather than
     *   surfaced as a partial-failure marker; diff the returned ids against
     *   `candidates` if you need to detect drops.
     * @throws Error if `.withJudgment()` was not called during build —
     *   `JudgmentService` is genuinely absent from the runtime's Layer
     *   graph in that case, not silently stubbed. Since Task 8 (D1 bridge)
     *   this deliberate rejection rides the Effect `E` channel and the
     *   class-shell bridge re-raises the exact `Error` instance (message
     *   unchanged from pre-bridge). The `judgeRank` helper's own guards
     *   (`chunkCap` not a positive finite number, duplicate candidate ids)
     *   keep the pre-bridge behavior: they run through the preserved inner
     *   `deps.runtime.runPromise` boundary, so callers receive the same
     *   `FiberFailure` wrapper carrying the same message as before Task 8.
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
     * Task 8 (D1 bridge) converted the wrapper to a synchronous
     * Effect-returning method; the inner flow (deliberate rejection arms →
     * `judgeRank` helper through the preserved inner boundary) is otherwise
     * unchanged.
     */
    judgeRank(
        candidates: readonly JudgeRankCandidate[],
        question: JudgeRankQuestion,
        opts: JudgeRankOptions = {}
    ): Effect.Effect<ReadonlyArray<JudgeRankResult>, Error, typeof JudgmentService> {
        return Effect.gen(function* () {
            const autoShadowed = deps.judgmentAutoShadow
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
            // PRESERVED inner boundary — see the `judge()` arm above for
            // why helper rejections (chunkCap/duplicate-id dies, backend
            // `ask()` failures) must keep arriving as this runPromise
            // call's FiberFailure wrapper.
            return yield* Effect.promise(() =>
                deps.runtime.runPromise(
                    judgeRank(judgmentOpt.value, candidates, question, opts)
                )
            )
        })
    },
})
