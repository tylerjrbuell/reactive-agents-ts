# North Star Sprint Plan — Part 3: Phase 2 (Decision Rules + Reliability + Verification + Claim/Evidence + Skill + Fixtures)

**Duration:** 2 sprints (2 weeks, weeks 5-6 of the plan).
**Goal:** consolidate every kernel decision point into named rule pipelines; land reliability primitives (retry, circuit breakers, idempotency); add the Verification port; extend Claim/Evidence and Skill primitives; deliver fixture recording for deterministic agent tests; eliminate every `catchAll(() => Effect.void)` site.
**Preconditions:** Phase 1 closed (`AgentConfig` is sealed source of truth, Capability port live, ContextCurator sole author, Task primitive shipped, typed Skill schema seeded).

**North-star reference:** §5 Decision Rules, §5.3 error taxonomy (migration), §4.5 Verification port, §7.2 reliability, §11.6 fixture recording, §12.3 Claim+Evidence, §12.4 typed Skill expansion, §14 Phase 2.

---

## Sprint structure

| Sprint | Week | Theme | Stories |
|---|---|---|---|
| **P2.S1** | 5 | Decision Rules + Reliability + Error migration | 7 stories |
| **P2.S2** | 6 | Verification + Claim/Evidence + Skill + Fixtures | 5 stories |

---

## Sprint P2.S1 — Decision Rules + Reliability

**Goal:** every kernel decision is a named `Rule<D>[]` pipeline emitting `DecisionMade` events. Retry/circuit-breaker/idempotency primitives land. Zero `catchAll(() => Effect.void)` remains.

**Success gates:**
- `trivial-1step` iterations = 1 (W6 regression fixed)
- termination-quality probe passes without burning budget
- circuit breaker opens under simulated outage
- idempotent-retry probe doesn't double-execute non-idempotent tools
- Zero `catchAll(() => Effect.void)` in production code

### Story P2.S1.1 — `Rule<D, S>` primitive + `evaluatePipeline` + `DecisionMade` event

**Intent:** the foundation every subsequent rule story depends on. A typed `Rule`, an `evaluatePipeline` helper, and a `DecisionMade` event emission on every evaluation.

**Files:**
- `packages/core/src/rule/rule.ts` (NEW) — `Rule<D, S>` interface
- `packages/core/src/rule/evaluate.ts` (NEW) — `evaluatePipeline` function
- `packages/core/src/rule/index.ts` (NEW)
- `packages/core/src/services/event-bus.ts` — add `DecisionMade` to `AgentEvent` union
- `packages/core/tests/rule.test.ts`
- `packages/core/src/index.ts` — export `Rule` namespace
- Changeset: required (minor, new public API)

**RED:**

```ts
// packages/core/tests/rule.test.ts
import { describe, it, expect } from "bun:test"
import { Effect, Ref } from "effect"
import type { Rule } from "@reactive-agents/core/rule"
import { evaluatePipeline } from "@reactive-agents/core/rule"
import { EventBus, EventBusLive } from "@reactive-agents/core"

describe("Rule + evaluatePipeline", () => {
  const alwaysAllow: Rule<"allow" | "deny"> = {
    name: "always-allow",
    when: () => true,
    then: () => "allow",
    reason: () => "permissive default",
  }
  const denyIfFlagged: Rule<"allow" | "deny", { flagged: boolean }> = {
    name: "deny-if-flagged",
    when: (s) => s.flagged === true,
    then: () => "deny",
    reason: () => "flagged state",
  }

  it("returns first-matching rule's decision", () => {
    const r = evaluatePipeline([denyIfFlagged, alwaysAllow], { flagged: false })
    expect(r.decision).toBe("allow")
    expect(r.firedRule).toBe("always-allow")
  })

  it("short-circuits on first match", () => {
    const r = evaluatePipeline([denyIfFlagged, alwaysAllow], { flagged: true })
    expect(r.decision).toBe("deny")
    expect(r.firedRule).toBe("deny-if-flagged")
  })

  it("returns null decision + firedRule when no rule matches", () => {
    const neverMatch: Rule<"x"> = { name: "never", when: () => false, then: () => "x" }
    const r = evaluatePipeline([neverMatch], {})
    expect(r.decision).toBeNull()
    expect(r.firedRule).toBeNull()
  })

  it("emits DecisionMade event to EventBus on every evaluation", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Ref.make<AgentEvent[]>([])
        const bus = yield* EventBus
        yield* bus.subscribe((e) => Ref.update(captured, (xs) => [...xs, e]))
        yield* evaluatePipelineEffect(
          "terminate-test",
          [alwaysAllow],
          { flagged: false },
        )
        return yield* Ref.get(captured)
      }).pipe(Effect.provide(EventBusLive)),
    )
    const dm = events.find((e) => e.type === "DecisionMade")
    expect(dm).toBeDefined()
    expect((dm as any).pipeline).toBe("terminate-test")
    expect((dm as any).firedRule).toBe("always-allow")
  }, { timeout: 15000 })
})
```

