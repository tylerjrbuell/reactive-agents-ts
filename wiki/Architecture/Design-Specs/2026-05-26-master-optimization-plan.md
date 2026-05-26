---
title: Master Optimization Plan — Closing the Architecture-to-Performance Gap
date: 2026-05-26
status: AUTHORITATIVE (consolidates Levers 1-8 perf work + 5 architecture docs into one execution path)
owner: Architecture
adoption_context: 10 stars / 1.1k NPM downloads — pre-PMF, rewrite permission HIGH
companion-required-reading:
  - "wiki/Architecture/Specs/00-VISION.md"
  - "wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md"
  - "wiki/Architecture/Specs/06-MISSION-STATEMENTS.md"
  - "wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md"
  - "wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md"
  - "wiki/Architecture/Design-Specs/2026-05-25-strategic-direction-memo.md"
  - "wiki/Architecture/Design-Specs/2026-05-25-framework-composition-vision.md"
  - "wiki/Architecture/Design-Specs/2026-05-24-strategy-composability-design.md"
supersedes-frame: "perf wins as one-off levers" → "perf wins as derived consequences of a unified policy layer + execution model"
---

# Master Optimization Plan — Closing the Architecture-to-Performance Gap

## 0. TL;DR — One Page

**The framework's vision is fully articulated; the architecture target is fully specified; the perf wins are landing as scattered tacked-on conditionals across 5 modules.** This plan unifies them.

**Eight Levers shipped (May 2026):** Anthropic prompt caching, skinny iter-1+ prompt, RI early-stop, rationale/token plumbing, trivial-task debrief gate, trivial-task memory-flush gate, short-output gate, final-answer-via-tool veto exemption. Each is a *conditional skip based on run state*. Each lives inline in a different module. No central policy surface. Pattern is recognized — *not yet structural*.

**The structural deficit, named honestly:**

1. **No central capability cost model.** Each module decides its own gates against ad-hoc local state. The same "is this task trivial?" classification is recomputed in three places with different definitions.
2. **No task-signature profile at bootstrap.** Classification exists for strategy selection only; never used to narrow the active default-on capability set.
3. **Defaults scattered across 5 files with no audit trail.** `_enableReactiveIntelligence: true` lives in `builder.ts:302` without rationale. `withLeanHarness()` is leaky (skips RI). Users can't enumerate "what's on by default and why."
4. **No per-stage cost telemetry at runtime.** Profile scripts hand-written per investigation (`/tmp/profile-t1.ts`). Lift can't be measured continuously. Ablation-warden pilot exists but isn't fed by structured signal.
5. **75 `withX()` methods is the composition surface** — anti-mission #3 violation per Mission Statements. Knobs are unfindable. Vision claim "control over magic" can't be realized through a 75-method API.

**Six architectural moves (sequenced by leverage):**

| # | Move | Unlocks | Effort | Status (2026-05-26 EOD v2) |
|---|---|---|---|---|
| **MOVE-1** | Stage Telemetry Bus | All measurable lift work | 2 d | ✅ **SHIPPED** pre-plan via #117 (`2b015546` emitLLMExchange wire) |
| **MOVE-2** | Capability Cost Registry | Ablation-warden + auto-skip + auto-document | 3 d | ✅ **SHIPPED** — design `d26e9616` + M2.1+M2.2 `3752a43e` + M2.3 gate `344c0910` (only M2.4 docs-flip remains; in this commit) |
| **MOVE-3** | Task-Signature Profile at bootstrap | Replaces 5+ scattered gates with 1 decision | 1 wk | 🟢 **Phase 1 + 2 SHIPPED** `fa831f44` (honest debrief gate) + `4fa057ea` (memory-flush snapshot consume); Phase 3 (TaskComplexity type unification + reactive-intelligence/learning 4th classifier audit) NEXT |
| **MOVE-4** | Combinator-shaped strategies (LEVERAGE-1 from Strategic Memo) | Pillar 3 + Pillar 4 + ≤200 LOC strategy ceiling | 2 wk | 🟡 primitives + iterateUntil combinator shipped pre-plan via PR #137 (`253e50a0`); full combinator migration not started; deprioritized per §0.5 user decision |
| **MOVE-5** | Capability emit-at-boundary (G-10) | Pillar 2 + observability completeness | 1 wk | ✅ **SHIPPED** pre-plan via #113 (`bd0fba81` capability-scoped instrumentation) |
| **MOVE-6** | Composition presets (`HarnessProfile`) replace leaky `withLeanHarness()` | Pillar 1 + Pillar 6 + vision claim "control over magic" | 3 d | ✅ **SHIPPED** `af32860e` — `HarnessProfile.{lean,balanced,intelligent}()` + `builder.withProfile()` + registry-drift-guard test. Closes Lever-8 leak (lean now truly disables RI). |
| **GH #127** | (Adjacent) Thread `harnessPipeline` through PlanExecute + ToT inputs | Compose-tag emission on outer-loop strategies | ~30 LOC | ✅ **SHIPPED** `d8817985` on overhaul branch (warmup bundle) |

**Outcome at full landing:** Every Lever-N PR going forward is *a config addition to the registry*, not a new conditional in a kernel module. New strategies are array literals ≤200 LOC. `agent.metrics.stages` becomes first-class. Users see exactly what's active and pay nothing for what they didn't ask for. The architecture *is* the optimization, not a substrate that resists it.

