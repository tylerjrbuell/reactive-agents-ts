# North Star Sprint Plan — Part 0: Overview

**Source of truth:** `docs/spec/docs/15-design-north-star.md` (v2.3, 2026-04-23).
**Companion files:**
- Part 1 — Phase 0 (Foundations): `2026-04-23-north-star-sprint-plan-01-phase-0.md`
- Part 2 — Phase 1 (Invariant + Capability + Curator + Task + 4a): `2026-04-23-north-star-sprint-plan-02-phase-1.md`
- Part 3 — Phase 2 (Decision Rules + Reliability + Verification + Claim/Evidence + Skill + Fixtures): `2026-04-23-north-star-sprint-plan-03-phase-2.md`
- Part 4 — Phase 3 (Thin Orchestrator + Budget + Invariant + Control Surface): `2026-04-23-north-star-sprint-plan-04-phase-3.md`
- Part 5 — Phase 4 (Closed Learning Loop, conditional): `2026-04-23-north-star-sprint-plan-05-phase-4.md`

---

## 1. Goal

Ship the north-star v2.3 architecture in 4 phases (plus conditional Phase 4), refactor-forward, no `v2` branch, no kernel rewrite. End state:

- **1 invariant** (`AgentConfig × Capability → ResolvedRuntime` pure)
- **3 ports** (Capability per-model, AgentMemory, Verification)
- **2 disciplines** (Decision Rules, Thin Orchestrator)
- **5 atomic primitives** (Task, Claim + Evidence, typed Skill, Budget<T>, Invariant)

Every change gated by (construction | test | telemetry) guarantee, every deliverable tied to a named probe-suite success gate.

---

## 2. Scope ground rules (carry across every sprint)

These are non-negotiable for the full sequence. Violations block merge.

### 2.1 Anti-goals (§13 of north-star)

- NO `v2` branch / fork
- NO kernel rewrite (post-April-3 phase factoring is preserved)
- NO new strategies or providers during Phase 0-3
- NO new tests that mock the LLM during Phase 0-3 (probes + pure-function contract tests only)
- NO Pi-style operating modes / extensions (deferred to v1.2)

### 2.2 Quality gates shared by every sprint

Per `AGENTS.md` Quality Gates table — every story's "done" requires:

| Gate | Check | Must |
|---|---|---|
| Tests pass | `bun test <touched-package>` | 100% green |
| Build clean | `bun run build` | No errors across 27 packages |
| Typecheck | `bun run typecheck` | 54/54 packages clean |
| Pattern compliance | `/review-patterns <files>` | 9/9 pass |
| Docs sync | Per §2.3 below | Per-change rules |
| Changeset | `bun run changeset` | One per PR touching public API |
| `AGENTS.md` Terminal Rules | Timeouts on tests, never pipe long-running | Enforced |

### 2.3 Documentation sync (AGENTS.md Documentation Workflow)

Every sprint story updates the right docs per the trigger matrix:

| Trigger | Files to update |
|---|---|
| New package | `AGENTS.md` package map, `README.md`, `CHANGELOG.md`, `.claude/skills/architecture-reference`, docs sidebar |
| New/changed builder method | `README.md`, `apps/docs/src/content/docs/reference/builder-api.md`, `AGENTS.md` |
| New CLI command | `README.md`, `apps/docs/src/content/docs/reference/cli.md`, `AGENTS.md` |
| Test count changed | `AGENTS.md` snapshot section, `README.md` |
| New reasoning strategy | `README.md`, `apps/docs/src/content/docs/guides/reasoning.md` |
| New feature page | `apps/docs/src/content/docs/features/<name>.md` or `guides/<name>.md` |
| API signature change | Grep `apps/docs/` for old signature, update all hits |

### 2.4 Release cadence

- `bun run changeset` on every PR that touches user-facing behavior.
- `changesets/action` opens "chore: version packages" PRs automatically — do not manually bump `package.json` or edit `CHANGELOG.md`.
- 22-package fixed group — all packages bump together.
- Phase-end milestones cut releases: P0 ships as a patch, P1 as a minor, P2+P3 may ship as a major v1.0 cut (Q2 resolution: clean 1.0 cut).

### 2.5 Effect-TS coding standards (CODING_STANDARDS.md + `.claude/skills/effect-ts-patterns`)