**GREEN:**

```ts
// packages/core/src/rule/rule.ts
export interface Rule<D, S = unknown> {
  readonly name: string
  readonly when: (state: S) => boolean
  readonly then: (state: S) => D
  readonly reason?: (state: S) => string
}

// packages/core/src/rule/evaluate.ts
import { Effect } from "effect"
import { EventBus } from "../services/event-bus"

export interface PipelineResult<D> {
  readonly decision: D | null
  readonly firedRule: string | null
  readonly reason: string | null
}

export const evaluatePipeline = <D, S>(
  rules: readonly Rule<D, S>[],
  state: S,
): PipelineResult<D> => {
  for (const rule of rules) {
    if (rule.when(state)) {
      return {
        decision: rule.then(state),
        firedRule: rule.name,
        reason: rule.reason?.(state) ?? null,
      }
    }
  }
  return { decision: null, firedRule: null, reason: null }
}

export const evaluatePipelineEffect = <D, S>(
  pipeline: string,
  rules: readonly Rule<D, S>[],
  state: S,
): Effect.Effect<PipelineResult<D>, never, EventBus> =>
  Effect.gen(function* () {
    const result = evaluatePipeline(rules, state)
    const bus = yield* EventBus
    yield* bus.emit({
      type: "DecisionMade",
      pipeline,
      firedRule: result.firedRule,
      decision: result.decision,
      reason: result.reason,
      timestamp: Date.now(),
    })
    return result
  })
```

**REFACTOR:**
- Ensure `Rule` is re-exported at the package top (`@reactive-agents/core`).
- `DecisionMade` event shape stabilized with typed `pipeline` enum: `"terminate" | "compress" | "retry" | "intervene" | "verify"`.

**Acceptance:** 4 tests green. `DecisionMade` subscribable from userland.

**Effort:** 3. **Risk:** Low. **Dependencies:** none (inside Phase 2).

---

### Story P2.S1.2 — Termination rule pipeline

**Intent:** consolidate the 4 scattered termination writers (think.ts:551/681, act.ts:440, kernel-runner exit gates) + termination-oracle.ts chain into ONE `Rule<TerminationDecision>[]` pipeline read from `config.termination.rules`.

**Files:**
- `packages/reasoning/src/strategies/kernel/termination/default-rules.ts` (NEW) — 10 default rules per north-star §5.2
- `packages/reasoning/src/strategies/kernel/termination/pipeline.ts` (NEW) — single call site
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — remove 4 scattered writers; replace with `evaluatePipelineEffect("terminate", config.termination.rules, state)`
- `packages/reasoning/src/strategies/kernel/phases/think.ts` — remove lines 551, 681 writers
- `packages/reasoning/src/strategies/kernel/phases/act.ts` — remove line 440 writer
- `packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts` — retire the chain; migrate individual evaluators to rules
- `packages/reasoning/tests/termination-rules.test.ts`
- `packages/reasoning/tests/termination-trivial-1step.test.ts`
- Probe: `termination-rule-ordering` (NEW) — CI required
- Probe: `trivial-1step` — must return iterations=1 after this story
- Changeset: required (minor; kernel behavior change)

**RED:**

```ts
// packages/reasoning/tests/termination-rules.test.ts
describe("termination rule pipeline", () => {
  it("default pipeline includes all 10 expected rules in order", () => {
    expect(defaultTerminationRules.map((r) => r.name)).toEqual([
      "finalAnswerToolAccepted",
      "llmEndTurnWithRequiredToolsSatisfied",
      "finalAnswerRegexMatched",
      "entropyConvergedWithContentStable",
      "lowDeltaGuard",
      "loopDetectedGraceful",
      "oracleForcedExit",
      "dispatcherEarlyStop",
      "harnessDeliverableFallback",
      "maxIterationsReached",
    ])
  })

  it("user-supplied rules prepend to default pipeline", () => {
    const customRule: Rule<TerminationDecision, KernelState> = {
      name: "custom-json-deliverable",
      when: (s) => /^\{.*\}$/s.test(s.output ?? ""),
      then: () => "terminate",
    }
    const pipeline = buildTerminationPipeline({ additionalRules: [customRule] })
    expect(pipeline[0]!.name).toBe("custom-json-deliverable")
  })

  it("finalAnswerToolAccepted fires when act phase accepts final-answer tool", () => {
    const state = stateWith({ finalAnswerAccepted: true })
    const r = evaluatePipeline(defaultTerminationRules, state)
    expect(r.firedRule).toBe("finalAnswerToolAccepted")
    expect(r.decision).toBe("terminate")
  })

  it("each rule testable in isolation", () => {
    // run every rule against a state that should and should-not trigger
  })
})

// packages/reasoning/tests/termination-trivial-1step.test.ts
describe("trivial-1step — termination ordering", () => {
  it("a final-answer-in-one-turn task terminates at iteration 1", async () => {
    const agent = await makeTestAgent()
    const result = await agent.run("what is 2+2? answer only")
    expect(result.iterations).toBe(1)
    expect(result.terminatedBy).toBe("finalAnswerToolAccepted")
    await agent.dispose()
  }, { timeout: 60000 })
})
```

