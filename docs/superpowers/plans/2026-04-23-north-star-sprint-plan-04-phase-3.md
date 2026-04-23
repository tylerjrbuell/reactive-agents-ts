# North Star Sprint Plan — Part 4: Phase 3 (Thin Orchestrator + Budget + Invariant + Control Surface)

**Duration:** 2 sprints (2 weeks, weeks 7-8 of the plan).
**Goal:** shrink `execution-engine.ts` from 4,404 → ≤1,800 LOC by extracting concerns into optional layers. Land the `Budget<T>` and `Invariant` primitives. Close the top-10 ⭐ control-surface items. Ship CI lint rules that make architectural regression impossible.
**Preconditions:** Phase 2 closed (Rule pipeline + Verification + Claim/Evidence + Skill + fixtures live; zero silent catches remain).

**North-star reference:** §6 Thin Orchestrator, §8 Developer Control Surface, §12.5 Budget<T>, §12.6 Invariant, §14 Phase 3, Q6/Q7/Q13/Q14 resolutions.

---

## Sprint structure

| Sprint | Week | Theme | Stories |
|---|---|---|---|
| **P3.S1** | 7 | Thin Orchestrator + Top-10 ⭐ items | 7 stories |
| **P3.S2** | 8 | Budget<T> + Invariant + CI lint rules + Cost hierarchy | 6 stories |

---

## Sprint P3.S1 — Thin Orchestrator + Control Surface

**Goal:** extract every concern that doesn't belong in "runtime orchestration" from `execution-engine.ts`. Close the remaining top-10 ⭐ items from the §8 priority list.

**Success gates:**
- `execution-engine.ts` ≤ 1,800 LOC
- `builder.ts` behavior-free (no runtime composition inside `build()`)
- At least 8 of the top-10 ⭐ items closed
- All probes still green

### Story P3.S1.1 — Extract telemetry enrichment

**Intent:** move `buildTrajectoryFingerprint`, `entropyVariance`, and the 1,200 LOC of telemetry work out of `execution-engine.ts` into `@reactive-agents/observability/telemetry`.

**Files:**
- `packages/observability/src/telemetry/trajectory-fingerprint.ts` (NEW)
- `packages/observability/src/telemetry/entropy-variance.ts` (NEW)
- `packages/observability/src/telemetry/enrich.ts` (NEW) — single enrichment entry point
- `packages/runtime/src/execution-engine.ts` — delete extracted code; call `TelemetryService.enrich(event)` instead
- `packages/observability/src/services/observability-service.ts` — add `enrich` method
- `packages/observability/tests/telemetry-enrichment.test.ts`
- Probe: `telemetry-enrichment-preserved` (NEW) — asserts post-extraction trace shape matches pre-extraction fixture
- Changeset: required (internal refactor)

**RED:**

```ts
describe("telemetry enrichment extraction", () => {
  it("trace events still carry trajectoryFingerprint after extraction", async () => {
    const events = await runAndCaptureTrace(task)
    const enriched = events.filter((e) => e.type === "AgentStep")
    for (const e of enriched) {
      expect(e.trajectoryFingerprint).toBeDefined()
      expect(e.entropyVariance).toBeDefined()
    }
  }, { timeout: 60000 })

  it("execution-engine no longer imports fingerprint/variance code", () => {
    const src = readFileSync("packages/runtime/src/execution-engine.ts", "utf8")
    expect(src).not.toContain("buildTrajectoryFingerprint")
    expect(src).not.toContain("entropyVariance")
  })

  it("extraction is perf-neutral (microbench)", async () => {
    const baseline = loadBaseline("phase-0")
    const current = await runMicrobench()
    for (const s of current) {
      const base = baseline.find((b) => b.name === s.name)!
      expect(s.medianMs).toBeLessThan(base.medianMs * 1.02)  // <2% regression
    }
  }, { timeout: 180000 })
})
```

**GREEN:**

- Move code as-is; change execution-engine to call `TelemetryService.enrich({ event, state })`.
- Assert via fixture: before/after trace shapes identical.

**Acceptance:** 3 tests green. `execution-engine.ts` drops ~1,200 LOC. Probe `telemetry-enrichment-preserved` green.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P2 fixture recording (so we can capture before/after traces).