Load the `effect-ts-patterns` skill before writing code in any sprint. Non-negotiable:

- No `throw`, no raw `await` — `Effect.gen` with `yield*` exclusively
- No `any` casts — `unknown` with guards or proper generics
- Services via `Context.Tag` + `*Service` naming
- `Layer` composition for dependency injection
- `Schema.Struct` for data validation (not plain `interface` for runtime checks)
- `Ref` for mutable state inside Effect
- `JSDoc` on every public API
- Tests use `--timeout 15000` minimum; server teardown always calls `.stop(true)` (`agent-tdd` skill)

### 2.6 Runtime policy (AGENTS.md Runtime Policy)

- Bun ≥1.0.0 required for tests/runtime.
- Prefer `node:` built-ins (`node:crypto`, `node:fs/promises`, `node:child_process`) in **new** code — keeps files one import-swap from Node compatibility.
- Reserve `bun:sqlite`, `Bun.serve`, `Bun.spawn` for files already using them. Do NOT introduce new Bun-specific APIs.

---

## 3. TDD discipline — how every story is structured

Per the `agent-tdd` skill + the user's explicit "TDD-focused" direction:

### 3.1 The Red → Green → Refactor order, per story

1. **RED (tests first, ~40-50% of story time).**
   - Write failing tests that describe the contract.
   - Minimum coverage per story: 1 unit test per branch, 1 integration test per public API, 1 probe assertion per cross-package effect.
   - Every test file uses `--timeout 15000` minimum.
   - Tests that spin up servers: always `.stop(true)` in `afterEach` / `onExit`.
   - Use `Effect.flip` for error-path testing (don't try/catch Effects).
   - Use `@reactive-agents/testing` mocks for `LLMService`, `ToolService`, `EventBus` — NOT bespoke mocks.

2. **GREEN (minimal impl, ~30-40% of story time).**
   - Write the smallest code that passes the tests.
   - Effect-TS patterns only (§2.5).
   - Layer factory in `src/runtime.ts` per package convention.
   - Public exports only via `src/index.ts`.

3. **REFACTOR (~15-20% of story time).**
   - Collapse duplication, extract helpers, inline names.
   - Every type must resolve (no `any`, no `unknown` leaking to public API).
   - `/review-patterns` compliance: 9/9.

4. **INTEGRATION (~5-10% of story time).**
   - Add one integration test that hits the probe suite or a live cross-package path.
   - Update one CI success gate per north-star §14 if the story maps to it.

### 3.2 Test layer mix (AGENTS.md anti-goal enforcement)

Per north-star §14 anti-goal: **NO new tests that mock the LLM during Phases 0-3.** Tests are either:

- **Contract tests** — pure-function rules, no LLM, no fixtures. Run in milliseconds.
- **Probe tests** — end-to-end with real LLM OR recorded fixture (once fixture recording ships in P2). Run in seconds.
- **Unit tests with `@reactive-agents/testing` mocks** — for services that don't call the LLM. Use `mock.module()` carefully (Bun's mock.module only intercepts ES import(), not CJS require()).

### 3.3 Probe gates

Each phase's success gate (north-star §14) maps to probes that must pass:

| Phase | Blocking probes | New probes to build |
|---|---|---|
| P0 | `trivial-1step`, `memory-recall-invocation`, `memory-retrieval-fidelity` | `num-ctx-sanity`, `semantic-memory-population`, `capability-probe-on-boot`, `error-swallowed-wiring` |
| P1 | P0 + new | `task-primitive-roundtrip`, `context-curator-untrusted-rendering`, `w4-max-iterations` |
| P2 | P1 + new | `verification-retry-on-failure`, `claim-extraction`, `idempotent-retry`, `fixture-replay-determinism`, `termination-rule-ordering` |
| P3 | P2 + new | `budget-hierarchical-enforcement`, `invariant-violation-halts`, `capability-scope-enforcement` |
| P4 | P3 + new | `skill-reuse-iteration-delta`, `skill-decay` |

Any regression on previous probes blocks the current sprint.

---

## 4. Dependency graph across phases

Build order derives from `AGENTS.md` Package Dependency Tree. Intra-phase, stories follow this rule: tests-first can begin in parallel; implementation must wait for dependent test suites to pass.