**GREEN:**

```ts
// packages/reasoning/src/strategies/kernel/termination/default-rules.ts
import type { Rule } from "@reactive-agents/core/rule"
import type { KernelState } from "../kernel-state"

export type TerminationDecision = "terminate" | "continue" | "continue-with-nudge"

export const finalAnswerToolAccepted: Rule<TerminationDecision, KernelState> = {
  name: "finalAnswerToolAccepted",
  when: (s) => s.meta.finalAnswerAccepted === true,
  then: () => "terminate",
  reason: () => "final-answer tool accepted by act phase",
}

// ... 9 more rules, each ~5 LOC

export const defaultTerminationRules: readonly Rule<TerminationDecision, KernelState>[] = [
  finalAnswerToolAccepted,
  llmEndTurnWithRequiredToolsSatisfied,
  finalAnswerRegexMatched,
  entropyConvergedWithContentStable,
  lowDeltaGuard,
  loopDetectedGraceful,
  oracleForcedExit,
  dispatcherEarlyStop,
  harnessDeliverableFallback,
  maxIterationsReached,
]
```

```ts
// packages/reasoning/src/strategies/kernel/kernel-runner.ts — in the main loop
const { decision, firedRule, reason } = yield* evaluatePipelineEffect(
  "terminate",
  config.termination.rules ?? defaultTerminationRules,
  state,
)
if (decision === "terminate") {
  state = transitionState(state, {
    status: "done",
    meta: { ...state.meta, terminatedBy: firedRule ?? "unknown", terminationReason: reason },
  })
  break
}
if (decision === "continue-with-nudge") {
  state = injectNudge(state, reason)
}
// else decision === "continue" or null — continue loop
```

All 4 scattered writers deleted. `termination-oracle.ts` evaluators converted to individual `Rule`s.

**REFACTOR:**
- Each rule has ≤10 LOC of `when` logic; anything larger extracts a helper.
- `TerminationDecision` type documented as a public export for user rules.

**Acceptance:**
- 4+ rule tests green
- `trivial-1step` returns iterations=1 (W6 regression fixed)
- `termination-rule-ordering` probe green — asserts `DecisionMade` events fire in order matching `defaultTerminationRules`
- No references to `state.meta.terminatedBy = ...` outside the rule pipeline (grep verified in test)

**Effort:** 8. **Risk:** HIGH (critical kernel path). **Dependencies:** P2.S1.1.

---

### Story P2.S1.3 — Compression rule pipeline

**Intent:** collapse the 3 uncoordinated compression systems (`tool-formatting.ts:221-340` always-on, `context-compressor.ts:10` advisory, `reactive-observer.ts:323` patch-applier) into ONE `Rule<CompressDecision>[]` pipeline inside `ContextCurator`.

**Files:**
- `packages/reasoning/src/context/compression/default-rules.ts` (NEW)
- `packages/reasoning/src/context/compression/pipeline.ts` (NEW)
- `packages/reasoning/src/context/context-curator.ts` — call pipeline
- `packages/reasoning/src/strategies/kernel/utils/tool-formatting.ts` — remove always-on compression (curator now owns it)
- `packages/reactive-intelligence/src/controller/context-compressor.ts` — deprecate advisory; migrate its logic into a rule
- `packages/reactive-intelligence/src/controller/reactive-observer.ts:323` — remove patch-applier slice; move into a rule
- `packages/reasoning/tests/compression-rules.test.ts`
- Changeset: required

**RED:**

```ts
describe("compression rule pipeline", () => {
  it("default pipeline has 3 rules", () => {
    expect(defaultCompressionRules.map((r) => r.name)).toEqual([
      "toolResultExceedsBudget",
      "contextPressureAbove80Pct",
      "scratchpadHasStaleEntries",
    ])
  })

  it("toolResultExceedsBudget fires when any tool result > config.compression.budget", () => {})
  it("contextPressureAbove80Pct fires at 80% budget", () => {})
  it("scratchpadHasStaleEntries fires at 50+ stale entries", () => {})

  it("no double-compression on the same data", async () => {
    // trace a full task run; assert compression fires exactly once per tool result and at most once per iteration for messages
  })
})
```

**GREEN:**

```ts
export type CompressDecision =
  | { kind: "compress-result"; toolCallId: string; targetChars: number }
  | { kind: "compress-messages"; keepLastN: number }
  | { kind: "evict-scratchpad"; staleKeys: readonly string[] }
  | { kind: "none" }
```

Three rules, evaluated by the curator per iteration. No more always-on always-fire.

**Acceptance:** 5 tests green. CI microbench shows zero double-compression.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P2.S1.1, P1.S3.4 (curator).

