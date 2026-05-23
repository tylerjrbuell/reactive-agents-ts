---
title: Harness Convergence — Morph Spec
date: 2026-05-23
status: AUTHORITATIVE for sweep-2026-05-23 follow-on work
supersedes-frame: "harness needs improvement" → "60% of North Star v5.0 shipped, 40% drift; written migration plan"
basis: 97 evidence-bearing runs × 3 model tiers + 4 static audits + 10 evidence reports
companion-required-reading:
  - wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md
  - wiki/Architecture/Specs/06-MISSION-STATEMENTS.md
  - wiki/Research/Harness-Reports/SYNTHESIS-2026-05-23.md
gates:
  - Phase 0 closes → Phase 0.5 starts
  - Phase 0.5 closes → Phase 1 starts
  - Phase 1 closes → Phase 2 / 3 unlocked
  - Phase 2 + Phase 3 may run in parallel after Phase 1
---

# Harness Convergence — Morph Spec

## 0. TL;DR — One Page

The Reactive Agents harness is structurally sound and 60% of its North Star v5.0 design is shipped. The remaining 40% drift falls into two anti-patterns confirmed by 97 evidence-bearing runs across cogito:14b + qwen3:14b + gpt-4o-mini:

1. **"Scaffold without callers"** — declared surface exceeds wired runtime. Four instances: 4 dead Compose tags, 8 dead `ControllerDecision` variants, ~9 dead calibration fields, 1 silent-fail skill persistence path.

2. **"Result surface lies"** — `result.metadata.totalTokens=0` while logs show real numbers; `result.success=true` on visibly-failed ToT runs; verifier passes XML / strategy markers / tool format templates as user output; `interventionsDispatched` counter non-zero with RI disabled. Four bugs, all multi-model confirmed.

**Both anti-patterns are universal across tiers.** Frontier models do not fix them. They are structural, not model-quality-dependent.

**Migration target:** the architecture in `05-DESIGN-NORTH-STAR.md §4` (10 capabilities, 5 cross-cutting concerns, single Arbitrator, pure-function discipline). **Phase 0 restores result-surface trust** (without which every higher comparison reads through a lying API). **Phase 1 converges scaffolds into wired runtime** (bridges RI through Compose, lights dead tags, enforces single state mutator). **Phase 2/3 closes structural and intelligence gaps.**

**The job is detection + migration, not invention.** North Star v5.0 already describes the ideal. This spec writes the path from where we are to where we already designed.

---

## 1. Empirical Foundation

### 1.1 Evidence cited (all under `wiki/Research/Harness-Reports/`)

| Report | Q answered | N |
|---|---|---|
| `sweep-2026-05-23-qwen3-14b.md` | Baseline F1–F8 | 5 cells |
| `architecture-drift-analysis-2026-05-23.md` | Initial drift framing | static |
| `capability-mapping-2026-05-23.md` | Q2a: <30% capability-mappable | static |
| `event-coverage-diff-2026-05-23.md` | Q1c: ~zero RI↔Compose overlap | static |
| `cross-strategy-matrix-analysis-2026-05-23.md` | Q2b + M1/M2/M3/M5/M7 | 40 cells |
| `ri-ablation-analysis-2026-05-23.md` | Q1a (75% fire) / Q1b (+1 success) + R9/R10 | 16 cells |
| `m6-persistence-audit-2026-05-23.md` | Q3 gate-check; R11 | static |
| `elegance-robustness-intelligence-audit-2026-05-23.md` | Design lens; E/R/I findings | static |
| `SYNTHESIS-2026-05-23.md` | Cross-tier consolidation; cross-tier matrix | 20 cells frontier |
| `2026-05-23 frontier matrix.json` | Cost-quality data on gpt-4o-mini | 20 cells |

### 1.2 Mission statements cited

`wiki/Architecture/Specs/06-MISSION-STATEMENTS.md`:
- The North (one sentence) — observability + composability + auditability + tier-independence
- 8 vision-pillar missions — Control / Observability / Flexibility / Scalability / Reliability / Efficiency / Security / Speed
- 10 capability missions (Sense → Learn)
- 5 trait missions (Comprehension, Strategic intent, Effective action, Self-monitoring, Compounding intelligence)
- 8 anti-mission boundaries — including #4 "NOT a system that hides failure" and #6 "NOT advertised-surface-without-callers"
- L1/L2/L3 success metrics ladder

### 1.3 Hypotheses retired by evidence

These framings **DO NOT** appear in the morph spec because evidence overturned them:

| Original | Evidence retire |
|---|---|
| "Strategies bypass kernel" | 5 of 7 use `runKernel`; only outer loops reimplemented |
| "RI is dead weight" | 75% fire rate on failure-corpus; +1 success rescue |
| "Compose and RI are parallel substrates" | ~zero overlap; complementary surfaces |
| "Cross-strategy variance is theoretical" | WIDE on quality + cost across all tiers |
| "Collapse strategies into kernel" | <30% capability-mappable; strategies are primitives |

---

## 2. Target Architecture — The Elegant End State

### 2.1 The North (mission anchor)

> The harness produces reliable, observable, composable agent behavior across any model tier, with every decision auditable to its source signal, and every advertised capability backed by a live wired runtime.

### 2.2 Structural target

```
┌─────────────────────────────────────────────────────────────────────┐
│  CROSS-CUTTING  State | Telemetry (EventBus + Trace) | Safety       │
│                 (Guardrails + Cost + Identity) | Time | Provenance  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
   ┌──────────────────────────────┼──────────────────────────────┐
   ▼                              ▼                              ▼
┌──────────┐                ┌──────────┐                  ┌──────────┐
│ PERCEIVE │                │  REASON  │                  │   ACT    │
│ Sense    │                │ Think    │                  │ Tool     │
│ Attend   │                │ Reflect  │                  │ Verify   │
│ Comprehend│   ────►       │          │       ────►      │          │
└────┬─────┘                └────┬─────┘                  └────┬─────┘
     │                           │                             │
     │                           ▼                             │
     │                    ┌──────────────┐                     │
     │                    │ ARBITRATOR   │ ◄─── ALL signals ───┤
     │                    │ ONE Verdict  │                     │
     │                    │ per iter     │                     │
     │                    └──────┬───────┘                     │
     │                           │                             │
     │                    ┌──────▼───────┐                     │
     │                    │   LEARN      │                     │
     │                    │ Memory       │  ◄──────────────────┘
     └────────────────────┤ Calibration  │
                          │ Skill        │
                          └──────────────┘

Loop Controller orchestrates: Perceive → Reason → Decide → Act → Learn → loop
                                                  ↑
                                             ONE Verdict per iter

Strategies are declarative phase compositions over capabilities.
The kernel IS one strategy ("react"); plan-execute, reflexion, ToT, code-action
are strategy compositions consuming capabilities (Reason/Act/Reflect/Verify).
```

### 2.3 The unifying principle