```
Phase 0 — Foundations (no downstream blockers)
    ├── S0.1 Typed error taxonomy (blocks P1 onward)
    ├── S0.2 ErrorSwallowed event + 10-site instrumentation
    ├── S0.3 Log redactor + fixtures
    ├── S0.4 CI-gate probe suite
    ├── S0.5 Microbench baseline
    ├── S0.6 MEMORY.md reconciliation
    └── S0.7 Debrief-quality spike (decides P4 scope)

Phase 1 — Architectural spine (3 sprints)
    Sprint 1: Invariant (builder → config routing) — depends on S0.1
    Sprint 2: Capability port — depends on Sprint 1
    Sprint 3: AgentMemory wiring + ContextCurator + Task primitive + trustLevel + 4a passive capture

Phase 2 — Rules + Reliability (2 sprints)
    Sprint 1: Decision Rules (terminate/compress/retry/intervene) + typed error migration + circuit breakers
    Sprint 2: Verification port + Claim/Evidence + typed Skill + fixture recording

Phase 3 — Orchestrator + Control Surface (2 sprints)
    Sprint 1: ExecutionEngine extraction — telemetry/debrief/classifier/skill-loading/Cortex → layers
    Sprint 2: Budget<T> + Invariant + remaining ⭐ control surface items + CI lint rules

Phase 4 — Closed learning loop (2 sprints, conditional on P0 spike)
    Sprint 1: Phase 4b active skill retrieval — curator reads skills at task start
    Sprint 2: Skill decay + negative skills (failure-pattern matching)
```

**Critical-path stories** (slippage here blocks the whole sequence):

- S0.1 Typed error taxonomy — every subsequent Effect `catchTag` depends on these types
- P1.Sprint1 Invariant — every subsequent story assumes config flows through builder→config→runtime
- P1.Sprint2 Capability port — every tier-aware or num_ctx-aware decision rests on this

Non-critical stories can slip by one sprint without domino effect:

- S0.6 MEMORY.md reconciliation
- S0.7 Debrief-quality spike (just decides P4 scope)
- Any remaining ⭐ item in P3 Sprint 2

---

## 5. Team structure (AGENTS.md Multi-Agent Coordination)

### 5.1 Roles per sprint

| Role | Does | Doesn't |
|---|---|---|
| **Lead** | Plans the sprint, assigns stories, reviews PRs, integrates, runs daily `bun test` + `bun run build`, maintains the sprint board | Writes package code directly |
| **Builder(s)** | Implements stories: RED tests first, GREEN impl, REFACTOR, INTEGRATION. One story at a time. | Makes cross-package architectural decisions without Lead approval |
| **Tester** | Writes probe tests, validates probe-suite health, catches regressions, owns the microbench artifact | Skips pattern review |

Parallelization rule (AGENTS.md): packages with no dependency relationship can be built in parallel. Dependents wait. Run workspace-wide `bun run build` after each package completes.

### 5.2 Handoff protocol (AGENTS.md)

At every story close, record:

1. What was completed (files created/modified, paths)
2. What was verified (tests passed with counts, build clean, typecheck clean)
3. What's next (dependent stories now unblocked)
4. Any known issues or spec deviations

Stored in the sprint board (recommend a lightweight `docs/superpowers/plans/sprint-log-<phase>-sprint-<N>.md` file updated daily).

---

## 6. Sprint cadence

- **Sprint length:** 1 week.
- **Sprint 0 day:** planning + story split + RED-side test draft + probe-suite baseline.
- **Days 1-4:** RED → GREEN → REFACTOR per story.
- **Day 5:** INTEGRATION + probe run + demo + retro.

Demo artifact: updated success-gate probe outputs committed to `harness-reports/sprint-<phase>-<N>-<date>.json`.

Retro artifact: one paragraph appended to `.agents/MEMORY.md` under a "Running Issues Log" section per the existing convention.

### 6.1 Capacity audit (advisor-flagged, pre-start decision required)

Team baseline: 2 Builders + 1 Tester + 1 Lead ≈ **25 pts/sprint**. Sprint point totals per the plan:

| Sprint | Effort pts | Delta vs. 25-pt baseline |
|---|---|---|
| P0 | 21 | ✅ under |
| P1.S1 | 21 | ✅ under |
| P1.S2 | 27 | ⚠️ +8% |
| **P1.S3** | **32** | ❌ **+28%** |
| **P2.S1** | **34** | ❌ **+36%** |
| **P2.S2** | **31** | ❌ **+24%** |
| P3.S1 | 30 | ⚠️ +20% |
| P3.S2 | 31 | ⚠️ +24% |
| P4.S1 | 20 | ✅ under |
| P4.S2 | 14 | ✅ under |

**5 sprints are 20-36% over capacity.** Unaddressed, the plan will slip one sprint per overcommitted sprint — compounding. P3 close slides to week 10-11 instead of week 8; v1.0 and P4 conditional both push.

**Three resolution options** (pick ONE before P1 starts — preferably before P0):

1. **Scope cut per heavy sprint.** Defer the smallest story in each overcommitted sprint to a buffer sprint at end. Cheapest; most honest.
2. **Grow the team.** Add a 3rd Builder for Phases 1-3 (raises capacity to ~32 pts). Costs more; preserves 8-week v1.0.
3. **Accept 10-week v1.0.** Explicitly mark overcommitted sprints as 1.5-week. Realistic; recalibrates external expectations.

This is **Tier 1 Question #2** in §12 below. Lead must answer before P1 kicks off.

---

## 7. Open decisions blocking sprint starts (north-star §15)

These need user answers before their respective phases start. Default (my recommendation) noted; user can override.

### 7.1 Blocking Phase 1

**Q5 — Trust-level default for internal meta-tools.** Default: hybrid (grandfather in P1 with `trustJustification: "grandfather-phase-1"` tag, CI lint fails build in P3 unless justification is replaced).

**Q11 — `Task.requireVerification` default.** Default: `true` if task declares `successCriteria`, `false` otherwise.

### 7.2 Blocking Phase 2

**Q8 — Top-10 ⭐ priority ordering.** Default: as listed in §8 of north-star.

**Q9 — Hook granularity.** Default: rules cover the need; no separate `onBefore*`/`onAfter*` hooks.

**Q10 — Error-swallowing migration timing.** Default: Phase 0 observation → Phase 2 migration (current plan).

**Q12 — `Claim` extraction policy.** Default: opt-in via `task.requireClaimExtraction` in P2; flip to always-on post-P4b if it proves valuable.

### 7.3 Blocking Phase 3

**Q6 — Capability scope enforcement timing.** Default: warn-only for one minor release, enforce in next.

**Q7 — Budget-exceeded default behavior.** Default: `warn` for opt-in users (via `withCostTracking`), no change for users who don't opt in.

**Q13 — Default invariant enforcement levels.** Default map:
- `untrusted-never-in-system-prompt` → halt
- `capability-scope-respected` → halt
- `budgets-consistent` → halt
- `every-claim-has-evidence` → log
- `tool-call-respects-idempotency` → log
- `decision-rule-fired-per-decision-site` → telemetry-only
- Others → log

**Q14 — `Budget<T>` default limits per tier.** Default:
- Local: 50k tokens/task, 15 iterations, 30 tool calls, 10 min
- Mid: 100k tokens/task, 20 iterations, 50 tool calls, 5 min, $1
- Frontier: 200k tokens/task, 25 iterations, 75 tool calls, 3 min, $5

### 7.4 Already resolved (this conversation, recorded in memory)

- Q1 (feature freeze) — moot; only work stream
- Q2 (breaking-change budget) — clean 1.0 cut with migration guide
- Q3 (Phase 4 ordering) — split: 4a passive in P1, 4b active gated on P0 spike
- Q4 (extension packaging) — deferred to v1.2

---

## 8. Risk register (living doc — update per sprint retro)