---

### Story P2.S1.4 — Retry rule pipeline (`RetryPolicyService`)

**Intent:** centralize retry logic. `RetryPolicyService` with per-error-type rules. Delete the 4+ tool-specific retry loops in `tools/skills/*`.

**Files:**
- `packages/core/src/reliability/retry-policy.ts` (NEW) — service + default rules
- `packages/core/src/reliability/runtime.ts` (NEW) — Layer factory
- `packages/tools/src/skills/web-search.ts` — delete retry loop, use `RetryPolicyService`
- `packages/tools/src/skills/crypto-price.ts` — same
- `packages/tools/src/skills/file-operations.ts` — same
- `packages/llm-provider/src/retry.ts` — use `RetryPolicyService` instead of hardcoded Schedule
- `packages/core/tests/retry-policy.test.ts`
- Changeset: required (minor)

**RED:**

```ts
describe("RetryPolicyService", () => {
  it("retries LLMRateLimitError with exponential backoff + jitter, 5 attempts max", async () => {
    // fail 4 times, succeed on 5th
    const result = await runWithPolicy(failingEffect, defaultRetryRules)
    expect(result.attempts).toBe(5)
  })

  it("does not retry CapabilityError", async () => {
    const result = await runWithPolicy(capabilityErrEffect, defaultRetryRules)
    expect(result.attempts).toBe(1)  // no retry
  })

  it("retries idempotent tool on LLMTimeoutError only if tool.idempotent=true", async () => {
    const idempotentResult = await runWithPolicy(timeoutEffect, defaultRetryRules, { idempotent: true })
    expect(idempotentResult.attempts).toBe(3)
    const nonResult = await runWithPolicy(timeoutEffect, defaultRetryRules, { idempotent: false })
    expect(nonResult.attempts).toBe(1)  // no retry
  })

  it("retries pipeline emits DecisionMade per attempt", async () => {})
})
```

**GREEN:** implement per north-star §5.2 exactly.

```ts
export const defaultRetryRules: readonly Rule<RetryDecision, RetryContext>[] = [
  {
    name: "rate-limited",
    when: (ctx) => ctx.err?._tag === "LLMRateLimitError",
    then: (ctx) => ({
      kind: "retry",
      schedule: "exponential-with-jitter",
      maxAttempts: 5,
      initialDelayMs: (ctx.err as LLMRateLimitError).retryAfterMs ?? 1000,
    }),
  },
  { name: "timeout-idempotent", when: (ctx) => ctx.err?._tag === "LLMTimeoutError" && ctx.tool?.idempotent === true, then: () => ({ kind: "retry", schedule: "linear", maxAttempts: 2 }) },
  { name: "capability-violation", when: (ctx) => ctx.err?._tag === "ToolCapabilityViolation", then: (ctx) => ({ kind: "abort", reason: `capability violation: ${(ctx.err as any).toolName}` }) },
  { name: "server-error", when: (ctx) => ctx.err?._tag === "ServerError", then: () => ({ kind: "retry", schedule: "exponential", maxAttempts: 3 }) },
  { name: "default-no-retry", when: () => true, then: () => ({ kind: "no-retry" }) },
]
```

**Acceptance:** 4 tests green. All tool-skill retry loops deleted. `bun run build` clean.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P2.S1.1.

---

### Story P2.S1.5 — Named circuit breakers + `ToolDefinition.idempotent`

**Intent:** circuit breakers per `(provider, model)` and per-MCP-server, per-tool (named, not anonymous). `ToolDefinition.idempotent: boolean` schema field.

**Files:**
- `packages/core/src/reliability/circuit-breaker.ts` — generalize existing `llm-provider/src/circuit-breaker.ts`; named instances
- `packages/core/src/reliability/registry.ts` (NEW) — named registry lookup
- `packages/tools/src/define-tool.ts` — `idempotent?: boolean` field
- `packages/tools/src/skills/*.ts` — annotate all 15 built-in tools with idempotency
- `packages/core/tests/circuit-breaker.test.ts`
- Probe: `idempotent-retry` (NEW)
- Changeset: required (minor)

**RED:**

```ts
describe("CircuitBreaker registry", () => {
  it("returns same breaker for same name", () => {
    const a = getBreaker("provider:anthropic")
    const b = getBreaker("provider:anthropic")
    expect(a).toBe(b)  // same instance
  })

  it("independent breakers for different names", () => {
    const a = getBreaker("provider:anthropic")
    const b = getBreaker("mcp:github")
    expect(a).not.toBe(b)
  })

  it("opens after 5 failures in 30s, closes after cooldown", async () => {})
  it("probe: circuit breaker opens under simulated outage", async () => {})
})

describe("ToolDefinition.idempotent", () => {
  it("accepts true/false", () => {
    const t = defineTool({ name: "x", idempotent: true, ... })
    expect(t.idempotent).toBe(true)
  })

  it("defaults to false (safer)", () => {
    const t = defineTool({ name: "x", ... })
    expect(t.idempotent).toBe(false)
  })

  it("retry rule honors idempotent=false on timeout", async () => {
    // idempotent-retry probe
  })
})
```