> Every cognitive function is a service with: one owner, typed contract, observable events, replaceable strategy, isolated tests, AND a live emit/consumer site in the same commit it was declared. Surfaces never ship without callers.

### 2.4 Single Arbitrator contract

```typescript
type Signal =
  | { source: 'entropy';        composite: number; trajectory: ... }
  | { source: 'verifier';       verified: bool; checks: VerifierCheck[] }
  | { source: 'healing';        outcome: 'recovered' | 'failed'; ... }
  | { source: 'killswitch';     abort: 'stop' | 'terminate'; reason: string }
  | { source: 'loop-detector';  detected: bool; iter: number; ... }
  | { source: 'task-budget';    iterRemaining: number; tokensRemaining: number };

type Verdict =
  | { kind: 'continue' }
  | { kind: 'exit-success'; output: string }
  | { kind: 'exit-failure'; reason: string }
  | { kind: 'escalate'; toStrategy?: string; reason: string };

declare function arbitrate(signals: Signal[], state: KernelState): Verdict;
```

**Pure function. Single call site in Loop Controller. Sole source of termination decisions.**

### 2.5 Capability-scoped instrumentation

Every capability invocation emits trace events from the capability layer, not from strategy code. `Reason` emits `llm-exchange`; `Act` emits `tool-call-start`/`-end` + `kernel-state-snapshot` post-call; `Verify` emits `verifier-verdict` per check + severity; `Decide` emits `arbitrator-verdict`.

Strategies inherit observability by composing capabilities. New strategies emit identically without per-strategy emit code.

### 2.6 Single intervention substrate

**Bridge pattern (NOT subsume):**

- RI dispatcher decides → emits decision through `pipeline.transform('control.<decision-type>', payload, ctx)` → Compose transforms / observes / overrides.
- Healing recovers/fails → emits through `pipeline.transform('nudge.healing-failure', message, ctx)`.
- Verifier rejects → emits through `pipeline.transform('lifecycle.failure', verdict, ctx)`.
- Strategy-evaluator switches → emits through `pipeline.transform('control.strategy-evaluated', payload, ctx)`.

**Compose is the universal observation surface; RI is the internal decision engine. Different stages of the loop, ONE surface to users.**

The 4 currently-dead Compose tags (`nudge.healing-failure`, `observation.tool-result`, `lifecycle.failure`, `control.strategy-evaluated`) light up via this bridge.

---

## 3. Migration Phases

```
Phase 0 [P0]  Surface Trust Restoration    8 issues   gates all else
   │
   ▼
Phase 0.5 [P1] Cost / Quality Gates         2 issues   pre-routing intelligence
   │
   ▼
Phase 1 [P1]  Convergence Foundations       8 issues   wired capability + bridge
   │
   ├──────────────────────┐
   ▼                      ▼
Phase 2 [P2]              Phase 3 [P3+]
Structural                Compounding Intelligence
3 issues                  3 issues
```

Phase 0 gates because all higher-altitude empirical comparisons currently read through a lying result surface. Without Phase 0, every fix's "did it work?" verification is unreliable.

---

## 4. Phase 0 — Surface Trust Restoration (P0, 8 issues)

**Mission anchor:** Anti-mission #4 ("NOT a system that hides failure") + Anti-mission #6 ("NOT advertised-surface-without-callers"). L1 metric: result API must reflect actual outcome.

**Phase exit criteria:**
- `result.metadata.totalTokens` matches sum of phase `[metric:tokens_used]` events across all 97 evidence-replay runs
- `result.success === false` for all runs where logs contain `failed to produce output`
- 0 of 7 Compose TagMap entries have ≥1 emit site (or are documented as `@experimental` with version target)
- 0 trace events use literal `decisionType` strings outside a single constants module
- `emitErrorSwallowed` writes from skill-store path emit a distinct `skill-persistence-failed` event
- Output sanitization strips `<rationale call=` + `[CRITIQUE \d+\] SATISFIED:` + `[find result —` patterns from `state.output` unconditionally
- Verifier `output-not-harness-parrot` check extends to these patterns

### Issue 0.1 — `result.metadata.totalTokens` wiring break

**Empirical evidence:** All 76 matrix cells + 16 ablation cells report `tokens=0` while logs print real numbers (e.g., cell 39: `[metric:tokens_used] 26191 tokens` + `metadata.totalTokens = 0`). Universal across cogito:14b + qwen3:14b + gpt-4o-mini.

**Root cause hypothesis:** EmitLog `metric` events fire and trace recorder captures them, but the `AgentCompleted` event aggregator doesn't fold them back into `ExecutionResult.metadata.totalTokens`. Likely break in `packages/runtime/src/engine/finalize/run-finalization.ts` or in `agent-config.ts:totalTokens` aggregation.

**Fix shape:**
1. Audit aggregation site — find where `totalTokens` is populated on `ExecutionResult.metadata`
2. Confirm it sums from per-phase metric events OR from per-step `tokensUsed`
3. Add regression test: probe with known token count → metadata matches log sum within 5%

**Success metric:** ≥99% of probe traces have `metadata.totalTokens` ∈ ±5% of trace-stat `totalTokens`. CI-enforced.

**Effort:** ~10-30 LOC + 1 test.

**Severity:** 🔴 P0 — universal API lie; breaks every cost-accounting consumer.

### Issue 0.2 — Verifier blind to internal-markup output leaks (M2a/b/c)

**Empirical evidence:**
- M2a: 7/20 cogito:14b cells ship `<rationale call="N">...` as `state.output`
- M2b: 2/5 gpt-4o-mini reflexion cells ship `[CRITIQUE 1] SATISFIED: ...` as `state.output`
- M2c: 1/5 gpt-4o-mini ToT cell ships `[find result — compressed preview]\nType: Object(4 keys)...` as `state.output`

All three classes:
- Pass `agent-took-action` check (tool was called)
- Pass `non-empty-content` check
- Pass `output-not-harness-parrot` check (current pattern list too narrow)
- Pass `evidence-grounded` + `synthesis-grounded` checks

**Root cause:**
- M2a: `think.ts:455` embeds `<rationale call="N">...</rationale>` as **prompt scaffolding** for FC rationale capture. Small models (cogito:14b) reproduce the schema literally when no tool call follows. `think.ts:1138-1175` only strips it on the tool-call path; non-tool path leaks the wrapper into thought → ships as output.
- M2b: reflexion's outer-loop critique uses `[CRITIQUE N] SATISFIED: ...` as internal control markers. The output assembly doesn't strip these.
- M2c: ToT's `[find result — compressed preview]` is the framework's compressed tool-result format template. ToT bypasses `output-synthesis.ts` and ships the template directly.

**Fix shape:**
1. **Output assembly sanitization layer** in `kernel/loop/output-assembly.ts`: strip three patterns unconditionally before promoting `state.output`:
   - `/^<rationale\s[^>]*>[\s\S]*?<\/rationale>/g` (M2a)
   - `/^\[CRITIQUE\s+\d+\]\s+SATISFIED:[\s\S]*/g` (M2b)
   - `/^\[find result\s+—[\s\S]*/g` (M2c)