| Risk | Severity | Phase | Mitigation |
|---|---|---|---|
| **Ollama capability probe unreliable** (`/api/show` version-dependent shape) | High | P1 | Probe + static-table fallback + `CapabilityProbeFailed` telemetry + conservative default |
| **Decision Rule perf regression on trivial-1step** (rule compilation vs. scattered branches) | High | P2 | Compile pipelines once per run; microbench gate in P2 blocks if >1% regression |
| **P3 slips past 2 weeks** (🔴 migration is bigger than estimated) | Medium | P3 | Priority-10 subset is the scope floor; 🟡 and 🔴 beyond top-10 can slip |
| **Fixture recording binds to specific LLM response shape** (provider updates break fixtures) | Medium | P2 | Version fixtures with provider SDK version; invalidate on major bumps |
| **4,404-LOC ExecutionEngine extraction introduces subtle bugs** | High | P3 | Extract one concern at a time, full probe suite after each; revert policy: any regression means the extract is reverted, not patched forward |
| **`Invariant` check perf cost too high for local tier** | Medium | P3 | Gate behind `config.invariants.enabled` (default off P3, on P4); `checkEvery: "iteration" \| "phase" \| "task"` config |
| **Probe suite flaky from LLM non-determinism** | High | P0 onward | Phase 2 lands fixture recording, which collapses this for CI |
| **Typed error migration breaks existing error-catching code in user land** | Medium | P2 | Re-export old error class names as type aliases; deprecation warning on old catches; 1-release window |
| **Advisor-flagged doc size post-sprint** (1,991 lines) | Low | Post-P3 | Split into `15-design-north-star.md` (§1-10+13) + `16-implementation-reference.md` (§11-12+14) after sprints land |
| **Q5-Q14 answers change defaults mid-sprint** | Medium | P1 onward | Lock user answers before sprint start; any mid-sprint change = next-sprint problem |

---

## 9. Cross-sprint hygiene rules

These apply continuously; each Lead enforces in daily review.

1. **Common pitfalls** (AGENTS.md §Common Pitfalls):
   - `serviceOption` returns `Option`; use `Option.isSome()` + `.value`
   - Gemini SDK is `@google/genai`, not `@google/generative-ai`
   - `mock.module()` in Bun only hooks ES `import()`, not CJS `require()`
   - `ReasoningService.execute` takes single params object
   - Never manually bump versions; changesets handle it
   - `PendingGuidance` replaces `steeringNudge` — do NOT inject USER messages mid-loop

2. **Terminal execution rules** (AGENTS.md §Terminal Execution):
   - Never pipe long-running commands (`| cat`, `| tail`, `| grep`)
   - Always `--timeout 15000` on tests
   - Run only the modified package's tests during development (`bun test packages/<name>`)
   - Quick commands synchronous; long ones in background
   - Always `.stop(true)` on test servers

3. **Memory hygiene** (AGENTS.md and auto-memory discipline):
   - `.agents/MEMORY.md` updated at sprint retro
   - Claude auto-memory updated when user role, feedback, or project fact changes
   - NO duplicate memory entries — update in place, or remove stale ones

4. **Observability discipline** (CODING_STANDARDS.md + `/review-patterns`):
   - Every decision emits an EventBus event
   - No `console.log` in production code (tests can use it sparingly)
   - No `catchAll(() => Effect.void)` — every caught error either re-throws or emits `ErrorSwallowed`

---

## 10. Acceptance — when do we declare the whole plan done?

A "plan ships" acceptance is the conjunction of:

- **All P0-P3 probes pass** on the pinned probe suite with fixed seeds
- **Concrete per-tier expectations met** (north-star §11.3):
  - Local tier ≥90% `trivial-1step`, ≥75% memory-retrieval, σ ≤15%
  - Mid tier ≥98% / ≥92%, σ ≤8%
  - Frontier tier ≥99% / ≥95%, -15% tokens vs. current
- **Compound chain closes** (§12.7): a task run once, verified, captured as a typed Skill, retrieved on re-run, measurable ≥30% iteration reduction on local tier
- **Zero** `catchAll(() => Effect.void)` remaining in production code
- **`builder.ts` behavior-free** (only config mutations)
- **`execution-engine.ts` ≤ 1,800 LOC** (down from 4,404)
- **`bun run build` + `bun run typecheck` + full `bun test` all green** on the pinned matrix
- **P0-P3 success gates all passing** per north-star §14 on probe output committed under `harness-reports/`
- **Docs sync**: README, docs site, `AGENTS.md` snapshot, `CHANGELOG.md`, `ROADMAP.md` all reflect the shipped state

P4 is conditional — its acceptance is measured separately and does not gate the v1.0 cut.

---

## 11. Phase-to-file map (where to look for details)