---

### Story P3.S1.2 — Extract debrief synthesis

**Intent:** move `synthesizeDebrief` from `execution-engine.ts` into a dedicated `@reactive-agents/reasoning/debrief` layer. Opt-in via `.withDebrief()`.

**Files:**
- `packages/reasoning/src/debrief/service.ts` (NEW)
- `packages/reasoning/src/debrief/runtime.ts` (NEW) — Layer, opt-in
- `packages/runtime/src/execution-engine.ts` — delete extracted code; call `DebriefService.synthesize` if service is present
- `packages/runtime/src/builder.ts` — `.withDebrief({ enabled })` option
- `packages/reasoning/tests/debrief-extraction.test.ts`
- Probe: `debrief-parity` (NEW) — assert extraction preserved behavior
- Changeset: required (minor; new builder method)

**RED:**

```ts
describe("debrief extraction", () => {
  it("agent without .withDebrief() doesn't call debrief code", async () => {
    const spy = spyOnDebrief()
    const agent = await ReactiveAgents.create().withProvider(...).build()  // no .withDebrief()
    await agent.run(task)
    expect(spy.callCount).toBe(0)
  })

  it("agent with .withDebrief() produces same skill artifact as pre-extraction", async () => {
    const agent = await ReactiveAgents.create()....withDebrief({ enabled: true }).build()
    const result = await agent.run(task)
    expect(result.metadata.skillSummary).toBeDefined()
    // compare to pre-extraction fixture
  })
})
```

**GREEN:** extract + opt-in; test parity with fixture.

**Acceptance:** 2 tests green. Probe `debrief-parity` green.

**Effort:** 3. **Risk:** Low. **Dependencies:** P3.S1.1 (same pattern).

---

### Story P3.S1.3 — Extract classifier accuracy diffing

**Intent:** move `diffClassifierAccuracy` into `@reactive-agents/reactive-intelligence/calibration`. Optional feature, opt-in.

**Files:**
- `packages/reactive-intelligence/src/calibration/accuracy-diff.ts` (NEW)
- `packages/reactive-intelligence/src/calibration/runtime.ts` — export as optional layer
- `packages/runtime/src/execution-engine.ts` — delete extracted code
- `packages/reactive-intelligence/tests/accuracy-diff.test.ts`
- Changeset: required (internal refactor)

**RED / GREEN:** identical pattern to S1.1/S1.2.

**Acceptance:** accuracy-diff tests green; extraction preserves behavior.

**Effort:** 3. **Risk:** Low. **Dependencies:** P3.S1.1.

---

### Story P3.S1.4 — Extract RI skill loading

**Intent:** move `loadObservations` and `skillFragmentToProceduralEntry` from `execution-engine.ts` into `@reactive-agents/reactive-intelligence/skills`.

**Files:**
- `packages/reactive-intelligence/src/skills/loader.ts` (NEW)
- `packages/reactive-intelligence/src/skills/fragment-to-procedural.ts` (NEW)
- `packages/runtime/src/execution-engine.ts` — delete extracted code
- `packages/reactive-intelligence/tests/skill-loading.test.ts`
- Changeset: required (internal refactor)

**Pattern identical to prior extractions.**

**Effort:** 3. **Risk:** Low. **Dependencies:** P3.S1.1.

---

### Story P3.S1.5 — Extract Cortex reporter integration

**Intent:** move Cortex WebSocket reporter wiring from `execution-engine.ts` into `@reactive-agents/cortex/client` as an optional layer.

**Files:**
- `packages/cortex-client/src/reporter-layer.ts` (or wherever Cortex client lives) — expose as optional Layer
- `packages/runtime/src/execution-engine.ts` — delete extracted code
- `packages/runtime/src/builder.ts` — `.withCortexReporter({ url })` wires the layer
- `packages/runtime/tests/cortex-reporter-extraction.test.ts`
- Changeset: required (minor)

**Pattern identical.** Takes care of the 11 Cortex-related `catchAll` sites from S0.2 (those stay typed/observable; just moved into the cortex package).