**GREEN:**

```ts
// packages/core/src/reliability/registry.ts
const registry = new Map<string, CircuitBreaker>()

export const getBreaker = (name: string, config?: BreakerConfig): CircuitBreaker => {
  if (!registry.has(name)) {
    registry.set(name, makeCircuitBreaker(config ?? defaultBreakerConfig))
  }
  return registry.get(name)!
}
```

Annotate 15 built-in tools:
- web-search, crypto-price, http-get, file-read, checkpoint, recall, find, brief, pulse, context-status: `idempotent: true`
- file-write, code-execute, git-cli, gh-cli, gws-cli: `idempotent: false`

**Acceptance:** 4 circuit breaker + 3 idempotent tests green. Probe `idempotent-retry` green (non-idempotent tools NOT double-executed on timeout).

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P2.S1.4.

---

### Story P2.S1.6 — Typed error migration (zero `catchAll(() => Effect.void)` remaining)

**Intent:** replace every `catchAll(() => Effect.void)` site with either `catchTag` (specific recovery) or `catchAll((err) => emitErrorSwallowed(err).pipe(Effect.flip, Effect.orElseSucceed(() => undefined)))` (explicit, observable swallow).

**Files:**
- All 10+ sites identified in S0.2 — migrate each
- `packages/runtime/tests/zero-silent-catches.test.ts` (NEW)
- Changeset: required (minor; error-handling behavior change)

**RED:**

```ts
describe("zero silent catches", () => {
  it("no catchAll(() => Effect.void) remains in production code", async () => {
    const grep = await Bun.$`rg "catchAll\\(\\(\\) => Effect\\.void\\)" packages/ apps/ -g '!**/tests/**' -g '!**/*.test.ts'`.text()
    expect(grep.trim()).toBe("")
  })

  it("every previously-known site is now either catchTag or catchAll-with-event", () => {
    // For each site in KNOWN_SWALLOW_SITES: assert the migration landed
  })
})
```

**GREEN:** site-by-site migration. Most of the 10+ sites are I/O cleanup — those become `catchTag("FiberInterruptedError", ...)`. Some are missing-env-var fallbacks — those become `catchTag("ConfigMissing", ...)`. A few are true "don't want to fail agent run on this" — those keep the catch-all but emit `ErrorSwallowed` (wiring from S0.2 already in place).

**Acceptance:** grep test green (zero hits). Individual site tests green.

**Effort:** 5. **Risk:** MEDIUM-HIGH (error behavior changes across many sites). **Dependencies:** S0.1 + S0.2.

---

### Story P2.S1.7 — `resumeFrom(checkpointId)` entry point

**Intent:** complement to existing auto-checkpoint. User can explicitly resume a task from a given checkpoint.

**Files:**
- `packages/runtime/src/execution-engine.ts` — add `resumeFrom(checkpointId)` method
- `packages/runtime/tests/resume-from.test.ts`
- `apps/docs/src/content/docs/reference/builder-api.md` — document
- Changeset: required (minor)

**RED:**

```ts
describe("resumeFrom", () => {
  it("resumes a task from the given checkpoint", async () => {
    const agent = await makeTestAgent()
    const first = await agent.run(task)  // captures checkpoint at iteration 3
    const cpId = first.checkpoints[2]!.id

    const resumed = await agent.resumeFrom(cpId)
    expect(resumed.resumedFrom).toBe(cpId)
    expect(resumed.iterations).toBeGreaterThan(3)
  }, { timeout: 120000 })

  it("fails with TaskError if checkpointId unknown", async () => {})
})
```

**GREEN:** standard lookup + re-run.

**Acceptance:** 2 tests green. Docs updated.

**Effort:** 3. **Risk:** Low. **Dependencies:** none (existing auto-checkpoint).

---

### Sprint P2.S1 close

**Demo:**
- `trivial-1step` returns iterations=1 (W6 fixed)
- `termination-rule-ordering` probe green
- `idempotent-retry` probe green
- circuit breaker opens under outage simulation
- grep for `catchAll(() => Effect.void)` returns empty in production code

**Retro:**
- How many user-facing errors changed shape during typed-error migration? Coordinate deprecation notes in Phase 2 release changeset.
- Any termination rule ordering surprise? Fix before Sprint 2 integration.

---

## Sprint P2.S2 — Verification + Claim/Evidence + Skill + Fixtures

**Goal:** the Verification port lands. Claim + Evidence primitives enable structural hallucination defense. Typed Skill gains full trigger/protocol/metrics. Fixture recording makes agent tests deterministic in CI.

**Success gates:**
- `verifyBeforeFinalize` rule fires on probe output and correctly retries-with-nudge on failure
- `ClaimExtractor` identifies ≥1 grounded claim per multi-step probe
- 10 recorded fixtures replay deterministically in <5s total
- Skill decay metric updates after 50 uses

