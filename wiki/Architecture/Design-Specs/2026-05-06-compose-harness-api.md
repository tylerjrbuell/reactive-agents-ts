# Compose-Harness API Design Spec

**Date:** 2026-05-06
**Status:** Draft — pending implementation
**Author:** TB + harness team
**Targets:** v0.11 (compose surface + in-process control + 5 chokepoints + killswitch library); v0.12+ (remaining chokepoints, checkpointed pause)
**Related:** [stability tiers](../../apps/docs/src/content/docs/reference/stability.md), [community-research-pivot session debrief](#) (this conversation)

---

## TL;DR

We are building **`.compose((harness) => …)`**: a single, unified, typed API surface that lets developers reach into every place the framework injects content into the LLM's context — system prompts, nudges, tool schemas, observations, lifecycle phases — and reshape, augment, suppress, or observe what flows through. The same surface exposes runtime control (`pause`/`resume`/`stop`/`terminate`) so killswitches and HITL approvals are themselves just compositions.

The design replaces the prospect of 24 separate `.withX()` override methods with **one method, five namespaces, six small primitives, infinite specificity**. Existing `.with*()` builder methods remain as ergonomic sugar that desugar through the new pipeline; nothing breaks.

Tagline: **"Don't config, compose."**

---

## 1. Motivation

### 1.1 The audit gap

A May-6 codebase audit ([transcript](#)) catalogued **24 distinct injection points** where the harness materially adds, replaces, or transforms LLM-bound content. Of these:

- **3 are fully overridable today** (system prompt via `withSystemPrompt`, tool registration, provider adapter)
- **7 are partially overridable** (strategy templates, verifier retry policy, sub-agent system prompt, lazy-tools env flag, RI evaluator registry, etc.)
- **14 are hard-coded** with zero developer surface (loop-detector text, oracle nudges, required-tools redirects, healing-failure messages, tool-result truncation/formatting, output-synthesis prompt, max-tokens recovery, handoff summaries, episodic-memory rendering, harness-skill prepend, completion gate, …)

The current homepage tagline previously claimed *"every component overridable"*. We softened that copy because a 10-minute code audit could falsify it. The Compose-Harness API closes the gap **for real** rather than via marketing language.

### 1.2 The community signal

Web research across HN, Reddit, dev.to (May 6 2026) consistently surfaced:

- **#1 LangChain complaint**: black-box debugging, abstraction tax, cannot reach the prompt that went out
- **#1 unmet desire**: hooks, escape hatches, "drop down to raw whenever I need to"
- **Repeated phrase**: *"an agent is just a loop"* — devs questioning whether frameworks earn their keep
- **Per-tool middleware** explicitly named as the gap nobody fills

A composition-first override surface is the most direct response to all of these.

### 1.3 The strategic angle

Beyond external positioning, **harness research velocity directly depends on the team's ability to swap any harness output for an experimental variant** without forking the framework. Today, A/B-testing a nudge text means editing `loop-detector.ts:102`, rebuilding, re-running. With `.compose()`, it's a 3-line test fixture. This unlocks the M3 (verifier retry), M6 (skill persistence), M7 (calibration consumers), and M8 (sub-agent metrics) Phase-1.5 follow-ups.

### 1.4 The clay-not-blocks principle

The tempting design is 24 named override methods (`.withLoopDetectorMessage()`, `.withVerifierFeedback()`, `.withHealingNudge()`, …). This is the failure mode every prior framework fell into — a growing menu of fixed slots, version churn, devs picking from a catalog. **We don't ship blocks.**

The Compose-Harness API is one surface — a continuous medium that takes any shape the user gives it. Adding a new emission tag in a future release does not change the API; existing molds keep working unmodified.

---

## 2. Design Principles

| # | Principle | Implication |
|---|---|---|
| 1 | **One surface, not 24** | Single `.compose(harness => …)` builder method covers every injection point. |
| 2 | **Tag-based pattern matching** | `harness.on('prompt.system', fn)` over `withSystemPrompt(fn)`. New emissions don't expand the API. |
| 3 | **Pass-through default** | Every transformer receives the current default; returning `undefined` means "no change", `null` means "suppress", anything else replaces. |
| 4 | **Composable** | Multiple `.compose()` calls on the same agent register in builder order; results chain. Compositions can be exported and imported as plain functions. |
| 5 | **Inspection IS API** | `harness.tap(pattern, fn)` and `harness.tags()` are first-class. The harness is self-documenting at runtime. |
| 6 | **Type-safe** | TS template-literal types make tags autocomplete-aware; `ctx` narrows by tag. |
| 7 | **Structural ≠ behavioral** | `.with*()` configures *what components exist*; `.compose()` shapes *how those components emit*. The boundary is permanent. |
| 8 | **Backward-compatible** | All existing `.with*()` overrides keep working; internally they desugar to compose pipeline calls. |
| 9 | **Killswitches are compositions** | Runtime control verbs (pause/stop/terminate/resume) are reachable from inside compose, so the same primitive that rewrites a prompt can also halt the agent. No second API. |

---

## 3. Vocabulary Lock

| Element | Name | Rationale |
|---|---|---|
| Builder verb | **`.compose(fn)`** | Locks in the framework's existing "composable" identity. *"Don't config, compose."* |
| Closure parameter | **`harness`** | Same word the hero tagline uses. Doc continuity; no metaphor translation needed. |
| Transform method | **`harness.on(pattern, fn)`** | Pattern-matched transformer; chains across multiple registrations. |
| Inject method | **`harness.emit(tag, payload)`** | Adds your own emission alongside framework defaults. |
| Observe method | **`harness.tap(pattern, fn)`** | Pure side-effect; payload flows through unchanged. |
| Lifecycle methods | **`harness.before/after/onError(phase, fn)`** | Phase-relative hooks for the 12 phases. |
| Introspection | **`harness.tags()`**, **`harness.signature(tag)`**, **`harness.peek(tag, ctx)`** | Live runtime catalog. |
| Modularity | **`harness.use(fn)`**, **`harness.namespace(prefix, fn)`** | Reuse and scoping primitives. |
| Runtime control | **`harness.pause/resume/stop/terminate(opts?)`** | Same verbs the run handle exposes externally. |

---

## 4. The Five Tag Namespaces

Every harness emission lives in one of five namespaces. Hierarchical (`prompt.system.react`); pattern-matchable (`prompt.*`); extensible (new sub-tags need no API change).

### 4.1 `prompt.*` — content sent to the model as system/instruction text

| Tag | Default source | Audit ref |
|---|---|---|
| `prompt.system` | `context-utils.ts:26-47`, `context-manager.ts` | #1 |
| `prompt.system.react` | `prompts/templates/reasoning/react-system.ts` | #2 |
| `prompt.system.reflexion` | `templates/reasoning/reflexion-system.ts` | #2 |
| `prompt.system.plan-execute` | `templates/reasoning/plan-execute-system.ts` | #2 |
| `prompt.system.tree-of-thought` | `templates/reasoning/tot-system.ts` | #2 |
| `prompt.system.local-tier` | `templates/reasoning/react-system-local.ts` | #2 |
| `prompt.synthesis` | `kernel/loop/output-synthesis.ts:buildSynthesisPrompt` | #11, #21 |
| `prompt.format-instructions` | `think.ts:411-418` (non-FC drivers) | #23 |
| `prompt.adapter-patch` | `adapter.ts:systemPromptPatch` | #16 |

### 4.2 `message.*` — `KernelMessage` objects appended to the conversation thread

| Tag | Default source | Audit ref |
|---|---|---|
| `message.user-task` | `runner.ts:517` initial seed; `context-utils.ts:144-159` adapter framing | #17 |
| `message.tool-result` | `act.ts:902-925` truncation/scratchpad/STORED markers; `tool-execution.ts:147-172` | #4 |
| `message.tool-error` | `tool-execution.ts:754-774` `[Tool error: …]` | #6 |
| `message.max-tokens-recovery` | `act.ts:634` recovery user message | #18 |
| `message.subagent-handoff` | `runtime/builder.ts:3315,3484-3569` | #15 |

### 4.3 `nudge.*` — coaching/intervention strings the harness slips into the prompt's Guidance section or as injected user/system messages

| Tag | Default source | Audit ref |
|---|---|---|
| `nudge.loop-detected` | `loop-detector.ts:102-107` | #7 |
| `nudge.required-tools-pending` | `act.ts:976-977` "You must still call: X" | #18 |
| `nudge.required-tools-redirect` | `runner.ts:1326-1328` ⚠️ "Required tools not yet used" | #19 |
| `nudge.required-tools-satisfied` | `act.ts:1000-1003` REQUIRED_TOOLS_SATISFIED_PREFIX | #11 |
| `nudge.oracle-pre-exit` | `runner.ts:1004` first-stage readyToAnswer | #20 |
| `nudge.oracle-forced-exit` | `runner.ts:1019,1030` second-stage forced exit | #20 |
| `nudge.healing-applied` | (new) emitted post-heal with original→healed call diff | #5 |
| `nudge.healing-failure` | `tool-execution.ts:200-214` getRecoveryHint | #6 |
| `nudge.reactive-observer` | `reactive-observer.ts:348-419` patches | #8 |
| `nudge.strategy-handoff` | `runner.ts:755-808` buildHandoff | #9 |
| `nudge.verifier-retry` | `verify/retry-context.ts:39-118` | #10 |
| `nudge.adapter-continuation` | `adapter.ts:continuationHint` | #16 |
| `nudge.adapter-error-recovery` | `adapter.ts:errorRecovery` | #16 |
| `nudge.skill-activation` | `think.ts:343-351` harnessContent prepend | #14 |
| `nudge.progress` | `progressCheckpoint` config | #18 |

### 4.4 `tool.*` — tool-related shape sent to or returned from the model

| Tag | Default source | Audit ref |
|---|---|---|
| `tool.schema` | `think.ts:319-340,430-451` filtered+formatted schemas | #3 |
| `tool.schema.description` | `tools/registry/*` per-tool description rendering | #3 |
| `tool.healing.alias-map` | `healing-pipeline.ts` knownToolAliases/knownParamAliases | #5 |
| `tool.gate-result` | `context-utils.ts:94-114` gate-blocked filter | #3 |

### 4.5 `observation.*` — content surfaced as `harness_signal` / `observation` steps OR injected into `priorContext`

| Tag | Default source | Audit ref |
|---|---|---|
| `observation.tool-result` | `act.ts` post-execution observation step | #4 |
| `observation.episodic-recall` | `execution-engine.ts:1555-1594` episodic memory block | #12 |
| `observation.semantic-recall` | `execution-engine.ts` semanticContext block | #12 |
| `observation.skill-catalog` | `execution-engine.ts` skillCatalogXml | #14 |
| `observation.compression-summary` | `reactive-observer.ts:357-364` + curator | #13 |
| `observation.fact-extraction` | `tool-execution.ts:786-868` deterministic+LLM fact extract | #24 |
| `observation.harness-signal` | `runner.ts:1240-1257` HarnessSignalInjected | #7, #19 |

### 4.6 `lifecycle.*` — agent-level failure and state transition events

| Tag | Default source | Payload type |
|---|---|---|
| `lifecycle.failure` | `kernel/capabilities/act/tool-execution.ts` (tool errors), `kernel/capabilities/reason/think.ts` (LLM refusals), `kernel/capabilities/verify/verifier.ts` (rejections) | `LifecycleFailurePayload` |

### 4.7 `control.*` — strategy and trajectory control decisions

| Tag | Default source | Payload type |
|---|---|---|
| `control.strategy-evaluated` | `kernel/capabilities/reflect/strategy-evaluator.ts` | `ControlStrategyEvaluatedPayload` |

### 4.8 Bonus namespace: `decision.*` — structured choice points (not text-shaped, but still composable)

| Tag | Payload | Audit ref |
|---|---|---|
| `decision.terminate` | `{ reason, source, confidence }` | (existing arbitrator) |
| `decision.strategy-switch` | `{ from, to, trigger }` | (RI evaluator) |
| `decision.cost-route` | `{ tier, model, alternatives }` | (cost router) |
| `decision.healing-stage` | `{ stage, before, after }` | (healing pipeline) |

These are **structured payloads**, not strings. `harness.on('decision.cost-route', (pick, ctx) => betterPick)` lets you replace the routing pick. Marked tier-2 priority (after string-shaped tags ship in v0.11).

### 4.9 Lifecycle hooks (not a namespace; orthogonal axis)

`harness.before/after/onError(phase, fn)` covers the 12 phases independently of emission tags. Phase enum: `bootstrap | guardrail | cost-route | strategy-select | think | act | observe | verify | memory-flush | cost-track | audit | complete`.

---

## 5. API Surface

### 5.1 The builder method

```ts
interface ReactiveAgentBuilder {
    compose(fn: (harness: Harness) => void): this
}
```

Multiple calls on the same builder register additively. Within a single `.compose()`, transforms register in source-line order. The combined registration order across all `.compose()` calls becomes the execution order at runtime.

### 5.2 The `Harness` interface

```ts
interface Harness {
    // 1. Transform — pattern-matched value reshaping
    on<P extends TagPattern>(
        pattern: P | P[],
        fn: TransformFor<P>,
    ): this

    // 2. Inject — fire your own emissions
    emit<T extends Tag>(tag: T, payload: PayloadFor<T>): void

    // 3. Observe — side-effect only, payload passes through unchanged
    tap<P extends TagPattern>(
        pattern: P | P[],
        fn: TapFor<P>,
    ): this

    // 4. Lifecycle hooks
    before<Ph extends Phase>(phase: Ph, fn: PhaseHookFn<Ph>): this
    after<Ph extends Phase>(phase: Ph, fn: PhaseHookFn<Ph>): this
    onError<Ph extends Phase | '*'>(
        phase: Ph,
        fn: ErrorHookFn<Ph>,
    ): this

    // 5. Introspection
    tags(): readonly Tag[]
    signature<T extends Tag>(tag: T): TagSignature<T>
    peek<T extends Tag>(tag: T, ctx: ContextFor<T>): PayloadFor<T>

    // 6. Modularity
    use(fn: (harness: Harness) => void): this
    namespace(prefix: string, fn: (scoped: ScopedHarness) => void): this

    // 7. Runtime control
    pause(opts?: PauseOptions): Promise<void>
    resume(opts?: ResumeOptions): void
    stop(opts?: StopOptions): void
    terminate(opts?: TerminateOptions): void
}
```

### 5.3 Transform function signature

```ts
type TransformFn<T extends Tag> = (
    defaultPayload: PayloadFor<T>,
    ctx: ContextFor<T>,
) => 
    | PayloadFor<T>      // explicit replacement
    | undefined           // pass-through (use defaultPayload as-is)
    | null                // suppress (drop the emission entirely)
    | Promise<PayloadFor<T> | undefined | null>
```

### 5.4 Pattern grammar

| Pattern | Matches |
|---|---|
| `'prompt.system'` | exact |
| `'prompt.*'` | any single sub-segment under `prompt.` |
| `'prompt.**'` | any depth under `prompt.` (multi-segment) |
| `'**'` | every emission |
| `['prompt.*', 'message.*']` | union of patterns |
| `(tag) => boolean` | predicate (power-user escape hatch) |

Match precedence at runtime: most-specific first → broader → wildcard. Within the same specificity tier, registration order. (See §6 for the resolution algorithm.)

### 5.5 Context type

`ContextFor<T>` is per-tag. Contains:

- `iteration: number` — current loop iteration
- `phase: Phase` — current 12-phase position
- `state: ReadonlyKernelState` — frozen snapshot
- `provider: ProviderInfo` — modelId, tier, capabilities
- `strategy: StrategyName` — currently active reasoning strategy
- `tenantId?: string` — if `withTenant()` was used (Phase 2)
- `meta: Record<string, unknown>` — escape hatch for tag-specific extras

For `prompt.system`: also `{ section: 'tier-defaults' | 'guidance' | 'memory' | 'skill' }` indicating which curator segment is being assembled.
For `observation.tool-result`: also `{ toolName, callId, healed: boolean, durationMs }`.
For `nudge.*`: also `{ trigger: string, severity: 'info' | 'warn' | 'critical' }`.

### 5.6 Lifecycle hook signatures

```ts
type PhaseHookFn<P extends Phase> = (ctx: PhaseContext<P>) => 
    | void
    | Promise<void>
    | { skip: true }     // skip this phase
    | { abort: 'stop' | 'terminate', reason?: string }
```

`onError(phase, fn)` receives `(error, ctx)` and may return `{ recover: NewState }` to attempt recovery, or `void` to let the error propagate.

---

## 6. Runtime Mechanics

### 6.0 Implementation foothold: `pendingGuidance` already exists

The audit identified **`KernelState.pendingGuidance`** (defined in `kernel-state.ts`, populated in `act.ts`/`runner.ts`/`reactive-observer.ts`, consumed in `think.ts:362-374`) as the existing typed-enum-of-injection-slots that the compose pipeline can generalize. Its 8 fields (`errorRecovery`, `actReminder`, `icsGuidance`, `oracleGuidance`, `evidenceGap`, `qualityGateHint`, `requiredToolsPending`, `loopDetected`) map cleanly to `nudge.*` tags. The `ProviderAdapter` interface (with its 7+7 named hooks returning `string | undefined`) is the cleanest precedent for the public hook shape.

The compose pipeline replaces inline string literals at the kernel chokepoints with `pipeline.transform(tag, default, ctx)` calls. The `pendingGuidance` accumulator continues to exist as the internal data structure the kernel reads from; it just gets *populated* via the pipeline rather than via direct assignment. **This is a refactor, not a rewrite** — the kernel's existing data flow stays intact.

### 6.1 Registry construction

When `.compose(fn)` is called on the builder, `fn` is invoked with a temporary `RegistrationHarness` that just collects entries:

```ts
type Registration =
    | { kind: 'transform'; pattern: TagPattern; fn: TransformFn }
    | { kind: 'tap'; pattern: TagPattern; fn: TapFn }
    | { kind: 'before' | 'after' | 'onError'; phase: Phase; fn: any }
    | { kind: 'inject'; tag: Tag; payload: any }       // immediate emit
    | { kind: 'use'; sub: Registration[] }              // imported composition
```

These accumulate on the builder. At `.build()`, they're flattened into a `HarnessPipeline` instance attached to the agent.

### 6.2 Resolution at emission time

Each chokepoint in the kernel calls:

```ts
const result = await pipeline.transform(tag, defaultValue, ctx)
```

`transform()` walks the pipeline:

1. Build the matching transformers list (most-specific → broadest, registration order within tier).
2. Iterate, threading `current` value through each:
   - `undefined` from a transformer → keep `current` unchanged
   - `null` → set a "suppressed" flag; subsequent transformers see `null` as `defaultValue` (so they can re-introduce content if they want) but the final emission will be dropped if still `null`
   - any other value → `current = newValue`, continue
3. Return `current` (or null marker if suppressed).
4. Tap subscribers fire after the final value is computed.

### 6.3 Inject semantics

`harness.emit(tag, payload)` from inside a transform queues an emission; it fires at the natural emission point of that tag's chokepoint (next phase boundary that consumes the tag). Cannot create infinite loops because injected emissions still flow through transforms but skip the registration that injected them (cycle detection by `Symbol('injected-by')`).

### 6.4 Lifecycle hook order

Per phase:

1. All `before` hooks fire in registration order
2. Phase body executes
3. All `after` hooks fire in registration order
4. On exception: all `onError` hooks fire (registered for that phase + `'*'` wildcard)

A `before` hook returning `{ skip: true }` short-circuits the phase body. A hook returning `{ abort: 'stop' }` triggers the same path as `harness.stop()`.

### 6.5 Performance budget

Pipeline overhead must be:

- **< 50µs per emission** for unmodified pass-through (no transforms registered for the tag)
- **< 200µs per emission** for the average case (1–3 transforms registered)
- Zero per-tag heap allocation in the pass-through case (use frozen empty arrays as sentinels)

Benchmark: a 20-iteration agent run today emits ~80 chokepoint values; pipeline must not add more than 4ms total wall-clock. Validated via `packages/reasoning/test/perf-compose-pipeline.bench.ts`.

---

## 7. Runtime Control Verbs

### 7.1 The four verbs

| Verb | Semantics | Final answer? | Disposers fire? |
|---|---|---|---|
| `pause` | Freeze at next phase boundary; await resume | Pending | No |
| `resume` | Continue from paused state (optionally with mutated state) | Continues normally | — |
| `stop` | Graceful: set `state.status = 'done'`, run synthesis, return best-effort | Yes (partial OK) | Yes (post-synthesis) |
| `terminate` | Hard: `Fiber.interrupt`, throw `AgentTerminated`, dispose | No | Yes (immediate) |

### 7.2 Two locations

```ts
// Outside (caller code)
const run = agent.runStream(task)        // returns RunHandle (extends AsyncIterable)
run.pause()
run.resume({ withStateChange: (s) => mutate(s) })
run.stop({ reason: 'user-said-enough' })
run.terminate({ reason: 'budget-fatal' })
run.status()    // 'running' | 'paused' | 'stopped' | 'terminated' | 'completed'

// Inside (compose handler) — same verbs
.compose((harness) => {
    harness.before('act', (ctx) => {
        if (ctx.tokensSpent > BUDGET) harness.stop({ reason: 'budget-exceeded' })
    })
})
```

The inside-compose verbs are sugar that resolves to "trigger this verb on the run that owns me." Implemented via a `RunController` reference attached to `KernelState` at run entry.

### 7.3 Queue-on-stop semantics (locked)

When `harness.stop()` (or `terminate`) is called from inside a transform, the **transform's return value is honored first** (so the LLM sees the modified prompt for the current iteration), then the verb fires at the next phase boundary. Avoids the "rug-pull mid-transform" failure mode.

For `pause`, the same rule applies: the transform completes, its value goes out, then the loop pauses at the next phase boundary.

For `terminate`, this is best-effort: `Fiber.interrupt` is dispatched immediately but JS finalizers (try/finally) are still allowed to run. Disposers always fire.

### 7.4 Pause/resume implementation (v0.11 in-process scope)

```ts
class RunController {
    private pauseSignal: Deferred<void> | null = null
    private status: RunStatus = 'running'
    
    async checkpoint(): Promise<void> {
        if (this.pauseSignal) {
            this.status = 'paused'
            await this.pauseSignal.await()
            this.status = 'running'
        }
    }
    
    pause() {
        if (!this.pauseSignal) this.pauseSignal = Deferred.make()
    }
    
    resume(opts?: ResumeOptions) {
        if (opts?.withStateChange) opts.withStateChange(this.state)
        this.pauseSignal?.resolve()
        this.pauseSignal = null
    }
}
```

The runner calls `controller.checkpoint()` at every phase boundary. When paused, the fiber blocks; when resumed, it continues from the same state. State mutation during pause is allowed via the `withStateChange` callback — this is how HITL "approve with edits" works.

**v0.11 limitation**: pause/resume must occur within the same process. KernelState is not yet fully serializable (in-flight tool call promises, AbortController references). Cross-process resume is Phase 2.

### 7.5 The `RunHandle` interface

```ts
interface RunHandle<T = AgentResult> extends Promise<T>, AsyncIterable<AgentEvent> {
    pause(): void
    resume(opts?: ResumeOptions): void
    stop(opts?: StopOptions): void
    terminate(opts?: TerminateOptions): void
    status(): RunStatus
    
    // Read-only state inspection while running
    snapshot(): ReadonlyKernelState
}
```

`agent.run(task)` returns `RunHandle<AgentResult>`. `agent.runStream(task)` returns `RunHandle<AgentResult> & AsyncIterable<AgentEvent>`. The handle is awaitable (resolves to final result), iterable (yields stream events), and controllable (the four verbs).

---

## 8. The Killswitch Composition Library

Six prebuilt compositions ship with the core, importable from `reactive-agents/compose/killswitches`. Each is a plain `(harness: Harness) => void` — zero new primitives.

### 8.1 `budgetLimit`

```ts
import { budgetLimit } from 'reactive-agents/compose/killswitches'

agent.compose(budgetLimit({ 
    maxTokens: 50_000, 
    maxCostUSD: 0.50,
    onTrigger: 'stop',  // 'stop' | 'terminate' (default 'stop')
}))
```

Implementation: subscribes `harness.tap('cost.tracked', ...)`; when threshold crossed, calls `harness.stop({ reason: 'budget-exceeded' })` or `terminate`.

### 8.2 `timeoutAfter`

```ts
agent.compose(timeoutAfter({ wallClock: '60s', onTrigger: 'stop' }))
```

Implementation: registers a `setTimeout` in `harness.before('bootstrap', …)` that schedules `harness.stop()`. Cleared on normal completion via `harness.after('complete', clearTimeout)`.

### 8.3 `maxIterations`

```ts
agent.compose(maxIterations(20))
```

Implementation: `harness.before('think', (ctx) => ctx.iteration > 20 && harness.stop({ reason: 'max-iterations' }))`.

### 8.4 `requireApprovalFor`

```ts
agent.compose(requireApprovalFor({
    tools: ['send_email', 'execute_sql'],
    approver: async (toolCall) => {
        return await uiPrompt(`Approve ${toolCall.toolName}?`)
    },
}))
```

Implementation: `harness.before('act', async (ctx) => { if (sensitive(ctx.nextTool)) await harness.pause(); resumed only if approver returned true; otherwise harness.stop() })`.

### 8.5 `watchdog`

```ts
agent.compose(watchdog({ 
    noProgressFor: '30s',
    progressSignal: 'observation.tool-result',  // what counts as progress
}))
```

Implementation: tracks last-progress timestamp via `harness.tap`; on phase boundary, if timestamp older than threshold, `harness.stop()`.

### 8.6 `confidenceFloor`

```ts
agent.compose(confidenceFloor({ 
    verifier: 0.85, 
    minSteps: 3,
    earlyExit: true,
}))
```

Implementation: `harness.tap('decision.terminate', ...)`; when verifier verdict ≥ threshold and `state.steps.length >= minSteps`, allow termination via `harness.stop()` even if other heuristics would normally extend.

### 8.7 Composability

Killswitches stack:

```ts
agent
    .compose(budgetLimit({ maxCostUSD: 1.0 }))
    .compose(timeoutAfter({ wallClock: '5m' }))
    .compose(requireApprovalFor({ tools: ['send_email'] }))
    .compose(watchdog({ noProgressFor: '60s' }))
```

First trigger wins. Each killswitch records its trigger as `state.terminationSource = 'composed:budget-limit'` etc. for telemetry.

### 8.8 Killswitch registry export

For docs/discoverability:

```ts
import { killswitches } from 'reactive-agents/compose'
console.log(killswitches.list())  
// → ['budgetLimit', 'timeoutAfter', 'maxIterations', 'requireApprovalFor', 'watchdog', 'confidenceFloor']
```

### 8.9 Cookbook recipes shipping with v0.11

The community-research sweep produced nine canonical patterns. Each ships as a tested example in `apps/docs/src/content/docs/cookbook/composition-recipes.mdx` so devs hit working code on day one rather than reading abstract API.

| # | Pattern | Composition shape |
|---|---|---|
| 1 | **Compliance / PII redaction** | `harness.on('observation.tool-result', redact)` + `harness.tap('*', auditLog)` |
| 2 | **Localization** | `harness.on('nudge.*', translate)` + `harness.on('prompt.system', localize)` |
| 3 | **Multi-tenant context** | `harness.on('prompt.system', (t, ctx) => addTenantHeader(t, ctx.tenantId))` |
| 4 | **Research A/B** | `harness.on('prompt.system', () => useVariant() ? variantA : variantB)` |
| 5 | **Bare-LLM ablation** | `harness.on('nudge.*', () => null)` — disable every harness signal; pure ReAct baseline |
| 6 | **Custom termination logic** | `harness.on('decision.terminate', customPred)` + `harness.on('prompt.synthesis', customSynth)` |
| 7 | **Healing transparency** | `harness.tap('nudge.healing-applied', logHealing)` + `harness.on('observation.tool-result', annotateHealed)` |
| 8 | **Cost-aware routing** | `harness.on('decision.cost-route', costAwarePicker)` + `harness.tap('cost.*', track)` |
| 9 | **Telemetry export** | `harness.tap('*', sendToOTel)` — single line, full agent-internals visibility |

Pattern #5 doubles as the framework's own ablation test for harness-research debriefs.

---

## 9. Existing Mechanisms — How They Map

### 9.1 Sugar (desugars through compose; kept for ergonomics)

| Existing API | Desugars to |
|---|---|
| `.withSystemPrompt(s)` | `.compose(h => h.on('prompt.system', () => s))` |
| `.withCustomTermination(pred)` | `.compose(h => h.on('decision.terminate', (def, ctx) => pred(ctx) ? { ...def, terminate: true } : def))` |
| `.withErrorHandler(fn)` | `.compose(h => h.onError('*', fn))` |
| `.withProgressCheckpoint(opts)` | `.compose(h => h.on('nudge.progress', () => buildProgressMessage(opts)))` |
| `.withVerification({ signalText })` | `.compose(h => h.on('observation.verifier-retry', () => signalText))` |
| `.withSubAgents({ taskFraming })` | `.compose(h => h.on('message.subagent-handoff', taskFraming))` |
| `.withHook(phase, 'before', fn)` | `.compose(h => h.before(phase, fn))` |
| `.withHook(phase, 'after', fn)` | `.compose(h => h.after(phase, fn))` |
| `.withHook(phase, 'on-error', fn)` | `.compose(h => h.onError(phase, fn))` |

**Implementation**: each desugared method calls `this.compose(h => …)` internally. No behavioral change for existing users.

### 9.2 Equivalent (parallel surface, both kept)

`.withHook` and `harness.before/after/onError` are functionally identical. We keep both: `.withHook` for one-off hooks at the builder level; `harness.before/after/onError` for hooks that sit alongside emission transforms in the same `.compose()` block (which is the common research/HITL case).

### 9.3 Orthogonal (stays as-is, unrelated concern)

These configure **what components exist**, not how they emit. They do not desugar through compose:

- `.withProvider`, `.withReasoning`, `.withTools`, `.withMemory`, `.withMCP`
- `.withSubAgents` (registration), `.withCalibration`, `.withModelPricing`
- `.withMetaTools`, `.withCircuitBreaker`, `.withAuditing`

The event bus (`eventBus.subscribe`) also stays orthogonal: it's post-emission observability. `harness.tap` runs *during* emission resolution; `eventBus.subscribe` fires *after* the final value is committed. Both have legitimate use cases (compose for shaping, event bus for system-wide listeners that don't care about the resolution pipeline).

---

## 10. Type System

### 10.1 Tag union (template literal)

```ts
type Tag =
    | `prompt.${PromptSubTag}`
    | `message.${MessageSubTag}`
    | `nudge.${NudgeSubTag}`
    | `tool.${ToolSubTag}`
    | `observation.${ObservationSubTag}`
    | `decision.${DecisionSubTag}`
    | `cost.${CostSubTag}`

type PromptSubTag = 'system' | 'system.react' | 'system.reflexion' | /* … */ | 'synthesis' | 'format-instructions'
// ... etc per namespace
```

### 10.2 Per-tag payload + context

```ts
interface TagMap {
    'prompt.system':              { payload: string; ctx: PromptContext }
    'prompt.synthesis':           { payload: string; ctx: SynthesisContext }
    'message.tool-result':        { payload: KernelMessage; ctx: ToolResultContext }
    'nudge.loop-detected':        { payload: string; ctx: NudgeContext }
    'observation.tool-result':    { payload: ObservationStep; ctx: ToolResultContext }
    'decision.terminate':         { payload: TerminationVerdict; ctx: DecisionContext }
    'decision.cost-route':        { payload: CostRoutePick; ctx: CostRouteContext }
    /* …all 24+ tags… */
}

type PayloadFor<T extends Tag> = TagMap[T]['payload']
type ContextFor<T extends Tag> = TagMap[T]['ctx']
```

### 10.3 Pattern → tag-set inference

For autocomplete and ctx narrowing under wildcards, we use distributive conditional types:

```ts
type TagsMatching<P extends TagPattern> = 
    P extends Tag ? P :
    P extends `${infer Prefix}.*` ? Extract<Tag, `${Prefix}.${string}`> :
    P extends `${infer Prefix}.**` ? Extract<Tag, `${Prefix}.${string}`> :
    P extends '**' ? Tag :
    Tag

type TransformFor<P extends TagPattern> = 
    (payload: PayloadFor<TagsMatching<P>>, ctx: ContextFor<TagsMatching<P>>) =>
        | PayloadFor<TagsMatching<P>> | undefined | null
        | Promise<PayloadFor<TagsMatching<P>> | undefined | null>
```

`harness.on('prompt.*', (text, ctx) => …)` infers `text: string` (union of all `prompt.*` payloads — they all happen to be strings) and `ctx` as the union of all prompt contexts. The user sees full IDE autocomplete on context fields that are common across the union.

### 10.4 Live tag catalog (build step)

A build-time codegen scans every `pipeline.transform(tag, …)` call site in the kernel and writes:

- `packages/core/src/services/harness-tag-catalog.generated.ts` — the `TagMap` interface
- `apps/docs/src/data/harness-tags.json` — fed into the docs site for the auto-generated tag reference page

This means **adding a new chokepoint requires a single change** (the call site itself); types and docs auto-sync. CI fails if a `pipeline.transform` call's tag isn't in `TagMap`.

---

## 11. Implementation Plan

### 11.1 Module layout

```
packages/core/src/services/
    harness-pipeline.ts           ← new: registry + resolver
    harness-tag-catalog.generated.ts  ← new: codegen output
    harness-pipeline.test.ts      ← new: unit tests

packages/reasoning/src/kernel/
    state/kernel-state.ts         ← modified: add `harness: HarnessPipeline` field
    capabilities/                 ← modified: replace 5 inline literals with pipeline.transform calls (v0.11)
    
packages/runtime/src/
    builder.ts                    ← modified: add .compose() method; desugar Sugar APIs
    run-handle.ts                 ← new: RunHandle implementation with control verbs
    run-controller.ts             ← new: pause/resume/stop/terminate plumbing

packages/compose/                 ← new package
    src/killswitches/
        budget-limit.ts
        timeout-after.ts
        max-iterations.ts
        require-approval-for.ts
        watchdog.ts
        confidence-floor.ts
    src/index.ts                  ← exports + .list()
    test/

apps/docs/src/content/docs/
    reference/compose-api.mdx     ← new: full API reference
    reference/harness-tags.mdx    ← new: auto-generated tag catalog
    cookbook/composition-recipes.mdx  ← new: 9 patterns from research
```

### 11.2 Phasing

**v0.11.0 — compose surface + 5 chokepoints + control + 6 killswitches**

Wave A (1–2 days):
- `harness-pipeline.ts` (registry, resolver, tap mechanism)
- `harness-tag-catalog.generated.ts` (7 initial tags (includes `lifecycle.failure` + `control.strategy-evaluated` for M14 self-evolution))
- Builder `.compose()` method
- Type system (`TagMap`, `PayloadFor`, `ContextFor`, pattern inference)

Wave B (1–2 days):
- 5 chokepoint refactors:
    1. `prompt.system` (think.ts assembly)
    2. `nudge.loop-detected` (loop-detector.ts)
    3. `nudge.healing-failure` (tool-execution.ts)
    4. `message.tool-result` (act.ts)
    5. `observation.verifier-retry` (retry-context.ts)
- Default behavior byte-identical (regression tests must pass with no changes)

Wave C (1 day):
- `RunHandle` + `RunController`
- `pause`/`resume`/`stop`/`terminate` plumbing
- `harness.{pause, resume, stop, terminate}` from inside compose

Wave D (1–2 days):
- `packages/compose` package
- 6 killswitch implementations
- Killswitch registry export

Wave E (1 day):
- Sugar desugar implementations (existing `.with*()` methods route through compose)
- Backward-compat regression tests
- `withHook` ↔ `harness.before/after/onError` equivalence tests

Wave F (1 day):
- Docs: `compose-api.mdx`, `harness-tags.mdx` (auto-gen), `composition-recipes.mdx`
- Update `reference/stability.md` to mark `.compose()` as `@stable`
- Update `index.mdx` tagline + harness-pick card to reference `.compose()`

**v0.12.0 — remaining 19 chokepoints**

Each chokepoint is a small, independent PR with tests. Order by community-research demand:
1. `prompt.system.react`, `.reflexion`, `.plan-execute` (research velocity)
2. `nudge.required-tools-*`, `nudge.oracle-*`, `nudge.reactive-observer` (most-asked nudge customization)
3. `tool.schema`, `tool.schema.description` (per-tenant tool docs)
4. `observation.episodic-recall`, `observation.compression-summary` (memory shape)
5. `prompt.synthesis`, `message.subagent-handoff`, `message.max-tokens-recovery`
6. `decision.terminate`, `decision.cost-route` (structured decisions — bonus namespace)

**v0.13.0 — Phase 2 backlog**

- Checkpointed pause (cross-process resume; KernelState serialization)
- `resume({ withStateChange })` with structured patch DSL
- Per-tenant context propagation (`ctx.tenantId`)
- Per-tool middleware (`harness.middleware('toolName', wrapFn)`) — addresses community-research #1 ask directly
- Sub-agent compose inheritance (parent compose chain auto-inherits to sub-agents; opt-out via `.withSubAgents({ inheritCompose: false })`)
- Composition export/import: `harness.export()` returns a serializable composition manifest for cross-project reuse

### 11.3 Backward-compatibility tests

Every existing user of `.withSystemPrompt`, `.withHook`, `.withErrorHandler`, `.withCustomTermination`, `.withVerification`, `.withProgressCheckpoint` must produce identical outputs (byte-level diff on the 35-task harness benchmark) before and after the refactor. Captured as a CI gate in `harness-reports/compose-regression-2026-XX.md`.

### 11.4 Performance gates

CI fails if:
- Pipeline overhead per pass-through emission > 50µs (P95)
- Pipeline overhead per single-transform emission > 200µs (P95)
- 35-task harness wall-clock regresses by > 2% vs pre-compose baseline

---

## 12. Migration Path

### 12.1 For existing user code: zero changes required

All `.with*()` overrides keep working. The refactor is internal sugar; no public API breaks. `stability.md` continues to mark these as `@stable`.

### 12.2 For users wanting the new surface

```ts
// Before (still works in v0.11+)
agent.withSystemPrompt('Custom system prompt')

// After (new pattern, equivalent)
agent.compose((h) => h.on('prompt.system', () => 'Custom system prompt'))

// New superpower — wasn't expressible before
agent.compose((h) => 
    h.on('prompt.system', (defaultPrompt) => 
        `${tenantHeader(ctx)}\n${defaultPrompt}\n${complianceFooter}`
    )
)
```

### 12.3 For internal harness research

All experimental nudge variants move from inline string literals (which require kernel rebuild) to a `compose-experiments/` directory of test fixtures, each a single `(harness) => void` function. A/B harness reports become `harness-reports/<date>-compose-<variant>.md`.

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| TypeScript pattern-inference performance degrades IDE responsiveness on large codebases | Medium | Medium | Use distributive conditionals carefully; benchmark IDE perf at 200, 500, 1000 LOC sample compositions; provide a `// @harness-no-narrow` escape hatch for power users |
| Pipeline overhead per emission unexpectedly high in production | Low | High | Performance gates in CI (§11.4); fast-path for "no transformers registered for this tag" using bitset of registered prefixes |
| Backward-compat surface diverges in subtle ways post-desugar | Medium | High | Byte-diff regression tests on 35-task harness; community beta period before 0.11 final |
| Pause/resume in v0.11 confuses users into expecting cross-process resume | Medium | Low | Docs explicit about in-process scope; `.snapshot()` returns clear "not yet serializable" type; Phase 2 milestone publicly tracked |
| Killswitch composition order is order-dependent (first trigger wins) but not obvious | Low | Medium | `terminationSource` tag includes the killswitch name; docs prominently feature ordering example |
| Tag explosion: 24 tags in v0.11, 50+ over time, becomes hard to discover | Low | Medium | `harness.tags()` runtime introspection; auto-generated docs page; namespaces give structure |
| Sub-agent compose inheritance creates surprising parent→child leakage | Medium | Medium | Opt-in default (sub-agents don't inherit unless `.withSubAgents({ inheritCompose: true })`); Phase 2 design |

---

## 14. Open Questions

(Resolved during the May-6 conversation; recorded for posterity)

| Question | Resolution |
|---|---|
| Multiple `.compose()` calls or one? | **Allow multiple** — composability is the pitch |
| Pass-through default semantics? | **`undefined` = passthrough; `null` = suppress; other = replace** |
| Stop-from-inside semantics? | **Queue: transform's return value honored first, stop fires at next phase boundary** |
| Verb name for builder method? | **`.compose()`** — locks in framework's composable identity |
| Param name for closure handle? | **`harness`** — matches hero tagline vocabulary |
| Theatrical inner namespaces (`dialogue.*`, `cue.*`)? | **No** — keep technical (`prompt.*`, `nudge.*`) for adoption ergonomics |
| Cross-process pause/resume in v0.11? | **No** — in-process only; cross-process is Phase 2 backlog |

(Still open, to be resolved during Wave A implementation)

| Question | Status |
|---|---|
| How does `harness.tags()` reflect downstream-registered tags from imported compositions? Does it include them once `.use()` is called, or only at `build()` time? | TBD — leaning toward "once `.use()` evaluates"; needs prototype |
| Tag namespace conflict resolution: what if two transformers for `'prompt.system'` and `'prompt.*'` both register? | Leaning toward most-specific runs first within registration-order tie-break; needs test cases |
| Scoped `namespace(prefix, fn)` — does it allow upward escape (e.g. listening to `'**'` from inside a namespace)? | TBD — leaning toward no (scoped means scoped); explicit `harness.unscoped` escape hatch if needed |

---

## 15. Acceptance Criteria

A v0.11 release is shippable when:

- [ ] `.compose((harness) => …)` exists on the builder and accepts multiple registrations
- [ ] All six method families (`on`, `emit`, `tap`, `before/after/onError`, `tags/signature/peek`, `use/namespace`) are implemented with full type safety
- [ ] 5 chokepoints route through the pipeline (system prompt, loop nudge, healing failure, tool-result formatting, verifier retry)
- [ ] All existing `.with*()` overrides desugar through compose, byte-identical behavior on 35-task harness
- [ ] `RunHandle` exposes `pause/resume/stop/terminate/status/snapshot`
- [ ] `harness.{pause, resume, stop, terminate}` available inside compose closures
- [ ] 6 killswitches (`budgetLimit`, `timeoutAfter`, `maxIterations`, `requireApprovalFor`, `watchdog`, `confidenceFloor`) ship in `reactive-agents/compose/killswitches`
- [ ] Performance gates green (§11.4)
- [ ] 30+ unit tests covering pipeline, lifecycle, killswitches
- [ ] Docs published: `compose-api.mdx`, `harness-tags.mdx`, `composition-recipes.mdx`
- [ ] `reference/stability.md` marks `.compose()` as `@stable`
- [ ] Homepage tagline + harness-pick card reference `.compose()` and link to recipes
- [ ] At least one harness-research debrief uses compose for an A/B (proves the dogfood path)

## 16. Success Metrics (post-launch)

- **Adoption**: % of new agent code in cookbook/examples using `.compose()` vs `.with*()` sugar (target: 60% within 2 weeks of release)
- **Research velocity**: time-to-A/B-result for nudge variants (baseline: ~4 hours fork+rebuild+benchmark; target: < 30 minutes via compose fixture)
- **Adoption signal**: Show-HN comments mentioning `.compose()` API by name
- **Stability**: `.compose()` core API unchanged 60 days post-release (no breaking changes; promotion to `@stable` tier)

---

## 17. Out of Scope (Explicit)

- **Visual / no-code composition builder** — UI tooling for composing harnesses without code. Possibly Cortex feature; not framework-level.
- **Cross-language composition portability** — composition manifests serializable to a language-neutral format (Python, etc.). Phase 3+ if ever.
- **Live edit / hot-reload of compositions in production** — out of scope; compositions are build-time configuration.
- **Compose() inside a running agent (mutate composition mid-run)** — explicitly disallowed; compositions are frozen at `.build()` time. Use the `harness.emit/before/after` from inside an existing composition for runtime intent.
- **Deprecating `.with*()` sugar APIs** — they stay forever (sugar continues to be useful for one-off cases). Compose is additive, not replacement.
- **Internal log/diagnostic emissions (audit point #22 — auto-checkpoint warnings)** — these stay on the event bus (`emitLog` warnings, structured diagnostics). They aren't model-bound content, so they don't belong in compose. Subscribers wanting them use `eventBus.subscribe('log.*', fn)` as today.
- **Mutation of compose registrations from inside compose** — `harness.on(...)` from inside another transformer is undefined behavior. Compositions are declarative-at-build-time; runtime intent goes through `emit`/`pause`/`stop`/`terminate`.

---

## Self-Evolution Hooks (v5.0 addition)

Two new tags added to support M14 (Self-Evolution). Research basis: NLAH arXiv:2603.25723 — acceptance-gated attempt narrowing is the most consistently positive harness module (+4.8pp SWE-bench Verified, +2.7pp OSWorld).

### `lifecycle.failure`

Fires after: tool execution error, LLM refusal, or verifier rejection.

```typescript
type LifecycleFailurePayload = {
  reason: 'tool-error' | 'llm-refusal' | 'verifier-rejection';
  errorMessage: string;
  attemptNumber: number;    // total attempts on current task
  failureStreak: number;    // consecutive failures without a successful step
  currentStrategy: string;  // name of active reasoning strategy
};

// Handler return values:
// undefined                    → continue with default behavior
// { narrowTo: string }         → switch to named sub-strategy before next attempt
// { abandon: true }            → escalate to parent / exit-failure immediately
```

### `control.strategy-evaluated`

Fires after `strategy-evaluator.ts` completes a trajectory score.

```typescript
type ControlStrategyEvaluatedPayload = {
  currentStrategy: string;
  score: number;                  // 0–1 confidence in current trajectory
  failureStreak: number;
  recommendedAction: 'continue' | 'switch' | 'escalate';
  availableStrategies: string[];
};

// Handler return values:
// undefined                                     → accept recommendedAction
// { override: 'continue' | 'switch' | 'escalate' } → override recommendation
// { switchTo: string }                          → switch to specific named strategy
```

### Built-in helper: `composeNarrowRetry`

```typescript
import { composeNarrowRetry } from '@reactive-agents/runtime/compose';

/**
 * Acceptance-gated attempt loop.
 * Stays on current (narrow) strategy until maxBroadenAfter consecutive failures,
 * then allows strategy-evaluator to broaden. Implements NLAH self-evolution pattern.
 */
export function composeNarrowRetry(maxBroadenAfter: number = 3) {
  return (harness: Harness) => {
    harness.on('control.strategy-evaluated', (payload) => {
      if (payload.failureStreak < maxBroadenAfter) {
        return { override: 'continue' }; // stay narrow
      }
      return undefined; // allow broadening after threshold
    });
  };
}

// Usage:
const agent = buildAgent()
  .withReasoning(...)
  .compose(composeNarrowRetry(3))
  .build();
```

---

*End of design spec.*