2. **Extend verifier `output-not-harness-parrot` check** at `verifier.ts` to include these patterns as blocked prefixes.
3. **Long-term (Phase 1+):** Prompt scaffolding refactored to use markers the model will not reproduce in user-facing text (e.g., zero-width unicode delimiters, or JSON-only structured output paths).

**Success metric:** 0 cells in subsequent matrix runs ship rationale XML / CRITIQUE meta / find-result template as `state.output`. Verifier emits `output-not-harness-parrot: rejected` on any cell trying.

**Effort:** ~30 LOC + 3 regression tests + 1 verifier check extension.

**Severity:** 🔴 P0 — universal output-pollution pattern across strategies + tiers; direct trust-differentiator violation.

### Issue 0.3 — ToT `failed to produce output` → `success=true` propagation

**Empirical evidence:** cell 40 (qwen3:14b ToT t5-critique) and cell 20 (gpt-4o-mini ToT t5-critique) both log `✗ Tree-of-thought failed to produce output` immediately followed by `ExecutionResult.success = true`. Cross-tier confirmed.

**Root cause:** ToT internal failure path (`tree-of-thought.ts:~509` `finalOutput = execState.output ?? lastThought ?? null`) returns potentially-null but the strategy wrapper doesn't propagate null to `ReasoningResult.success = false`.

**Fix shape:** In `tree-of-thought.ts` ReasoningResult construction, set `success: finalOutput !== null && finalOutput.length > 0`. Apply same audit to reflexion + plan-execute + code-action result-construction paths.

**Success metric:** No `ExecutionResult.success = true` cell coexists with `failed to produce output` log line. CI scrape-test.

**Effort:** ~10 LOC + 1 cross-strategy regression test.

**Severity:** 🔴 P0 — direct anti-mission #4 violation, multi-tier confirmed.

### Issue 0.4 — Three duplicate decision event names (R9)

**Empirical evidence:** trace analysis of ablation runs shows three name-pairs for identical decisions:
- `tool-inject` + `inject-tool-guidance` (11 + 11 fires)
- `temp-adjust` + `set-temperature` (2 + 2 fires)
- `switch-strategy` + `request-strategy-switch` (1 + 1 fires)

**Root cause:** Emit sites use string literals for `decisionType` instead of referencing a single discriminator constant.

**Fix shape:**
1. Single exported constants module in `packages/reactive-intelligence/src/types.ts`:
   ```typescript
   export const DecisionType = {
     ToolInject: 'tool-inject',
     TempAdjust: 'temp-adjust',
     StrategySwitch: 'switch-strategy',
     // ...
   } as const;
   ```
2. Replace all literal `decisionType: 'tool-inject'` etc. with `DecisionType.ToolInject` at emit sites.
3. ESLint rule: `decisionType` field requires `DecisionType.*` reference, not string literal.

**Success metric:** `rax-diagnose grep latest "e.kind === 'intervention-dispatched'" | jq '.decisionType' | sort -u` returns ≤13 unique values (matches `ControllerDecision` union variants).

**Effort:** ~20 LOC + lint rule.

**Severity:** 🔴 P0 — trace analytics double-count; consumers filtering by name miss decisions.

### Issue 0.5 — `interventionsDispatched` counter contamination (R10)

**Empirical evidence:** Every RI-OFF cell in ablation shows `interventionsDispatched ≥ 1`. Without `.withReactiveIntelligence()`, RI dispatcher should not fire. Either:
- `.withReactiveIntelligence()` isn't the RI on-off switch (other paths enable dispatcher)
- `traceStats.interventionsDispatched` counts non-RI events (required-tool guard, oracle nudge, etc.)

**Fix shape:**
1. Audit: what does `interventionsDispatched` actually count? Read `packages/trace/src/replay.ts:traceStats` implementation.
2. Either rename to reflect actual semantics OR scope it to RI-dispatched-only.
3. Document the RI on/off switch explicitly: is it `.withReactiveIntelligence()` or something else? Likely related to `.withLeanHarness()`.

**Success metric:** RI-OFF cells in re-run ablation show `interventionsDispatched === 0` for RI-attributed events. Counter naming reflects actual scope.

**Effort:** ~15 LOC + naming clarity + 1 doc update.

**Severity:** 🔴 P0 — ablation tests are blind without this clarification.

### Issue 0.6 — Silent skill persistence failure (R11)

**Empirical evidence:** `packages/reactive-intelligence/src/learning/learning-engine.ts:166` wraps `skillStore.store(entry)` in `Effect.catchAll(emitErrorSwallowed)`. Any SQLite write failure produces one debug event then disappears.

**Fix shape:**
1. Replace the swallow with a structured failure event:
   ```typescript
   yield* Effect.catchAll(skillStore.store(entry), (err) =>
     emitLog({
       _tag: "warning",
       warning: "skill-persistence-failed",
       site: "reactive-intelligence/src/learning/learning-engine.ts:166",
       error: errorTag(err),
       skillName: entry.name,
       timestamp: new Date(),
     })
   );
   ```
2. Add same surface treatment to all `emitErrorSwallowed` sites in critical paths (memory writes, calibration writes, learning writes).

**Success metric:** `rax-diagnose grep latest "e.kind === 'warning' && e.warning === 'skill-persistence-failed'"` returns events when persistence fails. Zero silent failures.

**Effort:** ~5 LOC per site + audit other emitErrorSwallowed sites.

**Severity:** 🔴 P0 — framework advertises compounding intelligence; default config doesn't compound; failure invisible.

### Issue 0.7 — Reflexion `[CRITIQUE N]` markers in user output (subsumed by 0.2)

**Subsumed:** issue 0.2 output-sanitization fix covers reflexion meta-markers via the `\[CRITIQUE\s+\d+\]` pattern. Filed as 0.7 for issue-tracking visibility but resolved in 0.2.

### Issue 0.8 — ToT `[find result — compressed preview]` template leak (subsumed by 0.2)

**Subsumed:** issue 0.2 output-sanitization fix covers ToT tool-format-template leak via the `\[find result\s+—` pattern. Filed as 0.8 for issue-tracking visibility but resolved in 0.2.

**Note on 0.7+0.8 subsumption:** Three distinct M2 manifestations (M2a/b/c) share one root cause class. Fix landed in one place (output-assembly sanitization + verifier extension). Tracked as three issues for visibility; closed as one PR.

---

## 5. Phase 0.5 — Cost / Quality Gates (P1, 2 issues)

**Mission anchor:** Pillar 6 (Efficiency) + Pillar 4 (Scalability). Mission Statement: *"The harness intervenes only when its intervention has measurable lift on outcome."*

**Phase exit criteria:**
- Adaptive routing classifies tasks by **cost class** alongside task-shape class
- ToT strategy refuses to start on trivial-complexity tasks OR caps at minimum depth without BFS exploration
- M5 routing heuristics validated against `cross-strategy-matrix-2026-05-23-12:01.json` cost data