| Phase | Duration | File |
|---|---|---|
| **Phase 0** | 1 sprint (week 1) | `2026-04-23-north-star-sprint-plan-01-phase-0.md` |
| **Phase 1** | 3 sprints (weeks 2-4) | `2026-04-23-north-star-sprint-plan-02-phase-1.md` |
| **Phase 2** | 2 sprints (weeks 5-6) | `2026-04-23-north-star-sprint-plan-03-phase-2.md` |
| **Phase 3** | 2 sprints (weeks 7-8) | `2026-04-23-north-star-sprint-plan-04-phase-3.md` |
| **Phase 4** | 2 sprints (conditional, weeks 9-10) | `2026-04-23-north-star-sprint-plan-05-phase-4.md` |

Total: 8 sprints for v1.0 cut (P0-P3). Plus 2 more for P4 if positive spike.

---

## 12. Tiered pre-start questions (advisor-reviewed)

After quality sweep: 14 questions split by phase they block. **Tier 1 must be answered before Phase 0 Day 0 starts.** Tier 2-4 answer just-in-time at each phase gate.

### Tier 1 — blocks Phase 0 start — **LOCKED 2026-04-23**

1. **Team size + role assignment.** ✅ **Locked:** solo implementer playing all three roles (Lead, Builder, Tester); scale team as people join. Capacity baseline drops to ~15 pts/sprint.
2. **Capacity-overcommit resolution** (§6.1). ✅ **Locked:** Option 2a — scope cuts per heavy sprint; smallest story per overcommit sprint deferred to a buffer sprint at end. Plan end-date soft-target: week 8 (tight) or week 9 (with buffer); declared at end of P1.
3. **CI probe model + budget.** ✅ **Locked:** `PROBE_MODEL=claude-haiku-4-5`, $0.50/run ceiling, $50/month ceiling.
4. **Effect-TS version pin.** ✅ **Locked:** exact-pin current `3.19.x` (drop the caret in `package.json`). Any Effect-TS bump is a dedicated PR with full probe re-run.

### Tier 2-4 — all **LOCKED (defaults accepted) 2026-04-23**

User direction: "take sensible defaults for now" — recommended defaults accepted across the board. Any story-level surprises surfaced during implementation will be escalated before diverging.

**Tier 2 (Phase 1):**

5. **Q5 trust-level default.** ✅ Hybrid grandfather with `trustJustification: "grandfather-phase-1"` tag; CI lint fails build in P3 unless justification replaced.
6. **Q11 `Task.requireVerification` default.** ✅ `true` when `successCriteria` declared, `false` otherwise.

**Tier 3 (Phase 2):**

7. **Q8 top-10 ⭐ ordering.** ✅ §8 ordering accepted.
8. **Q9 hook granularity.** ✅ Rules-only; no parallel `onBefore*`/`onAfter*` surface.
9. **Q12 Claim extraction policy.** ✅ Opt-in via `task.requireClaimExtraction`.
10. **Q10 error-swallowing migration timing.** ✅ P2 migration sequencing; no known production-bug acceleration.

**Tier 4 (Phase 3):**

11. **Q6 capability-scope enforcement.** ✅ Warn-only for one minor release; enforce in the next.
12. **Q7 budget-exceeded default.** ✅ `warn` for opt-in via `withCostTracking`, no change for non-opt-in.
13. **Q13 invariant enforcement map.** ✅ 10-default map accepted (halt: untrusted-never-in-system-prompt, capability-scope-respected, budgets-consistent; log: every-claim-has-evidence, tool-call-respects-idempotency, state-meta-consistent, tool-observations-typed, message-window-respects-budget, memory-retrieval-within-topK; telemetry-only: decision-rule-fired-per-decision-site).
14. **Q14 `Budget<T>` tier defaults.** ✅ Local 50k/15/30/10min; mid 100k/20/50/5min/$1; frontier 200k/25/75/3min/$5.

---

## 13. Immediate next step

Before Phase 0 kicks off:

1. **User answers Tier 1** (4 questions — 15 minutes). Everything else is just-in-time.
2. **Lead creates the sprint board** for Phase 0 (daily standup record, story status, blockers).
3. **Tester snapshots the current probe suite** as baseline artifacts (`harness-reports/pre-sprint-baseline-2026-04-23.json`).
4. **All parties load skills**:
   - `effect-ts-patterns` (mandatory for every story)
   - `agent-tdd` (mandatory for every test)
   - `review-patterns` (mandatory before every merge)
   - `architecture-reference` (dependency graph + build order)

Phase 0 starts on the sprint-board confirmation day. See Part 1 for day-by-day.