### Story P2.S2.1 — Verification port + `verifyBeforeFinalize` rule

**Intent:** elevate verification to a first-class port. Default `LLMVerificationAdapter` uses a configurable verifier model. `verifyBeforeFinalize` rule composes with the termination pipeline.

**Files:**
- `packages/verification/src/service.ts` — rewrite to match north-star §4.5
- `packages/verification/src/adapters/llm.ts` (NEW) — default LLM-based verifier
- `packages/verification/src/runtime.ts` — Layer factory with adapter swap support
- `packages/reasoning/src/strategies/kernel/termination/verify-before-finalize.ts` (NEW) — the Rule
- `packages/runtime/src/builder.ts` — `withVerification({ adapter, verifierModel })` option
- `packages/verification/tests/verification-port.test.ts`
- Probe: `verification-retry-on-failure` (NEW)
- Changeset: required (minor; adapter API)

**RED:**

```ts
describe("VerificationService port", () => {
  it("verify returns ok:true with score on pass", async () => {
    const svc = makeVerificationService(passingAdapter)
    const r = await Effect.runPromise(svc.verify(task, "valid output", []))
    expect(r.ok).toBe(true)
    expect((r as any).score).toBeGreaterThan(0.5)
  })

  it("verify returns ok:false with gaps on fail", async () => {
    const svc = makeVerificationService(failingAdapter)
    const r = await Effect.runPromise(svc.verify(task, "bad output", []))
    expect(r.ok).toBe(false)
    expect((r as any).gaps).toBeDefined()
    expect((r as any).suggestedAction).toMatch(/nudge|retry-with-guidance|abandon/)
  })
})

describe("verifyBeforeFinalize rule", () => {
  it("pass-through terminate when verify.ok=true", async () => {
    // state.pendingDecision = "terminate"; verification returns ok
    // rule returns "terminate"
  })

  it("overrides terminate → continue-with-nudge on failure", async () => {
    // state.pendingDecision = "terminate"; verification returns !ok with suggestedAction=nudge
    // rule returns "continue-with-nudge"
    // state.pendingGuidance contains the verification gaps
  })

  it("cross-model verification — primary ≠ verifier", async () => {
    // task uses claude-opus-4; verifier configured as claude-haiku-4-5
    // assert verifier model's provider is called, not primary
  })
})
```

**GREEN:** per north-star §4.5 exactly.

```ts
export const verifyBeforeFinalize: Rule<TerminationDecision, KernelState> = {
  name: "verify-before-finalize",
  when: (s) => s.pendingDecision === "terminate" && s.task.requireVerification === true,
  then: (s) => {
    // synchronous rule — verification happens async, result cached on state
    const result = s.verificationResult
    if (!result) return "continue-with-nudge"  // trigger async verification
    return result.ok ? "terminate" : "continue-with-nudge"
  },
  reason: (s) => `Verification ${s.verificationResult?.ok ? "passed" : "failed"}`,
}
```

Insert `verifyBeforeFinalize` into the default termination pipeline BEFORE `maxIterationsReached` but AFTER `finalAnswerToolAccepted`.

**Acceptance:** 5 tests green. Probe `verification-retry-on-failure` green — primary hallucinates, verifier catches, retry with nudge succeeds.

**Effort:** 8. **Risk:** MEDIUM-HIGH. **Dependencies:** P2.S1.1, P2.S1.2 (termination rules), P1.S3.5 (Task).

---

### Story P2.S2.2 — Claim + Evidence primitives + ClaimExtractor

**Intent:** `Claim` and `Evidence` as typed primitives; `ClaimExtractor` service extracts claims from output. Opt-in via `task.requireClaimExtraction` per Q12 resolution.

**Files:**
- `packages/core/src/claim.ts` (NEW) — `Claim`, `Evidence`, `EvidenceRef`, `ClaimRef`
- `packages/core/src/claim-extractor.ts` (NEW) — `ClaimExtractor` service interface
- `packages/reasoning/src/strategies/kernel/utils/claim-extractor-llm.ts` (NEW) — default LLM-based adapter
- `packages/reasoning/src/strategies/kernel/runtime.ts` — Layer factory
- `packages/core/tests/claim.test.ts`
- `packages/reasoning/tests/claim-extractor.test.ts`
- Probe: `claim-extraction-presence` (NEW) — assert ≥1 claim per multi-step task when extraction enabled
- Changeset: required (minor)

**RED:**