**Vision pillar coverage:** Control (MOVE-2, MOVE-3, MOVE-6), Observability (MOVE-1, MOVE-5), Flexibility (MOVE-3, MOVE-4), Scalability (MOVE-3, MOVE-4), Reliability (MOVE-5), Efficiency (MOVE-1, MOVE-2, MOVE-3), Speed (MOVE-3, MOVE-4 downstream).

> **Naming note:** MOVE-N is used throughout to avoid collision with the project's existing M1–M14 mechanism IDs (M3 Verifier+Retry, M6 Skill Persistence, etc. — see MEMORY.md + NS v5.0 §2.2). When this plan says MOVE-3 it means Task-Signature Profile, NOT M3 Verifier+Retry.

---

## 0.5. Decision History + Active Branch

**2026-05-26 user sign-off (implicit via "continue with recommendations" + "bundle all pending improvement work into a single improvement/overhaul branch"):**

| Decision point | Resolution |
|---|---|
| Root causes (§3) correct? | YES — 5 root causes accepted; deficit confirmed when audit revealed `_enableReactiveIntelligence: true` at `builder.ts:302` has zero collocated rationale + Lever-8 regression was caught by Mastra bench not registry-driven gate. |
| 6-move sequence correct? | YES with one re-ordering — execution shipped C (verification) + A (MOVE-3 Phase 1+2) + B (MOVE-2 design spec) in that order on the overhaul branch. MOVE-1 + MOVE-5 + MOVE-4 substrate were ALREADY shipped pre-plan (see §0 status table). MOVE-6 deferred until MOVE-2 impl lands. |
| MOVE-4 v0.12 priority? | NO — combinator migration deprioritized in favor of MOVE-2 + MOVE-6 (registry + presets) which directly enable the v0.12 "control over magic" vision claim. Combinator primitives already in (PR #137); full migration becomes a v0.13 candidate. |
| Killer demo / public bench publication (proposed Track B from architect's second-take review)? | DROPPED — user redirected to "foundation first... public showcase later" (2026-05-26 message). Track B re-evaluated after MOVE-2/6 ship. |

**Active branch:** `overhaul/foundation-2026-05-26` (off `origin/main`). All foundation improvement commits land here; PR up after MOVE-2 M2.1+M2.2 minimum.

**4 commits shipped today (2026-05-26):**

```
d26e9616 docs(architecture): MOVE-2 design spec — Capability Cost Registry
4fa057ea refactor(runtime): memory-flush honors upstream taskComplexity snapshot (MOVE-3 Phase 2)
fa831f44 fix(runtime): honest debrief trivial-skip gate (MOVE-3 Phase 1 / GH #143)
d8817985 fix(reasoning): thread harnessPipeline through PlanExecute + ToT inputs (GH #127)
```

Workspace test count: 5650 (baseline) → 5657 (+7 net, zero regressions). Build 38/38 green throughout.

**Ablation-warden verdict (2026-05-26, dispatch `aa869310bafb72942`): ✅ PASS — keep default-on.**

| Probe | N | Result |
|---|---|---|
| Local qwen3.5:latest × {k1, k3, f2} × {before, after} × N=3 | 18 | −1 Ollama POST per trivial task (100% of runs); 18/18 success; debrief presence flips 100% → 0% as designed; mean wall-clock saved 5.5–6.9s/task |
| Frontier claude-sonnet-4-6 × {k1, k3, f2} × {before, after} × N=1 | 6 | 6/6 success; debrief presence flips 100% → 0%; zero accuracy regression |

**Note on measurement:** bench's `result.metadata.tokensUsed` does NOT aggregate finalize-phase debrief LLM call (per warden + GH #143). Warden instrumented `fetch` monkey-patch to count Ollama POSTs as honest cross-tier instrument. Wall-clock corroborates direction.

**Evidence artifact:** `wiki/Research/Ablations/2026-05-26-debrief-trivial-skip-gate.md` (full warden report + raw data tables). Probe source + raw JSON under `bench/mastra-vs-ra/ablation/`.

**Recommended follow-ups from warden (filed as separate GH issues, not blocking):**
1. Cross-session prior-debrief-injection path at `reasoning-think.ts:130-147` — verify behavior after trivial predecessors leave no persisted row. Almost certainly net-positive (skipped debriefs were 47% truncated, 52% empty per #143), but uncovered by this probe.
2. GH #143 not-yet-fully-resolved: `result.metadata.tokensUsed` excludes finalize-phase LLM calls — bench remains skewed against RA until fixed.

**Gate effect on planning:** MOVE-2 M2.1 impl was self-described as "impl waits on ablation-warden Phase 1 verdict" — now unblocked.

---

## 1. Why This Plan Exists

### 1.1 The Lever pattern is structural, not coincidental

Eight perf PRs shipped since v0.11.1 (commits `6430f797` → `98118fd1`). Pattern across all of them:

| Lever | What it does | Where it lives | What it gates on |
|---|---|---|---|
| **1** Anthropic caching | Provider-level multi-turn discount | `packages/llm-provider/src/providers/anthropic.ts` | provider capability |
| **2** Skinny iter-1+ prompt | Drop stable sections after iter 0 | `packages/reasoning/src/context/context-manager.ts:272` | iter count |
| **3 RI early-stop** | Empty-run invariant | `reactive-intelligence/.../*-controller.ts` | run state |
| **4 rationale/token** | Gate rationale on tools | `packages/reasoning/src/kernel/.../rationale.ts` | tool count |
| **5 debrief honesty** | Trivial-task LLM skip | `packages/runtime/src/engine/finalize/debrief-synthesis.ts:186` | output length + tool count + errors |
| **6 memory-flush dispatch** | Trivial/moderate/complex split | `packages/runtime/src/engine/phases/memory-flush-dispatch.ts` | iter count + tool count + entropy |
| **7 short-output gate** | Relaxed trivial gates | `debrief-synthesis.ts` + `memory-flush.ts` | output length |
| **8 final-answer veto** | Deliberate-exit veto exemption | `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts:900` | termination channel |

**Every lever is a conditional skip based on (run state ∪ task shape ∪ provider capability).** Across 5 different modules. No two use the same predicate vocabulary. `isTrivial` means different things in `debrief-synthesis.ts` vs `memory-flush.ts`.

This is the same anti-pattern North Star §9 ("Scaffold without callers") + Mission Anti-mission #3 ("24 named override methods IS the failure mode") describe in two other dimensions. Each individual lever PR was correct. The sum is unmaintainable.

### 1.2 The cost of NOT consolidating

Three concrete costs already paid:

1. **Lever 8 was a quality regression.** RI default-on + veto firing on tool-mediated final-answer broke f1 graceful-failure. Required digging through arbitrator + trace + 5 tests to find. If a capability cost registry existed with "RI: defaults on; cost: 1 controller decision per iter; risk: spurious veto on graceful-failure tasks" — the regression would have been caught by ablation-warden CI, not by Mastra benchmark divergence.

2. **`withLeanHarness()` is leaky** — disables verifier + strategy switching + memory; does NOT disable RI. Caught only when investigating Lever 8. Reflects no architectural concept of "lean."

3. **Next 5 Levers identified by advisor + bench evidence** (loop-detector hammering, iter reduction, output salvage, lean composability, knob discoverability) — *every one of them adds another inline conditional* under current architecture. We are about to ship 5 more anti-pattern instances.

The cost compounds: each new conditional makes the next harder to add (cognitive load) AND harder to revert (test pinning).

### 1.3 What this plan is not

- **Not new vision.** Vision is `00-VISION.md`, 8 pillars, stable, fully articulated.
- **Not new architecture target.** Target is `05-DESIGN-NORTH-STAR.md §4` — 10 capabilities, 5 traits, single Arbitrator, ≤10 mutation sites.
- **Not new mission framing.** Missions are `06-MISSION-STATEMENTS.md` — positive, measurable, falsifiable.
- **Not new sequencing.** Sequencing is `2026-05-25-strategic-direction-memo.md` — leverage-ordered moves toward v1.0.

> **Net-new vs reframe.** MOVE-4 (combinator strategies) and MOVE-5 (capability emit-at-boundary) are restatements of LEVERAGE-1 and LEVERAGE-2 from the Strategic Memo — appropriate to include here because the 6-move sequence is unified, but they are NOT new contributions. **MOVE-1 (stage telemetry), MOVE-2 (capability cost registry), MOVE-3 (task-signature profile), and MOVE-6 (HarnessProfile presets) are net-new framing** named here for the first time as the structural deficit the Lever PRs revealed.

**This plan is the bridge between the perf work happening today and the architecture work already specified.** It names the structural deficit that connects them.

---

## 2. Where We Are (Objective Delta)

Anchored to `05-DESIGN-NORTH-STAR.md`, `06-MISSION-STATEMENTS.md`, `2026-05-25-strategic-direction-memo.md`.

### 2.1 What's shipped (~80%)

✅ **Phase 0** (Sweep 2026-05-23): 5 P0 issues — result-surface trust restored (#105/106/107/108/109).
✅ **Phase 0.5 + Phase 1 + Phase 2** (Harness Convergence — fully closed by 2026-05-26): all GH issues #110-#122 SHIPPED. Only Phase 3 (#123/124/125 P3) + #127 followup remain open at draft time. Audit table corrected after recheck showed convergence backlog had landed faster than plan v1 assumed.
✅ **Phase A** (Architecture Cleanup): `execution-engine.ts` 4499→1539 LOC; `builder.ts` 6232→2407 LOC. 39 focused modules.
✅ **Phase B** (Compose API Waves A–F): 7 chokepoints + 6 killswitches + `RunHandle` + `.withX()` desugaring.
✅ **Phase C** (v0.11 Launch): playground + ROADMAP + skill persistence (MOVE-6) + Snapshot/Replay + `@reactive-agents/observe` + `create-reactive-agent` CLI + code-action strategy.
✅ **8/13 mechanisms** at KEEP verdict from Phase 1 sweep.
✅ **4 drift contracts** (PR #137) + 4 primitives shipping; ablation-warden pilot active (2026-05-23 → 2026-06-15).
✅ **MOVE-1 (Stage Telemetry Bus)** — wired pre-plan via #117 (`2b015546`); see §0 table.
✅ **MOVE-5 (Capability emit-at-boundary, G-10)** — wired pre-plan via #113 (`bd0fba81`); see §0 table.
✅ **MOVE-3 Phase 1 + Phase 2** — honest debrief gate (`fa831f44`) + memory-flush snapshot consume (`4fa057ea`); see §0 table.
✅ **GH #127** — outer-loop harnessPipeline thread (`d8817985`); see §0 table.
🟡 **MOVE-2** — design spec shipped (`d26e9616`); impl deferred per spec §5.

### 2.2 What's drifting (40%)

From Strategic Memo §3 + this plan's own audit:

| Aspect | Target | Current | Source |
|---|---|---|---|
| Capability dirs | 10 (Sense → Learn) | 10 present; `recall/` + `learn/` added in last 30d | NS §4.3 |
| Strategy LOC ceiling | ≤200 each | reflexion 774, plan-execute 1548, ToT 727 | Mission Pillar 3 |
| Strategy shape | "array literals" | Hand-written `Effect.gen` programs | Mission Pillar 3 |
| Builder methods | "one composition surface" | 75 `withX()` methods | Anti-mission #3 |
| Mutation sites | ≤10 | not audited (Mission Pillar 4 unenforced; lint rule from convergence #114 in flight) | Mission Pillar 4 |
| Capability emit at boundary | every capability | ✅ **CLOSED** via #113 — outer-loop strategies now emit `kernel-state-snapshot` per iter; trace replay covers all 7 strategies | G-10 / MOVE-5 |
| Scaffold without callers | zero | Phase 0 fixed 5; ~4 instances remain | G-9 |
| Default-on rationale registry | every default declares why | 🟡 design spec shipped (`2026-05-26-capability-cost-registry.md`); impl pending — `_enableReactiveIntelligence: true` is still a literal at builder.ts:302 awaiting MOVE-2 M2.1 | MOVE-2 |
| Per-stage cost telemetry | first-class | hand-written profile scripts | new gap (this doc) |
| Task-signature profile | bootstrap classification | classifier exists only for strategy selection | new gap (this doc) |

The first 7 are already named in the docs. The last 3 are **named for the first time here** — they are the architecture deficit the Lever PRs revealed.

### 2.3 Eight Levers as evidence

Below: each Lever's conditional reframed as "what would a unified architecture have made trivial."

| Lever | Current shape | Under unified architecture |
|---|---|---|
| **1** Anthropic caching | Provider-specific conditional inside `complete()` | `CapabilityRegistry.register("prompt-cache", { providerCapability: "anthropic-ephemeral-cache" })` — auto-activates when provider declares support |
| **2** Skinny iter-1+ | Inline `if (state.iteration === 0)` in context-manager.ts | `CostRegistry.section("priorContext", { skipAfterIter: 0, reason: "stable; in message thread" })` — registry-driven section gating |
| **3** RI early-stop | Inline check in RI controller | `CapabilityRegistry.policy("ri-controller", { skipWhen: "iter === 0 && stepCount === 0" })` |
| **4** Rationale on tools | Conditional in rationale emission | `TaskProfile.requires("rationale", { when: "toolCount > 0" })` |
| **5** Debrief honesty | `isTrivialForDebrief` ad-hoc helper | `TaskProfile.classify(ctx).shape === "single-shot-short"` → debrief skipped |
| **6** Memory-flush dispatch | Trivial/moderate/complex helper duplicating classification | Same `TaskProfile` source; dispatch mode is a registry policy |
| **7** Short-output gate | Two separate "trivial" definitions in two files | Same `TaskProfile.outputShape` field |
| **8** Final-answer veto | Inline `if (intent.via !== "tool")` in arbitrator | `ArbitrationPolicy.veto({ exemptOn: ["tool-mediated-exit"] })` — declarative, testable in isolation |

**Each lever required reading 3-5 files to find the right spot.** Under unified architecture, each is a 2-line registry entry next to a test.

---

## 3. Root Cause Analysis — Five Structural Issues

Naming each, in order of leverage:

### 3.1 R1: No Capability Cost Model

**Symptom:** Default-on flags scattered (`builder.ts:302`, `runtime.ts:195`, env vars, magic constants). No file lists "what runs by default and why." Users can't enumerate active capabilities. Maintainers can't justify defaults.

**Root cause:** Capabilities are added one at a time as features, never as cost-bearing policy decisions. Each PR adds `_enableX` as a literal default with implicit rationale.

**Consequence:** `withLeanHarness()` is leaky because lean is defined operationally per-call-site, not declaratively. Ablation-warden CI has no structured signal to compare against.

**What "fixed" looks like:** A `capability-registry.ts` file every default points to. Adding a new default-on requires declaring `{ defaultOn: true, expectedLift: number, expectedOverhead: number, conditions: TaskProfile }`. Ablation-warden auto-gates against the registry.

### 3.2 R2: No Task-Signature Classification at Entry

**Symptom:** Each module reclassifies "is this trivial" locally with different definitions:
- `debrief-synthesis.ts:186` — `outputLen < 100 && errors === 0`
- `memory-flush.ts:128` — `outputLen > 200 || toolCount >= 2`
- `classifyComplexity` (somewhere in strategies) — iter count + tool count + entropy

Three definitions. Same intent. Different file.

**Root cause:** Task classification was built for adaptive *strategy selection* only. Never generalized to "shape the capability set for this task."

**Consequence:** Mid-loop conditionals fight bootstrap config. Levers 5/6/7 all add their own classification. Future Levers will add more.

**What "fixed" looks like:** `TaskProfile.classify(input) → { shape, estimatedIters, toolDependency, expectedOutputShape }` once at bootstrap. Every capability gate reads `ctx.taskProfile`. Single decision point. Override surface is `.withTaskProfile()` for users who know better.

### 3.3 R3: No Per-Stage Cost Telemetry

**Symptom:** Diagnosing "where did 35 seconds go on t1?" requires writing a custom profile script (`/tmp/profile-t1.ts`, `/tmp/profile-k1.ts` — both shipped this session as throwaway artifacts).

**Root cause:** EventBus emits lifecycle events (phase started/complete) but not structured cost. `phase_complete` carries `duration` but not `tokenDelta` or `skipped`. No `agent.metrics.stages` surface.

**Consequence:** Lift can't be measured continuously. Each new Lever requires a new throwaway profile script to prove its case. Bench-driven regression detection is the only signal — slow loop.

**What "fixed" looks like:** `StageBus` event per stage entry/exit with `{ name, durationMs, tokenDelta, skipped, skipReason }`. `agent.result.metrics.stages` is first-class. `rax-diagnose stages <runId>` works without trace mining.

### 3.4 R4: Strategies Bypass Capability Instrumentation (G-10, already named)

**Symptom:** `runner.ts` owns emit. Strategy outer-loops (ToT, reflexion, plan-execute) reimplement loop control and bypass kernel instrumentation. Trace coverage gaps depending on which strategy fires.

**Root cause:** Per Strategic Memo LEVERAGE-2 — capability emit at boundary not enforced. Strategies as `Effect.gen` programs (not array-literal compositions per Pillar 3) are the structural enabler.

**Consequence:** Pillar 2 ("Observability — every state transition emits") fails on non-reactive strategies. Drift contracts can't enforce what doesn't emit uniformly.

**What "fixed" looks like:** Combinator layer (`iterateUntil`, `branchAndPick`, `routedDispatch` per `2026-05-25-framework-composition-vision`) becomes the substrate strategies compose over. Combinators own the emit. Strategies inherit observability. Per Strategic Memo §LEVERAGE-1: reflexion 774 → ~150 LOC.

### 3.5 R5: 75 `withX()` Methods Are the Composition Surface

**Symptom:** Anti-mission #3 ("24 named override methods IS the failure mode") — except RA shipped 75, three times the failure threshold. Users can't enumerate. Onboarding examples cherry-pick 6. Knobs for advanced features are invisible.

**Root cause:** Every feature shipped its own `.withFeature()` wither. Composition never refactored. `withLeanHarness()` is the only preset and it's leaky.

**Consequence:** Vision claim "control over magic" not realizable through API. Most knobs unused because undiscoverable.

**What "fixed" looks like:** `HarnessProfile` presets (`HarnessProfile.lean()`, `HarnessProfile.standard()`, `HarnessProfile.intelligent()`, `HarnessProfile.research()`) are the primary API. `.compose(harness => ...)` is the override path for advanced. `.withX()` methods desugar to harness composition (already true post-Phase B Wave E). Withers stay as backward-compat sugar; presets become primary docs surface.

---

## 4. The Master Plan — Six Architectural Moves

Each move:
- Has one structural goal
- Closes ≥1 named gap (G-X) or anti-mission
- Has a falsifiable validation gate
- Is implementable in ≤2 weeks by one engineer
- Unblocks ≥1 subsequent move

Ordered by leverage (closes most gaps × unblocks most downstream work).

---

### MOVE-1: Stage Telemetry Bus (2 days, foundation)

**Goal:** Every stage emits structured cost on entry + exit. No throwaway profile scripts.

**Scope:**
- Add `StageEvent { stage, phase: "enter"|"exit", durationMs?, tokenDelta?, skipped?, skipReason? }` to `packages/observability`.
- Wire emit on every `phase.run()` site in `packages/runtime/src/engine/phase.ts` runner + every capability boundary in `packages/reasoning/src/kernel/loop/runner.ts`.
- `agent.result.metrics.stages: StageMetric[]` becomes first-class on TaskResult.
- `rax-diagnose stages <runId>` command (read-only; consumes existing trace).

**Closes:** R3 (no per-stage telemetry).

**Validation gate:**
- [ ] `agent.result.metrics.stages` populated on every run with ≥1 entry per active capability
- [ ] Skipped phases emit `{ skipped: true, skipReason }` event
- [ ] Bench k1 task: stage count is exactly 1-iter shape (no spurious stages)
- [ ] No regression in 5652-test suite
- [ ] Hand-written profile scripts (`/tmp/profile-*.ts`) deleted from session history

**Why first:** All subsequent moves need to *measure* impact. MOVE-2's registry needs cost data. MOVE-3's profile needs lift data. Without MOVE-1, ablation-warden CI can't auto-decide.

---

### MOVE-2: Capability Cost Registry (3 days, replaces scattered defaults)

**Goal:** Every default-on capability declared in one file with rationale + cost expectations + conditions.

**Scope:**
- New file: `packages/reasoning/src/capability-registry.ts` (or `packages/core/...` if shared with runtime).
- Schema:
  ```ts
  interface CapabilityRegistration {
    readonly name: string                       // "reactive-intelligence"
    readonly defaultOn: boolean                 // currently true
    readonly rationale: string                  // "entropy scoring + adaptive control"
    readonly expectedLift: { metric: string; value: number }   // { metric: "quality", value: 0.05 }
    readonly expectedOverhead: { metric: string; value: number } // { metric: "tokens", value: 0 }
    readonly conditions?: Partial<TaskProfile>   // { taskShape: ["multi-step", "tool-required"] }
    readonly providerCapability?: string         // "anthropic-ephemeral-cache"
    readonly leanCompatible: boolean             // false → withLeanHarness() disables
  }
  ```
- Migrate the 12+ scattered defaults (RI, strategy switching, debrief gate, memory-flush dispatch, rationale, RA_LAZY_TOOLS, ContextCurator stages, etc.) into the registry.
- Ablation-warden reads registry; CI auto-fails defaults below `expectedLift` or above `expectedOverhead`.

**Closes:** R1 (no cost model). Hardens G-9 (scaffold without callers — registry is the single source).

**Validation gate:**
- [ ] `wc -l packages/reasoning/src/capability-registry.ts` > 0 with ≥12 entries
- [ ] Grep for `_enableX: true =` literals in `packages/runtime/src/builder.ts` returns 0 results outside registry
- [ ] `withLeanHarness()` disables exactly the capabilities where `leanCompatible: false`
- [ ] Ablation-warden CI run shows ≥1 default flagged for review (existence of mechanism)
- [ ] `bun run docs:capabilities` generates `apps/docs/.../capabilities.mdx` from registry

**Vision alignment:** Pillar 1 (Control — every default named + justified), Pillar 6 (Efficiency — cost auditable).

---

### MOVE-3: Task-Signature Profile at Bootstrap (1 week, replaces 5+ scattered classifiers)

**Goal:** Classify task ONCE at agent.run() entry. Every capability gate reads `ctx.taskProfile`. Single decision point replaces inline conditionals across `debrief-synthesis.ts`, `memory-flush.ts`, `rationale.ts`, and future Levers.

**Scope:**
- Extend existing `ContextProfile` (per-tier) with `TaskProfile` (per-task):
  ```ts
  interface TaskProfile {
    readonly shape: "single-shot" | "single-tool" | "multi-step" | "long-form" | "critique" | "recovery"
    readonly estimatedIters: { min: number; max: number; mode: number }
    readonly toolDependency: "none" | "one" | "many"
    readonly outputShape: "short" | "medium" | "long" | "structured"
    readonly hasTemporalHint: boolean       // task references "today", "current", etc. → env block warranted
    readonly explicitTermination: boolean   // task says "stop after N attempts" → loop-detector tighter
  }
  ```
- Classifier (`classifyTask(input) → TaskProfile`) at `engine/bootstrap/`. Heuristic-first (regex + length + tool count); LLM-classifier fallback for ambiguous cases (existing `adaptive.ts` heuristic-pre-classifier pattern).
- `ExecutionContext.taskProfile` populated by bootstrap; read-only after.
- Migrate Levers 4/5/6/7's inline classifications to read `ctx.taskProfile.shape` + `ctx.taskProfile.outputShape`.
- Override surface: `.withTaskProfile(profile)` for users who want to bypass classification.

**Closes:** R2 (no task-signature classification at entry). Indirectly enables MOVE-2 (registry conditions check TaskProfile).

**Validation gate (MOVE-3 PR does NOT land until ALL pass):**
- [ ] All 11 bench tasks classified correctly under heuristic (no LLM fallback needed)
- [ ] **Migration done in the same PR:** `debrief-synthesis.ts:isTrivialForDebrief` reads `ctx.taskProfile.outputShape`; `memory-flush.ts:128` multi-tool gate reads `ctx.taskProfile.toolDependency`; rationale-on-tools reads `ctx.taskProfile.toolDependency`
- [ ] **Inline classification helpers DELETED** from those 3 files (grep returns 0 matches for `isTrivial*`, ad-hoc multi-tool predicates, etc.). Anti-pattern prevention: scaffold-with-≥3-live-callers, never a registry shipped empty.
- [ ] Bench: zero regression on 11-task local sweep vs Lever 8 baseline
- [ ] Bench: ≥1 task moves to a cheaper capability set (e.g., k1 skips RI when shape="single-shot")

**Vision alignment:** Pillar 1 (Control — profile inspectable + overridable), Pillar 6 (Efficiency — pay only for what task requires).

---

### MOVE-4: Combinator-Shaped Strategies (2 weeks, LEVERAGE-1 from Strategic Memo)

**Goal:** Strategies become declarative array literals over combinators (`iterateUntil`, `branchAndPick`, `routedDispatch`) per `2026-05-25-framework-composition-vision`. Each strategy ≤200 LOC per Pillar 3.

**Scope:**
- Per Strategic Memo LEVERAGE-1: ship 3 combinators that encapsulate the loop-control patterns reflexion / plan-execute / code-action currently hand-write.
- Migrate reflexion (774 → ~150 LOC target) as the first strategy refactor.
- Migrate plan-execute (1548 → ~200 LOC).
- Migrate ToT (727 → ~150 LOC).
- Combinators inherit emit (MOVE-5 dependency).

**Closes:** Pillar 3 ceiling violation (3 strategies 4-7× over budget). Unblocks "new strategy in code review, not 1500-LOC PR."

**Validation gate:**
- [ ] `wc -l packages/reasoning/src/strategies/reflexion.ts` ≤ 200
- [ ] `wc -l packages/reasoning/src/strategies/plan-execute.ts` ≤ 250 (allow +25% for plan section)
- [ ] `wc -l packages/reasoning/src/strategies/tree-of-thought.ts` ≤ 200
- [ ] All existing strategy tests pass post-migration
- [ ] Bench: zero regression on 11-task local sweep + 4-task frontier sweep
- [ ] Adding a 7th strategy (proof of concept: `self-consistency`) is ≤200 LOC + ≤50 LOC tests

**Vision alignment:** Pillar 3 (Flexibility), Pillar 4 (Scalability), Pillar 6 (Efficiency through reuse).

**Reference:** `wiki/Architecture/Design-Specs/2026-05-24-strategy-composability-design.md` for combinator design.

---

### MOVE-5: Capability Emit-at-Boundary (1 week, G-10, coupled to MOVE-4)

**Goal:** Every capability dir owns its own emit at the boundary. Strategies become observable identically regardless of control-flow shape.

**Scope:**
- Move emit calls from `runner.ts` to each capability dir (`act/`, `verify/`, `decide/`, `reflect/`, `recall/`, `learn/`).
- Combinators (MOVE-4) call capability primitives that already emit — no per-strategy re-wiring.
- Drift contract (PR #137 pattern) per capability boundary.

**Closes:** G-10 (strategy outer-loops bypass kernel instrumentation). Pillar 2 (Observability — uniform trace).

**Validation gate:**
- [ ] Trace coverage equal across all 6 strategies on identical task (verified by `rax-diagnose diff`)
- [ ] Per-capability drift contracts in CI (6 contracts: one per capability that emits)
- [ ] No emit call remains in `runner.ts` outside loop-control (iter start/end)
- [ ] No test regression

**Vision alignment:** Pillar 2 (Observability), Pillar 4 (Scalability — no per-strategy emit wiring), Pillar 5 (Reliability — uniform invariants).

---

### MOVE-6: HarnessProfile Composition Presets (3 days, after MOVE-2)

**Goal:** `HarnessProfile.lean()` / `.standard()` / `.intelligent()` / `.research()` are the primary API. `withLeanHarness()` becomes a backward-compat alias. Knobs become discoverable.

**Scope:**
- New file: `packages/runtime/src/harness-profile.ts` exporting 4 named presets.
- Each preset = explicit capability set (read from MOVE-2's registry).
- `.withHarnessProfile(HarnessProfile.lean())` builder method.
- `withLeanHarness()` desugars to `.withHarnessProfile(HarnessProfile.lean())`.
- Docs page `apps/docs/.../harness-profiles.mdx` generated from registry + presets.
- Quickstart updated to use presets as primary path.

**Closes:** R5 (75 withX() methods). Anti-mission #3. Vision claim "control over magic" gets a real surface.

**Validation gate:**
- [ ] 4 presets export from `@reactive-agents/runtime`
- [ ] `withLeanHarness()` test suite passes via preset desugaring
- [ ] Each preset has a doc page with cost expectations (from MOVE-2 registry)
- [ ] Quickstart code sample uses `.withHarnessProfile(HarnessProfile.standard())`
- [ ] User can read `HarnessProfile.lean().capabilities` to enumerate active set

**Vision alignment:** Pillar 1 (Control over magic), Pillar 6 (Efficiency through opt-in), DX pillar.

---

## 5. Sequencing & Dependencies

```
   MOVE-1 (Stage Telemetry)  ─┬──► MOVE-2 (Cost Registry) ──► MOVE-3 (TaskProfile) ──► MOVE-6 (HarnessProfile)
                          │                                                       │
                          └──► MOVE-5 (emit-at-boundary) ────────────────────────────┐│
                                       │                                          ▼
                                       └──► MOVE-4 (Combinator strategies) ◄──────────┘
```

**Parallelizable:**
- MOVE-1 alone (no deps)
- After MOVE-1: MOVE-2 + MOVE-5 in parallel (different code areas)
- After MOVE-2: MOVE-3
- After MOVE-5: MOVE-4 (combinators need emit at primitive boundary)
- After MOVE-3 + MOVE-2: MOVE-6 (preset construction needs both)

**Critical path:** MOVE-1 → MOVE-2 → MOVE-3 → MOVE-6 (≈2.5 weeks)
**Parallel work:** MOVE-5 → MOVE-4 (≈3 weeks total wall-clock if started after MOVE-1)

**Total wall-clock if fully sequential:** 6 weeks. With parallelization: 3-4 weeks.

**Aligns with active pilots:**
- Ablation-warden pilot (2026-05-23 → 2026-06-15): MOVE-2 lands DURING the pilot, gives warden real registry to compare against.
- Team-ownership warden pilot: kernel-warden owns MOVE-5 work; runtime-warden owns MOVE-3 + MOVE-6; compose-warden owns MOVE-2.

---

## 6. What This Plan Does NOT Address

Explicit out-of-scope (each has its own existing or proposed doc):

- **Memory v2** — `2026-05-23-memory-v2-design.md` is the authority; trips §9 anti-scaffold per current state. Independent track.
- **Heavy-dream / multi-iter L4 harness** — speculative, no PR substrate yet.
- **HITL bridge IX1** — separate roadmap item.
- **τ²-bench external publication** — Phase F gate, post-v1.0.
- **OpenAI prompt caching** — provider-level extension of Lever 1; under MOVE-2 it becomes a registry entry, but the implementation is its own PR.
- **Loop-detector tightening for same-tool-same-error** — Lever 9 candidate; should land as a behavior change AFTER MOVE-1 (so its lift is measurable) and AFTER MOVE-3 (so the gate reads `ctx.taskProfile.explicitTermination` to set tighter thresholds on graceful-failure tasks).
- **Code-as-action local-tier validation** — Phase D gate from North Star; independent.

---

## 7. Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| **MOVE-3 task-classifier misclassifies** → quality drop on edge cases | Medium | Heuristic-first; LLM fallback for ambiguous; override via `.withTaskProfile()`; ablation-warden flags drift |
| **MOVE-4 combinator refactor breaks one strategy subtly** | Medium | Per-strategy migration with full test pass before merge; bench-validate each strategy independently |
| **MOVE-2 registry over-formalizes** → adding new capability becomes bureaucratic | Low | Keep schema small; defaults can omit optional fields; review at v0.13 |
| **MOVE-5 emit move drops events** | Low | Per-capability drift contract added BEFORE move; CI catches |
| **MOVE-6 presets proliferate** → same anti-mission #3 problem at preset level | Low | Cap at 4 named presets; `.compose()` is the override path beyond |
| **Stage telemetry overhead** → MOVE-1 adds latency it was meant to measure | Low | Bus is fire-and-forget; sub-millisecond overhead; benchmarked in MOVE-1 gate |
| **Ablation-warden CI noise** post-MOVE-2 | Medium | Warden's lift threshold is pre-stated (≥3pp); flagged defaults get explicit rationale or removal |

---

## 8. Success Criteria — At Full Landing

Falsifiable, testable, anchored to Mission Statements.

### 8.1 Quantitative

- [ ] **Defaults audit:** `grep -rn "_enable.*: true" packages/runtime/src/builder.ts` returns 0 (everything in registry).
- [ ] **Strategy LOC:** Every strategy file ≤200 LOC (mission Pillar 3 met).
- [ ] **Mutation sites:** ≤10 state mutations per kernel run (mission Pillar 4 met).
- [ ] **Capability emit uniformity:** Trace coverage delta across strategies ≤5% (mission Pillar 2 met).
- [ ] **Per-stage telemetry:** `agent.result.metrics.stages.length` > 0 on every run.
- [ ] **Bench parity preserved:** 11-task local sweep maintains ≥10/11 pass (Lever 8 baseline).
- [ ] **Bench efficiency improved:** Average local-tier latency reduced by ≥15% vs Lever 8 baseline (MOVE-3 enables single-shot fast paths).
- [ ] **Lever-per-PR shape changes:** The first perf PR after MOVE-2 lands IS a registry entry, not a new module conditional. (Single observation, immediate signal — if it's still a 5-file inline conditional, MOVE-2 didn't take.)

### 8.2 Qualitative (vision alignment)

- [ ] Users can enumerate active capabilities via `agent.harness.capabilities` (Pillar 1).
- [ ] `rax-diagnose stages <runId>` works without trace mining (Pillar 2).
- [ ] Adding a 6th-strategy is a code review, not a 1500-LOC PR (Pillar 3).
- [ ] No new `withX()` method added in last 30 days post-landing (Pillar 4 + anti-mission #3 enforced).
- [ ] Vision claim "control over magic" demonstrable in 3-line example via `HarnessProfile.lean()` (DX pillar).

---

## 9. Honest Tradeoffs

**This plan is opinionated.** Three positions worth surfacing:

### 9.1 Combinators add a mental model

MOVE-4 introduces `iterateUntil`/`branchAndPick`/`routedDispatch`. New contributors learn these before writing a strategy. Tradeoff: higher learning curve in exchange for shorter strategies + uniform observability. Mitigation: 1-page combinator reference + reflexion as canonical example.

### 9.2 TaskProfile classification can be wrong

MOVE-3 classifies once at bootstrap. If wrong, the wrong capability set runs the whole task. Tradeoff vs current state: current state is "always run everything" — slow but never structurally-wrong. MOVE-3 trades occasional misclassification cost for systematic efficiency. Mitigation: heuristic-first (high accuracy on bench tasks), LLM fallback for ambiguous, `.withTaskProfile()` override, ablation-warden tracks drift over time.

### 9.3 Presets cap user agency

MOVE-6's 4 named presets become the primary API path. Users with a 5th need to use `.compose()`. Tradeoff vs current state: current state has 75 withX() methods — *more* agency at the cost of discoverability and unclear defaults. Mitigation: `.compose()` is fully expressive (Phase B Wave E shipped this); presets are the *first*-class path, not the *only* path.

---

## 10. Amendment Log

| Date | Change | Reason |
|---|---|---|
| 2026-05-26 | Initial draft. | Consolidate Lever 1-8 perf work + 5 architecture docs into single execution path. |

---

## 11. Cross-References

- Mission anchor: `wiki/Architecture/Specs/06-MISSION-STATEMENTS.md` (Pillars 1-8, anti-missions #3 + #6).
- Architecture target: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` (§4 capabilities, §9 Pruning Principle).
- Sequencing logic: `wiki/Architecture/Design-Specs/2026-05-25-strategic-direction-memo.md` (LEVERAGE-1, -2, -3).
- Combinator design: `wiki/Architecture/Design-Specs/2026-05-24-strategy-composability-design.md`.
- Composition vision: `wiki/Architecture/Design-Specs/2026-05-25-framework-composition-vision.md`.
- Drift convergence: `wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md`.
- Optimal algorithm: `wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md` (per-iter canonical loop).
- Recent perf evidence: this session's Lever 1-8 PRs (#141, #142, #144, #145, #146, #147, #148) + bench `wiki/Research/Mastra-Comparison-2026-05-25.md`.

---

*This plan is the bridge between the perf work happening today and the architecture work already specified. It names the structural deficit that connects them. Build it, and every future Lever becomes a 2-line registry entry instead of a 5-file inline conditional.*