**Effort:** 3. **Risk:** Low. **Dependencies:** P3.S1.1.

---

### Story P3.S1.6 — Top-10 ⭐ items landed

**Intent:** close the remaining top-10 ⭐ items from §8 of the north-star that Phases 1-2 didn't already handle. Per the P0-P3 ordering:

Already shipped by end of P2:
- #1 W4 max-iterations honored (P1.S1.4)
- #2 `num_ctx` from Capability (P1.S2.4)
- #3 Tool `trustLevel` (P1.S3.1)
- #4 Tool `capabilities` scope (schema part — P1.S3.1)
- #5 Tool `idempotent` (P2.S1.5)
- #6 Custom termination rules (P2.S1.2)
- #8 Log redaction default (P0.S0.3)
- #9 Retry policy per failure type (P2.S1.4)

Remaining for Phase 3:
- **#7 Enabled-interventions allowlist** (this story)
- **#10 Sub-agent iteration ceiling** (this story)

Plus the capability-scope **enforcement** piece (#4 runtime half — P3.S1.7 below).

**Files:**
- `packages/runtime/src/agent-config.ts` — add `reactiveIntelligence.enabledInterventions: readonly InterventionKind[]`
- `packages/runtime/src/agent-config.ts` — add `subAgents.maxIterations: number`, `subAgents.maxRecursionDepth: number`
- `packages/reactive-intelligence/src/controller/dispatcher.ts` — consult allowlist
- `packages/runtime/src/execution-engine.ts` — raise sub-agent `maxIterations` ceiling from hardcoded 3
- Tests: `packages/reactive-intelligence/tests/interventions-allowlist.test.ts`, `packages/runtime/tests/sub-agent-iterations.test.ts`
- Changeset: required (minor)

**RED:**

```ts
describe("enabled interventions allowlist", () => {
  it("dispatcher skips interventions not on allowlist", async () => {
    const agent = await ReactiveAgents.create()
      .withReactiveIntelligence({ enabledInterventions: ["early-stop"] })  // only this one
      .build()
    const events = await captureTrace(agent.run(flakyTask))
    const dispatched = events.filter((e) => e.type === "InterventionDispatched")
    expect(dispatched.every((e) => e.interventionKind === "early-stop")).toBe(true)
  })

  it("defaults to all interventions when not specified", async () => {
    // behavior unchanged vs. pre-story
  })
})

describe("sub-agent iteration ceiling", () => {
  it("withSubAgents({ maxIterations: 10 }) is honored", async () => {
    // sub-agent probe runs up to 10 iterations, not silently capped at 3
  })
})
```

**GREEN:** surface config fields, thread through dispatcher and sub-agent factory.

**Acceptance:** 3 tests green; sub-agents no longer silently capped at 3.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P1 Invariant (config flows through).

---

### Story P3.S1.7 — Tool `capabilities` scope enforcement at runtime

**Intent:** Q6 resolution: warn-only for one minor release, enforce in next. Phase 3 ships the WARN-ONLY enforcement (the schema landed in Phase 1).

**Files:**
- `packages/tools/src/sandbox/capability-enforcer.ts` (NEW)
- `packages/tools/src/services/tool-service.ts` — run enforcer before tool call
- `packages/tools/tests/capability-enforcement.test.ts`
- Probe: `capability-scope-enforcement-warn` (NEW)
- Changeset: required (minor; warn-mode)

**RED:**

```ts
describe("capability scope enforcement (warn mode)", () => {
  it("logs warning when tool accesses undeclared env var", async () => {
    const tool = defineTool({
      name: "reads-unknown-env",
      capabilities: { env: ["DECLARED_VAR"] },
      handler: () => {
        const x = process.env.UNDECLARED_VAR  // should warn
        return Effect.succeed({ value: x })
      },
    })
    const warnings = captureWarnings()
    await agent.withTools({ tools: [tool] }).run(task)
    expect(warnings.some((w) => w.includes("UNDECLARED_VAR") && w.includes("undeclared"))).toBe(true)
  })

  it("does NOT abort in warn mode (only logs)", async () => {
    // same test; assert task still completes
  })

  it("raises ToolCapabilityViolation in enforce mode (next release)", async () => {
    // config.tools.capabilityEnforcement = "enforce" (feature flag for next release)
    // assert error raised
  })
})
```

**GREEN:** Node.js `AsyncLocalStorage` scopes `process.env` access per tool invocation. Compare actual reads to declared `capabilities.env`. Warn-only by default; feature-flag for enforce.

**Acceptance:** 3 tests green. Probe `capability-scope-enforcement-warn` green.

**Effort:** 8. **Risk:** MEDIUM-HIGH (process.env interception). **Dependencies:** P1.S3.1 (trustLevel + capabilities schema).

---

### Sprint P3.S1 close

**Demo:**
- `execution-engine.ts` ≤ 1,800 LOC (assert in CI)
- All 4 extractions (telemetry, debrief, classifier, RI skills, Cortex) committed
- Top-10 ⭐ items closed at least 8/10
- Capability-scope warnings visible in probe logs

**Retro:**
- Did any extraction break a cross-package test? Document in Architecture Debt.
- Did sub-agent iteration raise expose a latent bug? (previously masked by the cap)

---

## Sprint P3.S2 — Budget<T> + Invariant + CI lint + Cost hierarchy

**Goal:** ship the two remaining atomic primitives. Land CI lint rules that make architectural regression impossible going forward. Unify cost + time + token + iteration budgets under one primitive.

**Success gates:**
- `Budget<T>` primitive adopted for cost, tokens, iterations, tool-calls (4 dimensions minimum)
- All 10 default invariants pass on `trivial-1step` and `memory-retrieval-fidelity`
- Invariant-check perf overhead <1% vs. Phase-0 baseline
- Zero module-level numeric constants outside `@reactive-agents/core/constants`
- Zero `process.env` reads outside `config-resolver.ts`
- `builder.ts` behavior-free (lint-verified)

### Story P3.S2.1 — `Budget<T>` primitive

**Intent:** generic `Budget<T>` per north-star §12.5. Immutable (consumption returns new Budget). Multiple dimensions (USD, Tokens, Milliseconds, count).

**Files:**
- `packages/core/src/budget/budget.ts` (NEW) — `Budget<T>` interface + factory
- `packages/core/src/budget/dimensions.ts` (NEW) — concrete types (USD, Tokens, Milliseconds, Count)
- `packages/core/src/budget/events.ts` (NEW) — `BudgetConsumed`, `BudgetDegraded`, `BudgetExhausted`
- `packages/core/tests/budget.test.ts`
- Changeset: required (minor)

**RED:**

```ts
describe("Budget<T>", () => {
  it("consume returns a new immutable Budget", () => {
    const b = makeBudget<Tokens>({ limit: 1000, dimension: "tokens" })
    const b2 = b.consume(300)
    expect(b.consumed).toBe(0)  // original unchanged
    expect(b2.consumed).toBe(300)
    expect(b2.remaining).toBe(700)
  })

  it("exhausted() flips after consumption exceeds limit", () => {
    const b = makeBudget<Tokens>({ limit: 100, dimension: "tokens" })
    expect(b.exhausted()).toBe(false)
    const b2 = b.consume(150)
    expect(b2.exhausted()).toBe(true)
  })

  it("percentRemaining returns 0..1", () => {
    const b = makeBudget({ limit: 100 }).consume(25)
    expect(b.percentRemaining()).toBe(0.75)
  })

  it("emits BudgetConsumed event on consume", async () => {})
  it("emits BudgetExhausted when exhausted flips", async () => {})

  it("typed dimensions compose independently", () => {
    const cost: CostBudget = makeBudget({ limit: 1.00, dimension: "usd" })
    const time: TimeBudget = makeBudget({ limit: 300_000, dimension: "ms" })
    // assert types can coexist in a record
  })
})
```

**GREEN:** per north-star §12.5 exactly.

**Acceptance:** 6 tests green.

**Effort:** 3. **Risk:** Low. **Dependencies:** none (pure core primitive).

---

### Story P3.S2.2 — Hierarchical budget composition

**Intent:** `BudgetHierarchy` with session → task → iteration nesting. Inner consumption propagates to outer. Migrate existing scattered budget fields (`cost.budget`, `maxIterations`, tier-derived tokens) to the primitive.

**Files:**
- `packages/core/src/budget/hierarchy.ts` (NEW)
- `packages/runtime/src/agent-config.ts` — replace scattered budget fields with `BudgetHierarchy`
- `packages/cost/src/services/cost-service.ts` — wire to `CostBudget` from hierarchy
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — read iteration budget from hierarchy
- `packages/core/tests/budget-hierarchy.test.ts`
- Probe: `budget-hierarchical-enforcement` (NEW)
- Changeset: required (breaking change for cost API — must be carefully noted)

**RED:**

```ts
describe("BudgetHierarchy", () => {
  it("inner consumption propagates to outer", () => {
    const h = makeHierarchy({
      session: { tokens: 10_000, cost: 1.00 },
      task: { tokens: 3_000, cost: 0.30 },
      iteration: { tokens: 500 },
    })
    const h2 = h.consumeIteration({ tokens: 400 })
    expect(h2.iteration.tokens.consumed).toBe(400)
    expect(h2.task.tokens.consumed).toBe(400)  // propagated
    expect(h2.session.tokens.consumed).toBe(400)  // propagated
  })

  it("any-level exhaustion bubbles up", () => {
    const h = makeHierarchy({ session: { tokens: 100 }, task: { tokens: 500 }, iteration: { tokens: 500 } })
    // consume 150 at iteration level
    const h2 = h.consumeIteration({ tokens: 150 })
    expect(h2.session.tokens.exhausted()).toBe(true)
    expect(h2.task.tokens.exhausted()).toBe(false)  // task has 500
    expect(h2.exhaustedLevel).toBe("session")
  })

  it("supports per-tier defaults from Q14 resolution", () => {
    const local = defaultBudgetForTier("local")
    expect(local.task.tokens.limit).toBe(50_000)
    expect(local.task.iterations.limit).toBe(15)
  })
})
```

**GREEN:** per north-star §12.5 exactly + Q14 defaults.

**Acceptance:** 3 tests green. Probe `budget-hierarchical-enforcement` green (session budget cuts off a task that would have succeeded under task-only budget).

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P3.S2.1.

---

### Story P3.S2.3 — `Invariant` primitive + 10 default invariants

**Intent:** typed runtime-contract primitive per north-star §12.6, plus the 10 default invariants and their Q13-resolved enforcement levels.

**Files:**
- `packages/core/src/invariant/invariant.ts` (NEW) — `Invariant<S>` interface
- `packages/core/src/invariant/check.ts` (NEW) — `checkInvariants` helper
- `packages/core/src/invariant/defaults.ts` (NEW) — the 10 default invariants per Q13
- `packages/core/src/invariant/events.ts` (NEW) — `InvariantViolated`, `InvariantChecked`
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — invoke `checkInvariants` once per iteration
- `packages/core/tests/invariant.test.ts`
- `packages/reasoning/tests/invariant-integration.test.ts`
- Probe: `invariant-violation-halts` (NEW)
- Changeset: required (minor)

**RED:**

```ts
describe("Invariant primitive", () => {
  it("halt invariant stops the run on violation", async () => {
    const inv: Invariant<KernelState> = {
      name: "no-empty-output",
      holds: (s) => (s.output ?? "").length > 0,
      message: () => "output was empty",
      severity: "error",
      enforcement: "halt",
    }
    const agent = await makeTestAgent({ invariants: [inv] })
    await expect(agent.run(emptyOutputTask)).rejects.toThrow(/InvariantViolated/)
  })

  it("log invariant records without halting", async () => {
    const inv: Invariant<KernelState> = { ..., enforcement: "log", severity: "warn" }
    const result = await agent.run(someTask)
    expect(result.status).toBe("done")
    expect(capturedEvents.some((e) => e.type === "InvariantViolated")).toBe(true)
  })

  it("all 10 default invariants pass on trivial-1step", async () => {
    const agent = await makeTestAgent({ invariants: defaultInvariants })
    const result = await agent.run(trivialTask)
    // assert no InvariantViolated with severity=error
    expect(result.status).toBe("done")
  })

  it("invariant-check overhead <1% vs. Phase-0 baseline", async () => {
    const baseline = loadPhase0Baseline()
    const current = await runMicrobench({ withInvariants: true })
    for (const s of current) {
      const base = baseline.find((b) => b.name === s.name)!
      expect(s.medianMs).toBeLessThan(base.medianMs * 1.01)
    }
  }, { timeout: 180000 })
})
```

**GREEN:** default invariants per Q13 map:

```ts
export const defaultInvariants: readonly Invariant<KernelState>[] = [
  // halt — security-critical
  { name: "untrusted-never-in-system-prompt", enforcement: "halt", severity: "error",
    holds: (s) => !containsUntrustedContent(s.systemPrompt),
    message: () => "untrusted tool content in system prompt — injection risk" },

  { name: "capability-scope-respected", enforcement: "halt", severity: "error",
    holds: (s) => s.toolCalls.every((tc) => scopeRespected(tc, s.tools)),
    message: () => "tool call violated declared capabilities" },

  { name: "budgets-consistent", enforcement: "halt", severity: "error",
    holds: (s) => everyBudgetWithinLimits(s.budgets),
    message: (s) => `budget exceeded: ${describeOverflow(s.budgets)}` },

  // log — soft
  { name: "every-claim-has-evidence", enforcement: "log", severity: "warn",
    holds: (s) => (s.claims ?? []).every((c) => c.evidence.length > 0),
    message: (s) => `${countUngrounded(s.claims)} ungrounded claim(s)` },

  { name: "tool-call-respects-idempotency", enforcement: "log", severity: "warn",
    holds: (s) => !hasDoubleExecutedNonIdempotent(s),
    message: () => "non-idempotent tool executed more than once" },

  // telemetry-only — diagnostic
  { name: "decision-rule-fired-per-decision-site", enforcement: "telemetry-only", severity: "info",
    holds: (s) => everyDecisionHasEvent(s),
    message: () => "decision site without DecisionMade event" },

  // log — default for rest
  { name: "state-meta-consistent", enforcement: "log", severity: "info", ... },
  { name: "tool-observations-typed", enforcement: "log", severity: "info", ... },
  { name: "message-window-respects-budget", enforcement: "log", severity: "warn", ... },
  { name: "memory-retrieval-within-topK", enforcement: "log", severity: "info", ... },
]
```

**Config surface:** `config.invariants.enabled = false` by default in v1.0 (Q13 "opt-in initially"); flip to `true` in v1.1 when perf verified.

**Acceptance:** 4 tests green. Probe `invariant-violation-halts` green. Microbench shows <1% overhead.

**Effort:** 8. **Risk:** MEDIUM-HIGH (perf-sensitive). **Dependencies:** P3.S2.1 (Budget — `budgets-consistent` invariant), P3.S1.6 (capability enforcement — `capability-scope-respected` invariant).

---

### Story P3.S2.4 — CI lint rules

**Intent:** architectural regressions become build failures. Three lint rules:

1. No `process.env` reads outside `@reactive-agents/core/config-resolver.ts`
2. No module-level numeric constants outside `@reactive-agents/core/constants`
3. No behavior inside `builder.ts` (only `(config, opts) => config` mutations)

**Files:**
- `.agents/skills/code-review/scripts/lint-no-process-env.ts` (NEW) — ripgrep wrapper
- `.agents/skills/code-review/scripts/lint-no-module-constants.ts` (NEW)
- `.agents/skills/code-review/scripts/lint-builder-behavior-free.ts` (NEW)
- `.github/workflows/lint-architecture.yml` (NEW) — required CI check
- `packages/core/src/constants/index.ts` (NEW) — migrate known constants here
- Changeset: required (minor; CI change)

**RED:**

```ts
describe("CI lint: no process.env outside config-resolver", () => {
  it("grep finds zero hits outside the allowlist", async () => {
    const hits = await Bun.$`rg "process\\.env" packages/ -g '!config-resolver.ts' -g '!**/tests/**'`.text()
    expect(hits.trim()).toBe("")
  })
})

describe("CI lint: no module-level numeric constants outside /constants", () => {
  it("grep finds zero hits", async () => {
    const hits = await Bun.$`rg "^const \\w+\\s*=\\s*\\d+" packages/ -g '!**/constants/**' -g '!**/tests/**' -g '!**/fixtures/**'`.text()
    // Filter out allowed constants (tier-default tables, schema defaults documented as constants)
    expect(filterAllowed(hits).trim()).toBe("")
  })
})

describe("CI lint: builder.ts behavior-free", () => {
  it("builder.ts contains only config mutations", async () => {
    const src = readFileSync("packages/runtime/src/builder.ts", "utf8")
    // Heuristic: no Effect.gen calls, no Layer composition
    expect(src).not.toMatch(/Layer\.(merge|provide|succeed)/)
    expect(src).not.toContain("Effect.gen")
    // Every with* method body is a config mutation
  })
})
```

**GREEN:**

- Build scripts as Bun CLI tools; wire into a GitHub Actions workflow.
- Migrate known hardcoded constants (§2.4 top-15 list from north-star) to `@reactive-agents/core/constants`.
- Adjust `builder.ts` if anything still violates the behavior-free rule.

**Acceptance:**
- 3 lint rule tests green on main.
- CI workflow blocks merge on violation.
- `@reactive-agents/core/constants` exports the 15 top constants with named references.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P1 Invariant (builder already mostly behavior-free), P3.S1 extractions.

---

### Story P3.S2.5 — Cost budget hierarchy refactor

**Intent:** `config.cost.*` fields migrate to `BudgetHierarchy`. `withCostTracking({ perIteration, perTask, perSession, perTenant, onBudgetExceeded })` surfaces the full hierarchy + Q7-resolved default.

**Files:**
- `packages/cost/src/services/cost-service.ts` — consume `BudgetHierarchy`
- `packages/runtime/src/builder.ts` — `.withCostTracking` expanded
- `packages/runtime/src/agent-config.ts` — full cost hierarchy schema
- `packages/cost/tests/cost-hierarchy.test.ts`
- `apps/docs/src/content/docs/reference/builder-api.md` — document
- Changeset: required (minor; Q7 + Q14 land)

**RED:**

```ts
describe("cost budget hierarchy", () => {
  it(".withCostTracking({ perTask: 0.30, perSession: 5 }) wires to hierarchy", async () => {})
  it("onBudgetExceeded: 'warn' is the default for opt-in (Q7)", async () => {})
  it("onBudgetExceeded: 'degrade-model' downshifts tier", async () => {})
  it("onBudgetExceeded: 'fail' aborts with CapacityError", async () => {})
  it("per-tier default limits match Q14 resolution", () => {})
})
```

**GREEN:** per Q7 + Q14 + north-star §12.5 exactly.

**Acceptance:** 5 tests green. Docs updated.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P3.S2.1, P3.S2.2.

---

### Story P3.S2.6 — Remaining dev-control surface cleanup

**Intent:** the §6/§8 table items not yet closed that don't require breaking changes (strategy-specific synthesis overrides documented; adaptive heuristic injectable; MCP allowlist; retention policy; sandbox config documented).

**Files:** scattered — per §8 table row targets.

**RED:** existence tests for each config field — "does `config.reasoning.adaptiveHeuristic` accept an injectable service?" etc.

**GREEN:** each config field surfaces with a typed shape + JSDoc + one test.

**Acceptance:** 6+ tests green; `/review-patterns` 9/9.

**Effort:** 5. **Risk:** Low. **Dependencies:** P3.S2.1, S2.2.

---

### Story P3.S2.7 — v1.0 Migration guide (Q2 deliverable)

**Intent:** Q2 resolved "clean 1.0 cut with migration guide." Write the guide as a first-class artifact users will lean on.

**Files:**
- `apps/docs/src/content/docs/guides/migration-v0-to-v1.md` (NEW)
- `CHANGELOG.md` — reference the guide in the v1.0.0 release section
- `README.md` — link from the badges row
- `docs/spec/docs/15-design-north-star.md` — Iteration Log cross-link
- Changeset: required (minor, docs addition)

**Content checklist** (spine drawn from Q2 code-example diffs in earlier conversation):

1. **Builder: unchanged API, fixed semantics** — `withReasoning({ maxIterations })` now honored; `recall` can be dropped from `allowedTools`; most users delete `withContextProfile()` entirely.
2. **Tool definition: `trustLevel` + `capabilities` + `idempotent`** — side-by-side BEFORE/AFTER; explicit "minimum upgrade is one-line `trustLevel`".
3. **Context profile: capability-driven** — remove `tier` from user input; `numCtx` surfaced.
4. **Memory: port replaces tiers** — `.withMemory({ adapter, retention, retrievalTopK })`.
5. **Custom termination rules: new capability** — example `markdown-table-deliverable` rule.
6. **Reliability config: `.withReliability({ retry, circuitBreaker })`** — per-error-type retry policies.
7. **Cost hierarchy: `.withCostTracking({ perIteration, perTask, perSession, onBudgetExceeded })`**.
8. **Log redaction: on by default** — custom pattern extension example.
9. **Task primitive: typed replacement for string** — minimum upgrade + full typed-task example.
10. **Error handling: typed `FrameworkError`** — migration from `catchAll` patterns.

Each section has (i) what changed, (ii) BEFORE code snippet, (iii) AFTER code snippet, (iv) minimum-viable-upgrade note, (v) full-opt-in example.

**Acceptance:**
- Docs page builds (`bun run docs:build`)
- Every AFTER snippet compiles against v1.0 types (doctested via `bun run docs:check`)
- Links from CHANGELOG.md + README.md resolve

**Effort:** 3. **Risk:** Low. **Dependencies:** every prior P1-P3 story shipped (guide reflects the real surface).

---

### Sprint P3.S2 close

**Demo:**
- `Budget<T>` adopted in 4+ dimensions (cost, tokens, iterations, tool-calls)
- 10 default invariants passing `trivial-1step` + `memory-retrieval-fidelity`
- CI lint rules active; main branch passes
- `execution-engine.ts` LOC: pre-P3 4,404 → ≤1,800
- `builder.ts` lint-verified behavior-free

**Retro triggers:**
- Any invariant fired unexpectedly on a previously-green probe? (indicates latent bug or bad default; tune)
- Budget hierarchy: did session budget trip on a task that should have completed? (Q14 defaults may need re-review)

---

## Phase 3 close — success-gate recap (north-star §14)

| Gate | Verified by |
|---|---|
| `builder.ts` behavior-free | CI lint rule |
| `execution-engine.ts` ≤ 1,800 LOC | LOC count assertion in CI |
| Zero module-level numeric constants outside `/constants` | CI lint rule |
| At least 8 of top-10 ⭐ items closed | Sprint P3.S1.6 |
| `Budget<T>` adopted for 4+ dimensions | Sprint P3.S2.2 |
| All 10 default invariants pass on `trivial-1step` + `memory-retrieval-fidelity` | Sprint P3.S2.3 |
| Invariant-check overhead <1% vs. Phase-0 baseline | Sprint P3.S2.3 microbench |

Plus shared gates:
- `bun test` + `bun run build` + `bun run typecheck` all green
- `/review-patterns` 9/9 on every PR
- Changesets added; docs synced
- All P0-P2 probes still green (no regressions)

**Phase 3 outputs: v1.0 cut-ready**

After Phase 3 closes, the framework has:
- 1 invariant + 3 ports + 2 disciplines + 5 primitives fully shipped
- Probes gating merges across all architectural changes
- Default log redactor, typed errors, and invariants structurally protecting security + correctness
- Documented configuration surface covering the top-10 ⭐ dev-control items
- Clean `builder.ts`, thin `execution-engine.ts`, no silent catches, no hidden constants

This is the **v1.0 cut point**. Release workflow:
1. Run full `bun test` + `bun run build` + `bun run docs:build`
2. All probes required-green
3. `bun run changeset` → major release
4. `ROADMAP.md` moves P0-P3 items from "target" → "✅ Released"
5. `CHANGELOG.md` auto-generated via changesets action
6. Cut `v1.0.0` tag

**Phase 4 is conditional** and does not gate v1.0. If the Phase-0 debrief-quality spike was positive, Phase 4 proceeds; otherwise it re-scopes to a separate ~3-week project.