```ts
describe("Claim primitive", () => {
  it("typed Claim validates via Schema", () => {
    const c: Claim = {
      id: "c1", assertion: "X is Y",
      evidence: [{ evidenceId: "e1" }], confidence: 0.8, source: "tool",
    }
    expect(() => Schema.decodeSync(ClaimSchema)(c)).not.toThrow()
  })
})

describe("ClaimExtractor", () => {
  it("extracts claims from output with evidence refs", async () => {
    const extractor = makeClaimExtractor(defaultAdapter)
    const claims = await Effect.runPromise(
      extractor.extract("Python is the most popular language per Stack Overflow Survey.", "task-1"),
    )
    expect(claims.length).toBeGreaterThanOrEqual(1)
    expect(claims[0]!.assertion).toContain("Python")
    expect(claims[0]!.evidence.length).toBeGreaterThan(0)
  })

  it("extractor is opt-in via task.requireClaimExtraction", async () => {
    // task with requireClaimExtraction=false → no extractor calls made
    const spy = spyOnExtractor()
    await agent.run({ ..., requireClaimExtraction: false })
    expect(spy.callCount).toBe(0)
  })
})
```

**GREEN:** per north-star §12.3 exactly.

**Acceptance:** 4 tests green. Probe `claim-extraction-presence` green.

**Effort:** 8. **Risk:** MEDIUM. **Dependencies:** P2.S2.1 (verification consumes Claims), P1.S3.5 (Task primitive).

---

### Story P2.S2.3 — Typed Skill schema expansion

**Intent:** expand the Phase-1 seed `Skill` schema with the full trigger/protocol/metrics/lineage/status per north-star §12.4.

**Files:**
- `packages/core/src/skill.ts` — expand schema
- `packages/reasoning/src/strategies/kernel/utils/debrief.ts` — emit full Skill (metrics init to 0)
- `packages/memory/src/adapters/sqlite-vec/adapter.ts` — persist Skill with all fields; track metric updates
- `packages/core/tests/skill.test.ts`
- Probe: `skill-composition` (NEW) — skill can reference other skills
- Changeset: required (minor)

**RED:**

```ts
describe("typed Skill expansion", () => {
  it("accepts composite trigger (skill-requires-skill)", () => {
    const composite: Skill = {
      ...base,
      protocol: { kind: "composite", skills: [{ skillId: "s1" }, { skillId: "s2" }] },
    }
    expect(() => Schema.decodeSync(SkillSchema)(composite)).not.toThrow()
  })

  it("metrics update on activation", async () => {
    // simulate skill activation in a run
    // assert memory updates the skill's metrics.activations += 1, lastUsed = now
  })

  it("status transitions: active → decaying when success rate drops below 0.5", async () => {
    // seed a skill with 10 successes, 15 failures
    // assert decay worker marks status = "decaying"
  })

  it("negative-skill trigger (failure-pattern-match) retrievable", async () => {
    // insert a skill with trigger.kind = "failure-pattern-match", errorTag = "VerificationFailed"
    // retrieve skills matching that errorTag; assert present
  })
})
```

**GREEN:** per north-star §12.4 exactly. Decay worker: a scheduled task (or simple on-write hook) that recomputes `status` based on `metrics`.

**Acceptance:** 4 tests green. Skill corpus of 50 activations shows decay working.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P1.S3.6 (Phase 4a seed).

---

### Story P2.S2.4 — Fixture recording primitive

**Intent:** record a run (capability resolution + LLM response stream + tool response stream); replay deterministically. Enables CI-speed agent tests without live LLM calls.

**Files:**
- `packages/testing/src/fixtures/recorder.ts` (NEW) — records to JSONL
- `packages/testing/src/fixtures/replayer.ts` (NEW) — FixtureProvider Layer that substitutes LLMProvider + ToolService
- `packages/testing/src/fixtures/types.ts` (NEW) — fixture event shapes
- `packages/runtime/src/execution-engine.ts` — accept `recordFixture` / `replayFixture` options on `run`
- `packages/testing/tests/fixture-record-replay.test.ts`
- Probe: `fixture-replay-determinism` (NEW) — CI required
- Changeset: required (minor)

**RED:**

```ts
describe("fixture recording", () => {
  it("records capability + LLM + tool events to JSONL", async () => {
    const fixturePath = `/tmp/fixture-${Date.now()}.jsonl`
    await agent.run(task, { recordFixture: fixturePath })
    const contents = await Bun.file(fixturePath).text()
    const lines = contents.trim().split("\n").map((l) => JSON.parse(l))
    expect(lines.length).toBeGreaterThan(3)
    expect(lines[0]!.kind).toBe("capability")
    expect(lines.some((l: any) => l.kind === "llm-response")).toBe(true)
    expect(lines.some((l: any) => l.kind === "tool-response")).toBe(true)
  }, { timeout: 120000 })

  it("replays fixture deterministically", async () => {
    const fixturePath = await recordOnce()
    const a = await agent.run(task, { replayFixture: fixturePath })
    const b = await agent.run(task, { replayFixture: fixturePath })
    expect(a.output).toBe(b.output)
    expect(a.iterations).toBe(b.iterations)
  }, { timeout: 30000 })

  it("10 fixtures replay in <5s total", async () => {
    const start = performance.now()
    for (const f of tenFixtures) {
      await agent.run(task, { replayFixture: f })
    }
    expect(performance.now() - start).toBeLessThan(5000)
  })

  it("replay fails loudly if fixture divergence detected", async () => {
    // code change + replay that diverges at iteration N → throws with iteration info
  })
})
```