### Issue 0.5.1 — ToT tier-aware cost gate (M3)

**Empirical evidence:**
- ToT × t1-trivial × gpt-4o-mini: $0.0022 (3.3× reactive's $0.0007 for SAME multiplication task)
- ToT × t1-trivial × qwen3:14b: 303s (23× reactive's 13s)
- ToT × t5-critique × gpt-4o-mini: 70s + 20,255 tokens for 264-char output + `failed to produce output` log

ToT BFS exploration runs even on tasks that don't need it. `ToTTierLimit` exists at `tree-of-thought.ts:43-50` but doesn't gate by task complexity, only by tier.

**Fix shape:**
1. Add `taskComplexity` classifier to `ToT.executeTreeOfThought()` entry: if complexity is `trivial` or `factual`, skip BFS exploration phase entirely (collapse to reactive sub-kernel directly).
2. Lower `tierLimits.bfsDepth` for `simple`-classified tasks; raise only when `multi-step` or `tree-search-amenable` classification.
3. Emit `tool-strategy-cost-skipped` trace event when BFS exploration is bypassed for cost reasons.

**Success metric:** ToT × t1-trivial costs ≤2× reactive's. Adaptive routing never selects ToT for `trivial`/`factual` task classes.

**Effort:** ~40 LOC + classifier hook + 5 regression test cells.

### Issue 0.5.2 — Adaptive routing redesigned with cost dimension (M5)

**Empirical evidence:** Best strategy varies WIDELY by task type (frontier data):
- t1-trivial: plan-execute ($0.0001), worst is ToT ($0.0022 — 22× worse)
- t4-multistep: plan-execute (3338ch for $0.00196, best $/char)
- t5-critique: plan-execute ($0.00251) when reflexion is broken by M2b leak

Current adaptive (`adaptive.ts:336`) routes by task-shape patterns (numbered lists, plan-keywords, word-count). **Cost class is not a routing input.**

**Fix shape:**
1. Add `costClass` to `AdaptiveContext`: per-strategy historical $/output-char + duration on similar tasks.
2. Routing function combines: task-shape + cost-class + tier-cost-budget.
3. Calibration (M7) writes per-strategy cost/quality per task-class on each completion.

**Success metric:** Adaptive routing decisions on matrix-replay match best-strategy-by-cost ≥80% of cells. Calibration storage activates ≥3 of the currently-dead calibration fields (R4).

**Effort:** ~80 LOC + calibration consumer wiring.

---

## 6. Phase 1 — Convergence Foundations (P1, 8 issues)

**Mission anchor:** All 8 vision pillars; primary mission statements for Sense / Reason / Decide / Act / Verify / Reflect. L1 + L2 success metric ladder.

**Phase exit criteria:**
- All 7 Compose TagMap entries have ≥1 emit site (4 currently dead → 0)
- All RI decision types declared in `ControllerDecision` union either have a live emit site OR are `@experimental` documented
- `state.status =` assignment outside `transitionState()` helper: ≤10 sites (currently 170+)
- `emitKernelStateSnapshot` + `emitVerifierVerdict` + `emitLLMExchange` fire from capability boundaries, not strategy code
- TaskComprehender extracts soft-required tools from task text
- Strategy outer-loops emit their own iteration snapshots (closes F1)

### Issue 1.1 — Bridge RI decisions through Compose tags (closes C1)

**Empirical evidence:**
- RI ablation: 75% fire rate; 5 distinct decisions empirically fire (`stall-detect`, `tool-inject`, `early-stop`, `temp-adjust`, `switch-strategy`)
- Event coverage diff: 4 Compose tags scaffolded with no emit sites; 3 of 4 dead tags have natural RI-decision emission opportunities
- Event coverage diff: ~zero overlap between RI dispatcher and Compose pipeline — they're complementary, not parallel

**Fix shape:**

```typescript
// In packages/reactive-intelligence/src/controller/dispatcher.ts
// After existing decision dispatch (~dispatcher.ts:80+):

if (handler) {
  const result = yield* handler.handle(decision, context);

  // NEW: emit through Compose for external observation/override
  const harnessPipeline = yield* Effect.serviceOption(HarnessPipelineService);
  if (harnessPipeline._tag === "Some") {
    const tagMap: Record<ControllerDecisionType, ComposeTag> = {
      'switch-strategy': 'control.strategy-evaluated',
      'stall-detect':    'lifecycle.failure',
      'early-stop':      'control.early-stop',     // requires new tag
      // ...
    };
    yield* harnessPipeline.value.transform(tagMap[decision.decision], result, ctx);
  }
}
```

Plus emit `nudge.healing-failure` from `tools/src/skills/healing-pipeline.ts` on recovery failure paths.
Plus emit `observation.tool-result` from `kernel/capabilities/act/act.ts` post-tool-execution.
Plus emit `lifecycle.failure` from verifier rejection paths.

**Success metric:**
- All 7 Compose tags have ≥1 emit site
- Registered Compose transforms on previously-dead tags fire when expected
- `rax-diagnose grep latest "e.kind === 'harness-signal-injected'"` shows events from all 7 tag namespaces

**Effort:** ~30 LOC of `pipeline.transform()` calls at known emit sites.

### Issue 1.2 — Capability-scoped instrumentation (closes E2 + F1)

**Empirical evidence:**
- Capability mapping: plan-execute outer loops emit 0 `kernel-state-snapshot` events (F1)
- Strategies that delegate to `runKernel(reactKernel, ...)` get diagnostics; outer loops don't
- All non-reactive strategies have parallel "phase started" `LogEvent` emissions but no structured snapshots

**Fix shape:**
1. Refactor `emitKernelStateSnapshot` to accept an `outerLoopName` parameter (e.g., `'plan-execute:plan'`, `'tree-of-thought:explore'`).
2. Add emit calls to each strategy's outer iteration boundary:
   - `plan-execute.ts:355` (refinement loop)
   - `plan-execute.ts:601` (reflect block)
   - `tree-of-thought.ts:153` (early-stop wiring)
   - `tree-of-thought.ts:166` (BFS expansion iter)
   - `reflexion.ts:197` (reflect-improve loop)
3. Schema extends `KernelStateSnapshotEvent` to include `outerLoopName`/`outerIter` fields (optional).

**Success metric:**
- Per-strategy probe traces all have ≥1 `kernel-state-snapshot` event per outer iter
- `rax-diagnose replay <runId> --only=kernel-state-snapshot` returns events for ALL strategy types

**Effort:** ~50 LOC + 4 strategy modifications + schema extension.

### Issue 1.3 — `transitionState()` discipline + lint rule (closes E4)

**Empirical evidence:** `rtk grep 'state\.status\s*=\|terminatedBy' packages/reasoning/src packages/runtime/src` returns 170 matches across 14+ files. North Star v5.0 §4.2 mandates Loop Controller as sole state mutator.

**Fix shape:**
1. Identify all 170 sites; for each:
   - Replace direct `state.status = ...` with `state = transitionState(state, { ... })`
   - OR document why direct mutation is necessary (rare; should be ≤5 sites)
2. ESLint rule: `state.status =` or `state.error =` outside `transitionState()` or `kernel-state.ts` → error.
3. Top remaining mutators currently include `think.ts`, `loop-detector.ts`, `verifier.ts` — these mutators are exactly the **internal-direct-decision** anti-pattern.

**Success metric:**
- ≤10 `state.status =` sites outside canonical state module
- ESLint rule blocks new violations in CI

**Effort:** ~30 LOC for lint rule + ~3-5 hours retrofit (170 sites in bulk-replace mode).

### Issue 1.4 — Required-tool nomination extraction (closes I2 + F4/F5)

**Empirical evidence:**
- Sweep F4: agent ignored `use recall to fetch full data` task instruction, used wrong tool, claimed "no data available"
- M2 manifestations across cogito show models partially-respect task instructions
- Capability mapping: TaskComprehender at `kernel/capabilities/comprehend/task-intent.ts` exists but does limited extraction

**Fix shape:**
1. Add `softRequiredTools` field to `ComprehendResult` shape.
2. In `task-intent.ts`, regex-extract tool names from `use \w+ to ...`, `call \w+`, `invoke \w+` patterns; cross-reference against `availableToolSchemas`.
3. Verifier new check `soft-required-tools-respected`: if comprehend identified soft-required tools and they weren't in `toolsUsed`, emit `WARN` (not `REJECT` — graceful).
4. Output-gate: if claimed-impossibility output + soft-required-tool unused → escalate to `REJECT`.

**Success metric:**
- Probe with explicit `use recall` task gates → verifier WARN; agent retry resolves OR ESCALATE
- F4 reproduction no longer produces "no 7th result" false claim

**Effort:** ~80 LOC + new verifier check + 3 regression test scenarios.

### Issue 1.5 — `ControllerDecision` union audit + prune/doc (closes R3)

**Empirical evidence:** 8 of 13 declared `ControllerDecision` variants never fire in failure-corpus (`compress`, `skill-activate`, `prompt-switch`, `tool-failure-redirect`, `memory-boost`, `skill-reinject`, `human-escalate`, `harness-harm`).

**Fix shape:**
1. Audit each dead variant: documented behavior + emit site + handler?
2. For each:
   - If has emit site + handler but failure-corpus doesn't trigger → expand failure-corpus
   - If has handler but no emit site → wire emit OR mark `@experimental` with version target
   - If has neither → delete or document deprecation
3. Mission anti-mission #6: no declared variant without live wired path.

**Success metric:** ≥10 of 13 variants empirically fire in revised failure-corpus OR documented + version-targeted.

**Effort:** ~5 hours audit + ~50 LOC of code + corpus extensions.

### Issue 1.6 — `emitLLMExchange` wiring at provider boundary (closes R8 + F8)

**Empirical evidence:**
- F8 sweep: qwen3:14b retrieval probe had 78s combined think time across 2 iter with no tool calls; cannot diagnose because no `llm-exchange` events
- M3 ToT cost data shows token counts but no per-call breakdown
- Skill doc claims framework-ready but not wired

**Fix shape:**
1. In `packages/llm-provider/src/adapters/*.ts` per provider:
   - Wrap `complete()` + `stream()` round-trips with `emitLLMExchange({ provider, model, promptPreview, responsePreview, tokens, latency })`
2. Truncate previews to ~500 chars to keep trace size sane.
3. Emit before + after for streaming (prompt + completion).

**Success metric:**
- Every LLM call in probe runs produces ≥1 `llm-exchange` event
- F8-style cross-model latency diagnosis becomes possible via trace replay

**Effort:** ~40 LOC per provider × 4 providers = ~160 LOC.

### Issue 1.7 — Plan-execute synthetic kernel state contract test (closes R5)

**Empirical evidence:** `plan-execute.ts:667-686` constructs fake `KernelState` to feed RI controller's `score()`. The shape can silently drift with kernel evolution.

**Fix shape:**
1. Add contract test in `packages/reasoning/tests/plan-execute-ri-adapter.test.ts`:
   - Build synthetic state per L667
   - Assert it satisfies the EntropySensor contract by calling `entropySensor.score()` and verifying no type/runtime errors
2. Alternative (deferred to Phase 2): generalize EntropySensor contract beyond kernel-shaped input.

**Success metric:** Contract test passes on every kernel state schema change.

**Effort:** ~30 LOC.

### Issue 1.8 — Triple compression coordination (closes R6)

**Empirical evidence:** Per memory + sweep, three compression systems (stash, curator, patch) may all fire on the same conversation. Per North Star, curator is the sole author.

**Fix shape:**
1. Stash + patch demoted to advisory — they emit recommendations the curator consumes.
2. Curator becomes the only `state.messages` mutator for compression.
3. Trace event: `compression-recommendation` (advisory) + `compression-applied` (curator-only).

**Success metric:** `state.messages` mutations from compression: 1 source (curator). Trace events show recommendation → application chain.

**Effort:** Refactor (medium); pre-existing memory work `project_running_issues` flagged this.

---

## 7. Phase 2 — Structural (P2, 3 issues)

**Mission anchor:** Capability missions for Learn + Verify + Recall. Mission Statement: *"Each iter ends with a Learn step writing to calibration, memory, and skill registry."*

**Phase exit criteria:**
- `kernel/capabilities/learn/` directory exists with LearningPipeline service
- Verifier emits per-check severity (not single bool)
- Cross-session skill persistence default-on (or one-call enablement)
- Q3c lift evidence ≥ +5pp on revised gate corpus (pending Step 5 dedicated probe)

### Issue 2.1 — Open `learn/` capability + LearningPipeline service

**Empirical evidence:**
- Capability mapping: M6 SkillStoreService wired but gated; M7 calibration 14 fields ~5 consumers; M10 memory writes scattered
- Each strategy implements learn-shaped state independently (plan-execute PlanStore, reflexion critique history, ToT path scoring)
- M6 audit: persistence works but conditional + silent failure mode

**Fix shape:**
1. Create `packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.ts`
2. `LearningPipeline.write(observations, decisions, outcomes)` → coordinated writes to:
   - SkillStoreService (M6)
   - CalibrationStoreService (M7)
   - MemoryStoreService (M10)
3. Wire as a phase in Loop Controller, called once per iter (after Verify, before next iter).
4. Default `.withLearning()` builder method bundles `.withMemory()` + `.withReactiveIntelligence()` configuration.

**Success metric:**
- ≥3 dead calibration fields (R4) activate
- Cross-session repeat probe (Step 5 dedicated probe) shows ≥+5pp lift session-2 vs session-1 on revised gate corpus

**Effort:** medium (new capability + LearningPipeline service + wiring).

### Issue 2.2 — Multi-severity verifier (closes I5)

**Empirical evidence:**
- Sweep F4: verifier passes 6/6 checks on a shallow give-up answer
- Capability mapping: verifier `{verified: bool}` collapses 7 checks
- M2 leaks pass `output-not-harness-parrot` because of insufficient pattern coverage

**Fix shape:**
1. Verdict shape evolves:
   ```typescript
   type VerifierVerdict = {
     verified: boolean;  // computed from severity rules
     checks: Array<{
       name: string;
       severity: 'pass' | 'warn' | 'reject' | 'escalate';
       reason: string;
     }>;
   };
   ```
2. Loop Controller behavior:
   - All checks `pass` → terminal acceptance
   - Any `reject` → retry OR fail
   - Any `escalate` → strategy-switch OR human-in-loop
   - `warn` flows through but logs

**Success metric:**
- F4 reproduction emits `severity: 'reject'` on `output-not-harness-parrot` for M2a/b/c outputs
- Sweep F4 give-up case escalates instead of passes

**Effort:** ~60 LOC + verifier rule rewiring.

### Issue 2.3 — Cross-session skill persistence default-on

**Empirical evidence:**
- M6 audit: persistence wired but opt-in via `.withMemory()`
- Anti-mission #6 (no advertised-surface-without-callers) — current default doesn't activate the compounding-intelligence promise

**Fix shape:**
1. Default agent build includes lightweight SQLite memory (configurable to disable).
2. `.withLearning()` bundles all three (RI + memory + skill store) with sensible defaults.
3. Memory db path defaults to OS-appropriate location (e.g., `~/.reactive-agents/memory.db`).

**Success metric:**
- Default-config agent persists skills across sessions
- Cross-session probe shows lift without explicit `.withMemory()` call

**Effort:** ~100 LOC builder API + path management.

---

## 8. Phase 3 — Compounding Intelligence (P3+, 3 issues)

**Mission anchor:** Compounding Intelligence trait + Pillar 5 (Reliability) + Pillar 6 (Efficiency). Mission Statement: *"One Arbitrator integrates all signals into one Verdict per iter."*

### Issue 3.1 — Single Arbitrator (closes E1)

**Empirical evidence:**
- Drift analysis: 5 parallel incident systems decide intervention/termination independently
- 170 termination-decision sites across 14+ files (after Phase 1's `transitionState()` discipline this drops to ~10)
- Mission Statement Pillar 5 demands single Arbitrator

**Fix shape:**
1. New `kernel/capabilities/decide/arbitrator.ts` with the contract in §2.4.
2. Signal-source registration: each existing incident system becomes a `SignalSource` rather than a decider:
   - RI dispatcher → `RIDecisionSignalSource`
   - Verifier → `VerifierSignalSource`
   - Healing → `HealingSignalSource`
   - Killswitch → `KillswitchSignalSource`
   - Loop-detector → `LoopDetectorSignalSource`
3. Loop Controller calls `arbitrate(signals, state)` once per iter; result is the only termination decision.

**Success metric:**
- 0 non-Arbitrator termination decision sites in production code
- `rax-diagnose grep latest "e.kind === 'arbitrator-verdict'"` shows exactly one verdict per iter

**Effort:** large (multi-PR; depends on Phase 1 transitionState() discipline).

### Issue 3.2 — Composite confidence signal (closes I1)

**Empirical evidence:**
- F3 sweep: entropy threshold blocks RI exactly when stable-confident-wrong (most dangerous failure mode)
- F4 sweep: verifier passes shallow give-ups because evidence-grounded check passes when output matches what was visible (even if more was knowable)

**Fix shape:**
1. New signal at iter-end: `{ confidence, evidenceQuality, claimCoverage }`
2. Confidence: per-token logprob aggregation OR (if not provider-available) entropy-derived proxy
3. EvidenceQuality: ratio of tool-observation tokens referenced in output vs available
4. ClaimCoverage: percentage of nominated tools used vs nominated; percentage of task aspects addressed
5. Arbitrator considers composite, not entropy alone

**Success metric:**
- F4 give-up reproduction trips `claimCoverage` check → escalate (instead of passing)
- Empirical lift ≥3pp on hard task subsets

**Effort:** large (signal engineering + arbitrator integration).

### Issue 3.3 — Capability composition routing (closes I4)

**Empirical evidence:**
- Capability mapping: <30% mappable; strategies stay primitives
- M5 frontier data: strategy ↔ task fit is narrow; routing decisions are load-bearing
- Adaptive routing currently uses heuristics; should use phase composition

**Fix shape:**
1. Strategies as declarative phase arrays:
   ```typescript
   const planExecuteReflect = [
     phases.plan,
     phases.executeWaves,
     phases.reflect,
     phases.maybeRefine,
     phases.terminate,
   ];
   ```
2. Adaptive composes per-task phase sequence: BFS-explore + reactive-execute, or critique-then-refine, etc.
3. Each phase is a capability invocation.

**Success metric:**
- Adding a new "strategy" is adding a phase array, not a new file
- All phases inherit instrumentation

**Effort:** large (architectural; depends on Phase 1+2).

---

## 9. Success Metrics Ladder — Mapped to Phases

### L1 — Structural (always green, automated)

| Metric | Current | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|---|
| `result.metadata.totalTokens` accuracy | 0% | **100%** | maintained | maintained | maintained |
| `result.success` reflects outcome | unreliable | **reliable** | maintained | maintained | maintained |
| Compose TagMap wired tags | 3/7 | 3/7 | **7/7** | maintained | maintained |
| `state.status =` mutation sites | 170+ | 170+ | **≤10** | maintained | maintained |
| RI decision name uniqueness | 3 dup pairs | **0 dup** | maintained | maintained | maintained |
| `learn/` capability dir exists | no | no | no | **yes** | yes |
| Single Arbitrator | no | no | no | no | **yes** |

### L2 — Observability (every run, automated)

| Metric | Current | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|---|
| Trace duplication rate | ~50% (F2) | maintained | **≤1%** | maintained | maintained |
| LLM-exchange emit coverage | 0% | 0% | **100%** | maintained | maintained |
| `kernel-state-snapshot` emit per strategy | reactive-only | reactive-only | **all strategies** | maintained | maintained |
| Output sanitization coverage | partial | **3 patterns** | extends | maintained | maintained |

### L3 — Outcome (gate corpus, quarterly)

| Metric | Current | Phase 0 | Phase 0.5 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|---|---|---|
| Failure-corpus AUC (RI signal) | est ~0.85 | maintained | maintained | maintained | maintained | **≥0.95** |
| Cross-tier success (frontier) | 100% (matrix) | maintained | maintained | maintained | maintained | maintained |
| Cross-tier success (qwen3:14b) | 100% (matrix) | maintained | maintained | maintained | maintained | maintained |
| Cross-tier success (cogito:14b) | ~70% (M2 leaks) | **+10pp** | maintained | maintained | maintained | maintained |
| Cross-session lift | unmeasured | unmeasured | unmeasured | unmeasured | **≥+5pp** | maintained |
| Soft-required-tool compliance | <20% | <20% | <20% | **≥60%** | maintained | maintained |

---

## 10. Risk Analysis

### 10.1 Risks of doing the morph

| Risk | Severity | Mitigation |
|---|---|---|
| Phase 1 transitionState() retrofit touches 170 sites; high regression surface | medium | bulk replace + comprehensive test run; gate behind feature flag if needed; existing test suite is 5000+ tests |
| Phase 2 `learn/` capability changes default agent behavior (memory default-on) | medium | configurable; default safe; emit deprecation events on opt-out paths |
| Phase 3 Arbitrator refactor is large and high-stakes | high | gated by Phase 1 transitionState() discipline; full N=3 corpus regression run; phased rollout |
| Compose-RI bridge (1.1) requires careful EventBus/HarnessPipeline coordination | low | bridge is additive, doesn't change existing surfaces |

### 10.2 Risks of NOT doing the morph

| Risk | Empirical evidence | Cost of inaction |
|---|---|---|
| API consumers reading lying token + success metadata | M1 + M7 universal | every cost / billing / metric integration is wrong |
| Output leaks erode user trust | M2a/b/c cross-tier | reproducible on demo runs; impacts adoption |
| Scaffold-without-callers expands as Compose tags + RI decisions + calibration fields grow | R2/R3/R4/R11 | declared surface lies; ergonomic debt compounds |
| RI is structurally redundant via undefined Compose subsumption | C1 unresolved | every new harness signal must decide which substrate; cognitive cost mounts |
| Strategy outer-loops bypass instrumentation indefinitely | F1 universal | observability fragments by strategy; diagnostic tooling becomes strategy-specific |

**The "Risk of NOT doing" column is empirically grounded across 97 evidence runs. The "Risk of doing" column is theoretical/mitigable.**

---

## 11. North Star v5.0 Amendments

Proposed amendments to `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`:

### Amendment A — §4.3 Services list

Update the services table to flag:
- `LearningPipeline` (Learn) location: `packages/reasoning/src/kernel/capabilities/learn/` (currently missing; Phase 2 promotes)
- `MemoryService` (Recall) — note the gating by `.withMemory()` is being lifted to default-on in Phase 2

### Amendment B — §4.4 Unifying principle

Add:

> **AND a live emit/consumer site in the same commit it was declared. Surfaces never ship without callers.**

This codifies anti-mission #6 at the architectural-principle level.

### Amendment C — §9 Pruning Principle

Strengthen with anti-pattern audit cadence:

> Quarterly: audit every declared discriminator variant (RI `ControllerDecision`, Compose `TagMap`, `CalibrationField` schema) for `git grep` hit count. Variants with 0 hits must either be wired in next quarter OR documented as `@experimental` with version target. Variants with `@experimental` without version target ≥2 quarters → delete.

### Amendment D — New §10 Empirical Evidence Cadence

> Every architectural decision in this document is grounded in `wiki/Research/Harness-Reports/` evidence. Quarterly: harness improvement loop runs with cross-tier (local + frontier) campaign. Findings update mission statements (L1/L2/L3 metric ladder) and morph spec. **Documents bend to reality OR reality bends to documents — never both silently.**

### Amendment E — §2.3 Gap table

Add row:

| Gap | Description | Phase |
|---|---|---|
| **G-8** | Result surface trust: `totalTokens=0`, `success=true` on failed runs, output leaks (M1/M2/M7) | Phase 0 |
| **G-9** | Scaffold-without-callers anti-pattern in Compose tags / RI variants / calibration / persistence | Phase 0 + 1 |
| **G-10** | Strategy outer-loops bypass kernel instrumentation (F1) | Phase 1 |

---

## 12. GitHub Issue Manifest

### Phase 0 (P0, label: `harness-sweep-2026-05-23-phase0`)

| # | Title | Evidence | Effort |
|---|---|---|---|
| 0.1 | Fix `result.metadata.totalTokens=0` silent loss (M1) | matrix + ablation universal | ~10 LOC + 1 test |
| 0.2 | Output sanitize: rationale XML / CRITIQUE / find-result template leaks (M2a+b+c) | matrix + frontier | ~30 LOC + 3 tests + verifier extension |
| 0.3 | ToT `failed to produce output` → `success=true` propagation (M7) | matrix cross-tier | ~10 LOC + 1 test |
| 0.4 | Three duplicate RI decision event names (R9) | ablation trace data | ~20 LOC + lint rule |
| 0.5 | `interventionsDispatched` counter contamination (R10) | ablation analysis | ~15 LOC + naming + doc |
| 0.6 | Silent skill persistence failure (R11) | M6 audit | ~5 LOC + audit other sites |
| 0.7 | (subsumed by 0.2 — reflexion CRITIQUE markers) | frontier matrix | resolved in 0.2 |
| 0.8 | (subsumed by 0.2 — ToT tool format template) | frontier matrix | resolved in 0.2 |

### Phase 0.5 (P1, label: `harness-sweep-2026-05-23-phase0.5`)

| # | Title | Evidence | Effort |
|---|---|---|---|
| 0.5.1 | ToT tier + complexity cost gate (M3) | matrix 3-23× cost penalty | ~40 LOC |
| 0.5.2 | Adaptive routing — cost dimension (M5) | frontier $/char data | ~80 LOC |

### Phase 1 (P1, label: `harness-sweep-2026-05-23-phase1`)

| # | Title | Evidence | Effort |
|---|---|---|---|
| 1.1 | Bridge RI decisions through Compose tags (C1, closes 4 dead tags) | event coverage diff + ablation | ~30 LOC |
| 1.2 | Capability-scoped instrumentation (E2, closes F1) | capability mapping + sweep | ~50 LOC + schema |
| 1.3 | `transitionState()` discipline + lint rule (E4) | drift analysis 170 sites | ~30 LOC lint + retrofit |
| 1.4 | Required-tool nomination from task text (I2, closes F4/F5) | sweep F4/F5 | ~80 LOC + verifier check |
| 1.5 | `ControllerDecision` union audit + prune/doc (R3) | ablation 8/13 dead | audit + ~50 LOC |
| 1.6 | Wire `emitLLMExchange` at provider boundary (R8, closes F8) | F8 sweep | ~160 LOC across 4 providers |
| 1.7 | Plan-execute synthetic kernel state contract test (R5) | capability mapping | ~30 LOC |
| 1.8 | Triple compression coordination (R6) | architecture debt memory | refactor |

### Phase 2 (P2, label: `harness-sweep-2026-05-23-phase2`)

| # | Title | Evidence | Effort |
|---|---|---|---|
| 2.1 | Open `learn/` capability + LearningPipeline service (I3 + I7) | M6 audit + capability mapping | medium |
| 2.2 | Multi-severity verifier (I5, closes F4 structurally) | sweep F4 + matrix M2 | ~60 LOC |
| 2.3 | Cross-session skill persistence default-on | M6 audit + anti-mission #6 | ~100 LOC |

### Phase 3 (P3+, label: `harness-sweep-2026-05-23-phase3`)

| # | Title | Evidence | Effort |
|---|---|---|---|
| 3.1 | Single Arbitrator (E1) | drift analysis 5 parallel systems | large |
| 3.2 | Composite confidence signal (I1) | F3 + F4 sweep | large |
| 3.3 | Capability composition routing (I4) | capability mapping + M5 | large |

**Total: 22 issues (8 P0 + 2 P1 + 8 P1 + 3 P2 + 3 P3 = 24, minus 2 subsumed = 22 distinct).**

---

## 13. Implementation Sequencing

### Sprint 1 — Phase 0 (1 sprint, est 1-2 weeks)
- Issue 0.1 + 0.2 + 0.3 land first (most-impactful + cheapest)
- 0.4 + 0.5 + 0.6 land in parallel (lint + counter audit + emit-error fix)
- Verification: re-run cross-strategy matrix + RI ablation; data must show 0 cells with M1/M2/M7/R10/R11 patterns

### Sprint 2 — Phase 0.5 (0.5 sprint, est 3-5 days)
- 0.5.1 + 0.5.2 (ToT cost gate + adaptive routing redesign)
- Verification: re-run matrix with adaptive strategy on all tasks; cost matches predicted best strategy ≥80%

### Sprint 3-5 — Phase 1 (3 sprints, est 4-6 weeks)
- 1.1 + 1.2 first sprint (Compose bridge + capability-scoped emit)
- 1.3 + 1.4 second sprint (transitionState discipline + soft-required tools)
- 1.5 + 1.6 + 1.7 + 1.8 third sprint (cleanup + provider boundary + contract tests + compression coord)
- Verification: L1 + L2 metrics all green; ≤5% regression on existing test suite

### Sprint 6-8 — Phase 2 (3 sprints, est 4-6 weeks)
- 2.1 first (learn/ capability)
- 2.2 + 2.3 in parallel
- Step 5 dedicated probe runs (Q3c finally measurable)

### Sprint 9-12 — Phase 3 (4+ sprints, est 6-10 weeks)
- 3.1 (Arbitrator) is the big one — gated by Phase 1 completion
- 3.2 + 3.3 follow

---

## 14. What This Spec Does NOT Do

These were considered and explicitly excluded:

- **NOT collapsing strategies into kernel** — capability mapping shows <30% mappable; algorithmic divergence is genuine.
- **NOT subsuming RI under Compose** — ablation shows RI's decision logic is empirically load-bearing on at least one tier.
- **NOT redesigning the entire architecture** — North Star v5.0 already describes the target; this is migration, not greenfield.
- **NOT shipping new features** — Phase 0+1 are debt closure and trust restoration, not feature work. Phase 2+3 are structural prerequisites for compounding intelligence, not user-facing features per se.
- **NOT changing public API contracts** — every change is additive (new fields, new methods, new tags) or strictly-better (verifier emits more info, totalTokens reads correctly).

---

## 15. Living Document Convention

This spec evolves with evidence. Convention:

- **Adding a finding:** new evidence report under `wiki/Research/Harness-Reports/` + amendment to relevant Phase section + GH issue.
- **Retracting a finding:** evidence report explaining contradicting data + Phase amendment + close GH issue with rationale.
- **Sequencing change:** amendment to §13 + rationale tied to dependency analysis.
- **Mission statement amendment:** edit `06-MISSION-STATEMENTS.md` + cite this spec + log in amendment history.

This spec is **AUTHORITATIVE for the sweep-2026-05-23 follow-on work** and lives until either:
- All 22 issues close → spec marked `complete` and archived as historical
- New sweep evidence overrides priorities → spec updated or superseded

---

## 16. Maximum Optimization Statement

The morph target is NOT incremental improvement. It is convergence on the elegant end state that **already exists in North Star v5.0 §4** but isn't fully wired. Every Phase 0 issue restores a broken promise. Every Phase 1 issue closes a scaffold-without-caller. Every Phase 2 issue activates a dormant capability. Every Phase 3 issue collapses parallelism into single-Arbitrator discipline.

**The end state:**

- A user runs an agent. Every decision traces to a signal. Every signal traces to a source line. Every advertised capability fires when claimed. Cost is accurate. Output is clean. Success means success.
- Adding a strategy is array literal, not 1500 LOC.
- Adding a Compose hook is one tag emission, not a TagMap declaration without consumers.
- Cross-session learning compounds by default.
- Local-tier and frontier-tier produce equivalent quality on aligned tasks; tier-specific advice surfaces structurally, not via prompt-engineering folklore.
- The harness is small enough that the entire decision pipeline fits in one diagram, one mental model, one sentence: **"Sense → Reason → ARBITRATE → Act → LEARN, with every emit observable, every override hookable, every advertised surface wired."**

That is the harness mission. This spec is the path.

---

## Appendix A — Evidence Trail Cross-Reference

| Finding | Severity | Sweep doc | Matrix doc | Ablation doc | Audit doc |
|---|---|---|---|---|---|
| M1 totalTokens | 🔴 | — | matrix analysis §M1 | ablation roll-up | — |
| M2a rationale XML | 🔴 | — | matrix analysis §M2 | — | — |
| M2b CRITIQUE leak | 🔴 | — | frontier matrix | — | — |
| M2c find-result | 🔴 | — | frontier matrix | — | — |
| M7 success bool | 🔴 | — | matrix analysis §M7 | — | — |
| R9 dup names | 🔴 | — | — | ablation §R9 | — |
| R10 disp counter | 🔴 | — | — | ablation §R10 | — |
| R11 silent fail | 🔴 | — | — | — | m6-persistence §R11 |
| M3 ToT cost | 🟠 | — | matrix §M3 + frontier | — | — |
| M5 strategy fit | 🟠 | — | matrix §M5 + frontier | — | — |
| F1 plan-execute trace | 🟢 | sweep F1 | capability mapping | — | — |
| F4 verifier shallow | 🟢 | sweep F4 | — | — | — |
| F5 soft-required tools | 🟢 | sweep F5 | — | — | — |
| F7 llm-exchange | 🟢 | sweep F7 | — | — | — |
| F8 thinking-mode | 🟡 | sweep F8 | — | — | — |
| Q2a capability map | static | — | — | — | capability-mapping |
| Q1c coverage diff | static | — | — | — | event-coverage-diff |
| Q3 learn gating | static | — | — | — | m6-persistence |
| Scaffold pattern (R2-R4) | architectural | — | — | — | E/R/I audit |

---

**End of spec. 22 issues filed. Ready for execution via `/execute-backlog` skill or direct bundle PRs. Phase 0 must close before Phase 1 begins; everything downstream depends on the result surface telling the truth.**