**GREEN:**

```ts
// packages/testing/src/fixtures/types.ts
export type FixtureEvent =
  | { kind: "capability"; provider: string; model: string; capability: Capability }
  | { kind: "llm-response"; iteration: number; stopReason: string; content: string; toolCalls?: unknown[] }
  | { kind: "tool-response"; toolCallId: string; result: unknown }

// packages/testing/src/fixtures/replayer.ts
export const makeReplayProviderLayer = (fixturePath: string): Layer.Layer<LLMService | ToolService> => {
  // read JSONL; on each LLM call, return next "llm-response" event in order
  // on each tool call, return matching "tool-response" event by toolCallId
  // detect divergence: if fixture says iteration 3 expects toolCall X but code requests Y, throw
}
```

**Acceptance:** 4 tests green. 10 committed fixtures in `packages/testing/fixtures/` replay under 5s. CI probe `fixture-replay-determinism` green.

**Effort:** 8. **Risk:** MEDIUM. **Dependencies:** P1.S2 Capability port.

---

### Story P2.S2.5 — Microbench gate for rule evaluation

**Intent:** decision-rule evaluation must be perf-neutral vs. scattered branches. Baseline from S0.5; Sprint 2 artifact compares.

**Files:**
- `.agents/skills/harness-improvement-loop/scripts/microbench-compare.ts` (NEW)
- `harness-reports/benchmarks/phase-2-rules-<date>.json` (generated)
- Changeset: not required

**Activity:**

1. Run microbench on `trivial-1step`, `memory-retrieval-fidelity`, `tool-heavy-5-calls`.
2. Compare medians to `baseline-2026-04-23.json` (from S0.5).
3. Assert: median delta < 1% on every scenario.
4. If any scenario regresses >1%, fix before sprint close.

**Acceptance:** comparison artifact committed; <1% regression across all scenarios.

**Effort:** 2. **Risk:** Low. **Dependencies:** P2.S1.2 + S1.3 (rule pipelines landed).

---

### Sprint P2.S2 close

**Demo:**
- `verification-retry-on-failure` probe green
- `claim-extraction-presence` probe green
- 10-fixture replay in <5s on CI
- Skill metrics update observable in memory
- Rule-evaluation perf comparison committed (<1% regression)

**Retro triggers:**
- Any fixture divergence from provider SDK updates? Document in `packages/testing/fixtures/README.md`.
- ClaimExtractor false-positive rate on probe outputs? Consider tuning the default adapter prompt.
- Skill decay: are the thresholds (0.5 success rate) the right defaults? Capture for north-star Open Question.

---

## Phase 2 close — success-gate recap (north-star §14)

| Gate | Verified by |
|---|---|
| `trivial-1step` iterations = 1 (W6 regression fixed) | Sprint 1 |
| termination-quality probe passes without burning budget | Sprint 1 |
| circuit breaker opens under simulated outage | Sprint 1 |
| idempotent-retry probe doesn't double-execute | Sprint 1 |
| Zero `catchAll(() => Effect.void)` sites remain | Sprint 1 |
| `verifyBeforeFinalize` rule fires + retry-with-nudge on failure | Sprint 2 |
| `ClaimExtractor` identifies ≥1 grounded claim per multi-step probe | Sprint 2 |
| 10 recorded fixtures replay deterministically in <5s total | Sprint 2 |

Plus shared gates:
- `bun test` + `bun run build` + `bun run typecheck` all green
- `/review-patterns` 9/9 on every PR
- Changesets added; docs synced per trigger matrix
- Microbench comparison committed — rule evaluation within 1% of baseline

**Deprecates confirmed removed:**
- `tool-formatting.ts` always-on compression (curator owns)
- `reactive-intelligence/context-compressor.ts` advisory decision (migrated to compression rule)
- `reactive-observer.ts:323` patch-applier slice (migrated to compression rule)
- 4+ scattered retry loops in `tools/skills/*` (RetryPolicyService owns)
- All `catchAll(() => Effect.void)` sites in production code (typed migration complete)

**Phase 2 outputs available for Phase 3:**
- `Rule<D, S>` primitive + `evaluatePipeline` + `DecisionMade` events (ready for Budget + Invariant to reuse)
- Named circuit-breaker registry (ready for `config.reliability.breakers` surface)
- `ToolDefinition.idempotent` annotation on 15 tools (ready for retry-rule consumption)
- Verification port (ready for dev-configurable verifier model)
- Claim + Evidence + typed Skill primitives fully shipped
- Fixture recording (ready for CI-speed regression tests across Phase 3 extractions)

Phase 3 builds on this: ExecutionEngine extraction + Budget<T> + Invariant + remaining ⭐ control-surface items.
