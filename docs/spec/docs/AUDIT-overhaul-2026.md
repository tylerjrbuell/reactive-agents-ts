# Overhaul Audit — 2026

> **Status:** Living document. Started 2026-04-28 on `refactor/overhaul`. Drives the v0.10.0 clean-break release.
> **Scope:** Comprehensive feature + quality audit of every package, mechanism, doc, and memory artifact. Verdicts feed Stage 5 cleanup.
> **Authority:** This is the only audit document. Older audits (Apr 17, Apr 18) are superseded; pull forward findings as needed.
> **Companion to:** `PROJECT-STATE.md` (current state), `00-RESEARCH-DISCIPLINE.md` (Rules 1-12), `01-FAILURE-MODES.md` (catalog), `15-design-north-star.md` (architecture target).

---

## 1. Why this audit exists

The framework has accumulated ~100 commits of feature work since v0.9.0 release without a coherent quality gate. PROJECT-STATE.md documents that most harness mechanisms are **unvalidated** — not broken, but never spike-tested for net contribution. The user mandate is:

> *Push hard, make efficient progress on cleaning up the project. Plan a huge release that puts the framework in a stable state ready for future work to build on top. Trim the fat. Cultivate ultra-efficiency in dev workflows.*

This audit makes that operational. Every package, mechanism, doc, and memory entry gets a verdict. Stage 5 executes the verdicts.

## 2. Default verdict bias

**KEEP unless evidence of harm.** This is the user's stated policy:

> *All of the current packages are serving a purpose. We may not need to delete anything unless we determine it's truly not necessary or there is a better or simpler solution that provides the same value/quality.*

So a package or mechanism survives the audit unless one of these is true:
- It causes active harm (incorrect behavior, broken default, misleading API).
- It's dead weight (no callers, no purpose post-refactor).
- A simpler replacement exists that provides equal value.
- It's misleading (claims to do X but doesn't).

A package that is "unvalidated but plausibly useful" stays — but gets a `_unstable_*` marker if its public API has never been external-validated (Rule 10).

## 3. Verdict legend

| Verdict | Meaning | Action in Stage 5 |
|---|---|---|
| **KEEP** | Serves a purpose, code works, evidence sufficient (or low risk). No action needed. | None. |
| **FIX** | Serves a purpose, but has a known defect or unwired path. | Add to fix backlog, address before release. |
| **SHRINK** | Serves a purpose, but surface area exceeds need. Untested API surface, dead exports, or excess abstractions. | Trim to the validated minimum, mark `_unstable_*` per Rule 10 where appropriate. |
| **DELETE** | Dead weight, actively harmful, or fully replaced. | Remove in archival commit. Document why. |
| **DEFER** | Worth keeping but needs evidence; spike-validate after release. | Keep as-is for v0.10.0. Flag in roadmap. |

Each verdict carries: **(a)** one-line reason, **(b)** evidence pointer (file path, failure mode, memory entry, or "unvalidated"), **(c)** Stage 5 action item if not KEEP.

## 4. Audit dimensions (per item)

```
| Dimension  | Question                                                           |
|------------|--------------------------------------------------------------------|
| Purpose    | What failure mode (01-FAILURE-MODES.md) does this address? Or none? |
| Evidence   | Spike-validated? Bench-validated? Anecdotal? Unvalidated?           |
| Health     | Code works / partially broken / known broken / dead.                |
| Verdict    | KEEP / FIX / SHRINK / DELETE / DEFER + one-line reason.             |
```

Use the same shape for packages, mechanisms, docs, memory.

---

## 5. Inventory — Packages (28)

LOC counts via `find src -name '*.ts' | xargs wc -l`. Test counts via `find . -name '*.test.ts' -o -name '*.spec.ts'` (excludes node_modules). Status as of 2026-04-28 on `refactor/overhaul` tip `023c5ccd`.

### 5.1 Heavyweight (>10K LOC) — 47.5K of ~85K total harness LOC

| Package | LOC | Tests | Audit verdict |
|---|---|---|---|
| `@reactive-agents/reasoning` | 19,586 | 82 | _pending_ |
| `@reactive-agents/runtime` | 17,478 | 104 | _pending_ |
| `@reactive-agents/tools` | 10,460 | 58 | _pending_ |

**Concern:** ExecutionEngine alone is 4,404 LOC per memory; North Star §6 calls for shrink to ~1,500 LOC. `reasoning` houses the 9 termination paths (NS §2.5). Likely **SHRINK** verdicts after Stage 3 deep-dives.

### 5.2 Mid-weight (3K-10K LOC)

| Package | LOC | Tests | Audit verdict |
|---|---|---|---|
| `@reactive-agents/llm-provider` | 8,178 | 27 | _pending_ |
| `@reactive-agents/reactive-intelligence` | 5,234 | 61 | _pending_ |
| `@reactive-agents/memory` | 4,984 | 21 | _pending_ |
| `@reactive-agents/observability` | 4,978 | 21 | _pending_ |
| `@reactive-agents/core` | 3,098 | 12 | _pending_ |
| `@reactive-agents/benchmarks` | 3,051 | 2 | _pending_ |
| `@reactive-agents/testing` | 2,971 | 7 | _pending_ |

**Concern:** `reactive-intelligence` has 61 tests but PROJECT-STATE says dispatcher net contribution is **unvalidated** per tier. Test count ≠ behavioral evidence.

### 5.3 Small (<3K LOC)

| Package | LOC | Tests | Audit verdict |
|---|---|---|---|
| `@reactive-agents/gateway` | 1,668 | 18 | _pending_ — no description in package.json |
| `@reactive-agents/interaction` | 1,379 | 8 | _pending_ |
| `@reactive-agents/verification` | 1,247 | 6 | _pending_ |
| `@reactive-agents/prompts` | 1,227 | 11 | _pending_ |
| `@reactive-agents/a2a` | 1,208 | 5 | _pending_ — no description in package.json |
| `@reactive-agents/cost` | 1,151 | 8 | _pending_ |
| `@reactive-agents/eval` | 1,039 | 5 | _pending_ |
| `@reactive-agents/orchestration` | 935 | 4 | _pending_ |
| `@reactive-agents/guardrails` | 801 | 5 | _pending_ |
| `@reactive-agents/trace` | 793 | 3 | _pending_ |
| `@reactive-agents/identity` | 698 | 3 | _pending_ |
| `@reactive-agents/diagnose` | 595 | **0** | _pending_ — Sprint 3.6, no tests yet |
| `@reactive-agents/react` | 258 | **0** | _pending_ — UI integration |
| `@reactive-agents/health` | 209 | 1 | _pending_ |
| `@reactive-agents/svelte` | 206 | **0** | _pending_ — UI integration |
| `@reactive-agents/vue` | 199 | **0** | _pending_ — UI integration |
| `reactive-agents` (umbrella) | 173 | 1 | _pending_ — never published to npm |
| `@reactive-agents/scenarios` | 100 | 1 | _pending_ — possibly a stub |

**Concerns:**
- 5 packages with 0 tests (`diagnose`, `react`, `svelte`, `vue` + 0-test infrastructure).
- 2 packages with no `description` field (`a2a`, `gateway`) — suggests aspirational scaffolding.
- Umbrella `reactive-agents` package is the install target users would run `npm install reactive-agents` for — and **it's never been published**. Top-priority FIX.
- `scenarios` at 100 LOC — likely a placeholder; investigate.

---

## 6. Inventory — Mechanisms (cross-package behaviors)

These are the **named harness mechanisms** that span multiple packages. The audit's main work happens here, since deletion/shrink decisions on packages flow from the mechanisms they implement.

| # | Mechanism | Where | Failure modes addressed | Verdict |
|---|---|---|---|---|
| M1 | Reactive Intelligence dispatcher (entropy → intervention) | `reactive-intelligence/` + hooks in `reasoning/` | FM-B1 (mitigated), FM-A2/H1 (open) | _pending_ |
| M2 | Strategy switching (ReAct ↔ Plan-Execute ↔ ToT) | `reasoning/strategies/` | FM-B2, FM-D2 (open) | _pending_ |
| M3 | Verifier (`agent-took-action` + grounding) + retry | `reasoning/kernel/capabilities/verify/` | FM-A1 (mitigated p01b), FM-C2 (control hook) | _pending_ |
| M4 | Healing pipeline (4 stages) for FC failures | `tools/` (NativeFCDriver+TextParseDriver) | FM-A2 (claimed) | _pending_ |
| M5 | Context curation: dual compression (`tool-execution` + `context-compressor`) | `reasoning/kernel/utils/` | FM-F1 (open, dual systems uncoordinated) | _pending_ |
| M6 | Skill system (lifecycle, AgentEvents, RI hooks) | `reasoning/`, `reactive-intelligence/` | none directly; learning pillar | _pending_ |
| M7 | Calibration (3-tier, observation store) | `reactive-intelligence/`, `llm-provider/` | FM-A2 (calibration says native-fc but FC unreliable) | _pending_ |
| M8 | Sub-agent delegation (`agent-tool-adapter`) | `tools/`, `runtime/` | FM-G1 (unvalidated) | _pending_ |
| M9 | Termination oracle (Arbitrator) | `reasoning/kernel/` | FM-D1 + 9-path scatter problem | _pending_ |
| M10 | Memory system (Working/Semantic/Episodic) | `memory/` | FM-F2 (theoretical) | _pending_ |
| M11 | Diagnostic system (Sprint 3.6) | `diagnose/` | FM-A3 (output leak fix) | _pending_ |
| M12 | Provider adapter system (7 hooks) | `llm-provider/` | quality-of-life across all tiers | _pending_ |
| M13 | Guards + meta-tools registry | `reasoning/kernel/phases/` | FM-D1 (premature termination) | _pending_ |

13 named mechanisms. Each gets a verdict block in §10.

---

## 7. Inventory — Spec docs (`docs/spec/docs/`)

35 files. Date breakdown:

### 7.1 Canonical (post-Apr-21) — KEEP candidates

| Date | File | Verdict |
|---|---|---|
| 2026-04-27 | `PROJECT-STATE.md` | **KEEP** — landing doc |
| 2026-04-27 | `15-design-north-star.md` v3.0 | **KEEP** — architecture target |
| 2026-04-27 | `01-FAILURE-MODES.md` | **KEEP** — living catalog |
| 2026-04-27 | `00-RESEARCH-DISCIPLINE.md` | **KEEP** — methodology contract |
| 2026-04-27 | `02-IMPROVEMENT-PIPELINE.md` | **KEEP** — operational rhythm |
| 2026-04-21 | `00-VISION.md` | **KEEP** — vision (stable) |
| 2026-04-28 | `AUDIT-overhaul-2026.md` (this) | **KEEP** |

### 7.2 Semi-recent (Apr 9) — review

| Date | File | Verdict |
|---|---|---|
| 2026-04-09 | `START_HERE_AI_AGENTS.md` | _pending_ — should now point to PROJECT-STATE.md first |
| 2026-04-09 | `DOCUMENT_INDEX.md` | _pending_ — likely needs regeneration |

### 7.3 March-era (28 files) — likely SHRINK / archive

| Date | File | Default verdict |
|---|---|---|
| 2026-03-11 | `00-master-architecture.md` | _superseded by 15-design-north-star_ → archive |
| 2026-03-11 | `00-monorepo-setup.md` | _potentially still useful_ → review |
| 2026-03-11 | `01.5-layer-llm-provider.md` | _layer doc, may have stale claims_ → review |
| 2026-03-11 | `02-CORE-PILLARS.md` | _superseded by VISION + NS_ → archive |
| 2026-03-11 | `02-layer-memory.md` | _layer doc_ → review |
| 2026-03-11 | `03-WHAT-IT-UNLOCKS.md` | _marketing/positioning, possibly stale_ → review |
| 2026-03-11 | `03-layer-reasoning.md` | _layer doc — pre kernel refactor_ → review |
| 2026-03-11 | `04-API-DESIGN.md` | _likely stale, builder API has evolved_ → review |
| 2026-03-11 | `04-layer-verification.md` | _layer doc_ → review |
| 2026-03-11 | `05-layer-cost.md` | _layer doc_ → review |
| 2026-03-11 | `06-layer-identity.md` | _layer doc_ → review |
| 2026-03-11 | `07-layer-orchestration.md` | _layer doc_ → review |
| 2026-03-11 | `08-layer-tools.md` | _layer doc — tool system has evolved_ → review |
| 2026-03-11 | `09-ROADMAP.md` | **archive** — pre-dates Sprint 3.x; ROADMAP.md (root) is current |
| 2026-03-11 | `09-layer-observability.md` | _layer doc_ → review |
| 2026-03-11 | `11-missing-capabilities-enhancement.md` | **archive** — pre-dates capability list |
| 2026-03-11 | `12-market-validation-feb-2026.md` | _research artifact_ → archive |
| 2026-03-11 | `14-v0.5-comprehensive-plan.md` | **archive** — old planning doc |
| 2026-03-11 | `FRAMEWORK_USAGE_GUIDE.md` | **archive** — pre-builder API evolution |
| 2026-03-11 | `PLAN_REVIEW.md` | **archive** — old planning artifact |
| 2026-03-11 | `SPEC_REVIEW.md` | **archive** — old planning artifact |
| 2026-03-11 | `implementation-guide-complete.md` | **archive** — old planning artifact |
| 2026-03-11 | `implementation-ready-summary.md` | **archive** — old planning artifact |
| 2026-03-11 | `layer-01-core-detailed-design.md` | **archive** — pre kernel refactor |
| 2026-03-11 | `layer-01b-execution-engine.md` | **archive** — pre kernel refactor |
| 2026-03-11 | `layer-10-interaction-revolutionary-design.md` | **archive** — speculative |
| 2026-03-11 | `reactive-agents-complete-competitive-analysis-2026.md` | _research artifact_ → archive |

### 7.4 Other spec dir files

- `docs/spec/REACTIVE_AGENTS_BUSINESS_MODEL.md` — _pending review_
- `docs/spec/REACTIVE_AGENTS_TECHNICAL_SPECS.md` — _pending review_
- `docs/spec/TOOL_SYSCALL_PROPOSAL.md` — _pending review_
- `docs/spec/docs/explorations/` — keep, these are speculative/exploration docs by design

**Default plan:** create `docs/spec/docs/_archive/` and move March-era stale docs there. Keep canonical 7. Update `DOCUMENT_INDEX.md` and `START_HERE_AI_AGENTS.md` to point at PROJECT-STATE.md as the entry point.

---

## 8. Inventory — Top-level repo docs

| File | Likely verdict |
|---|---|
| `README.md` | KEEP — needs accuracy sweep against current state |
| `AGENTS.md` | KEEP — the canonical agent workflow doc |
| `CLAUDE.md` | KEEP — already a thin pointer to AGENTS.md |
| `CHANGELOG.md` | KEEP — append v0.10.0 release notes |
| `CONTRIBUTING.md` | KEEP — review for accuracy |
| `CODING_STANDARDS.md` | KEEP — review for accuracy |
| `CAPABILITIES.md` | _pending_ — verify against package matrix |
| `FRAMEWORK_INDEX.md` | **FIX or DELETE** — Apr 17 audit flagged "all kernel paths broken" (5/5 stale) |
| `ROADMAP.md` | _pending_ — likely needs full rewrite for v0.10.0 |

---

## 9. Inventory — Memory artifacts

| Source | Files | Status |
|---|---|---|
| `~/.claude/projects/.../memory/*.md` | 35 + `MEMORY.md` index | reconcile against current code |
| `.agents/MEMORY.md` (in repo) | 1 | reconcile, sync with personal |

**Plan:** in Stage 4, walk every entry. Delete entries that no longer reflect reality (most entries are commit-snapshot logs that decay fast — `project_*` for older sprints). Keep cross-cutting feedback + project context that's still load-bearing.

---

## 10. Audit findings — packages and mechanisms (Stage 3 fills in)

> Stage 3 will populate this section. For each package and mechanism, fill in:
>
> ```
> ### <name>
>
> **Purpose:** <what failure mode / capability does this address?>
> **Evidence:** <spike id | bench id | "unvalidated">
> **Health:** <works | partial | broken | dead>
> **Verdict:** <KEEP | FIX | SHRINK | DELETE | DEFER>
> **Reason:** <one line>
> **Stage 5 action:** <none | fix-X | trim-Y | delete>
> ```

### 10.1 Packages

> Findings from Stage 3 audit pass (2026-04-28). 25 of 28 verdicts produced by parallel general-purpose agents inspecting `packages/<name>/src/`, tests, and consumers; 3 heavyweight packages (`reasoning`, `runtime`, `tools`) audited directly. All file:line refs verified against `refactor/overhaul` tip `023c5ccd`.

#### Heavyweight (audited directly)

##### `@reactive-agents/reasoning`

- **Purpose:** Houses the kernel cognitive architecture (9 capabilities matching NS §3.1: act / attend / comprehend / decide / learn / reason / reflect / sense / verify) + 6 strategies (reactive, plan-execute, tree-of-thought, reflexion, adaptive, plan-prompts). Implements M3 (Verifier+retry), M9 (Termination oracle/Arbitrator), M13 (Guards+meta-tools).
- **Evidence:** Spike-validated for `agent-took-action` verifier check on cogito:8b (5/5 reject; spike `p01b`). Verifier-driven retry KILLs cogito (spike `p02`). Most other surfaces unvalidated. 82 tests.
- **Health:** structural defects.
  - **9 termination paths** (NS §2.5 confirmed): oracle path at `kernel/capabilities/decide/arbitrator.ts:885`; 8 bypass sites in `kernel/loop/runner.ts:679, 817, 879, 953, 1011, 1234, 1262, 1291`. **CHANGE A wired the oracle into 1 of 9; the other 8 transition `status:"done"` directly.** Architectural blocker for the failure-corpus.
  - **ToT outer loop ignores early-stop** (FIX-5): zero `earlyStop|perRIEarlyStop` matches in `strategies/tree-of-thought.ts`; only `plan-execute.ts:605,716,741` honors it.
  - `kernel/loop/runner.ts` is the largest single file in the harness; `kernel/state/kernel-state.ts` is ~32KB. Both are SHRINK targets.
- **Public surface:** `index.ts` 191 lines, ~30 exports (types/schemas/services/errors). Stable shape but `ObservationResult`/`TrustLevel` are recent — verify `_unstable_*` markers per Rule 10.
- **Verdict:** **FIX**
- **Reason:** 9-termination-path scatter is the corpus-failure root cause. ToT bypasses early-stop. Surface stable, mechanisms partly validated.
- **Stage 5 actions:**
  1. Route every `status:"done"` transition through the Arbitrator oracle (NS §2.5). Either inline the oracle check at each of the 8 sites or refactor to a single `terminate(state, reason)` function that always consults the arbitrator. Add a CI lint that fails on direct `transitionState({status:"done"})` outside the helper.
  2. Wire ToT outer loop to honor early-stop (FIX-5) — mirror `plan-execute.ts:605,716,741` perRIEarlyStop pattern in `tree-of-thought.ts`.
  3. SHRINK `runner.ts`: extract the 1300+ lines into per-concern modules (loop-detection, required-tool nudges, harness-deliverable assembly) under `kernel/loop/`. Target: runner.ts < 500 LOC.
  4. Mark `_unstable_*` per Rule 10: `ObservationResult`, `TrustLevel`, `KNOWN_TRUSTED_TOOL_NAMES`, `GRANDFATHER_TRUST_JUSTIFICATION`, anything from Sprint 3.4-3.6.

##### `@reactive-agents/runtime`

- **Purpose:** ExecutionEngine (the orchestrator), ReactiveAgentBuilder (DX surface), AgentResult, runtime layer composition, sub-agent telemetry, debrief, calibration resolver, classifier, observers.
- **Evidence:** Bench-validated end-to-end on Anthropic Sonnet (35/35); 97 tests. ExecutionEngine internal mechanisms not individually spike-tested.
- **Health:** the actual elephant is `builder.ts`.
  - `execution-engine.ts` = **4,476 LOC** (NS target ~1,500; FIX-19 confirmed).
  - `builder.ts` = **5,877 LOC** — even larger; not previously called out. Top SHRINK candidate.
  - `runtime.ts` = 1,937 LOC; `agent-config.ts` = 722 LOC.
  - **Duplicate `AgentConfigSchema`** at `agent-config.ts:198` collides with `@reactive-agents/core`'s skeletal one (FIX confirmed).
  - Observability default-off here at `runtime.ts:1349`; logger silenced unconditionally at `execution-engine.ts:4252` (cross-ref observability agent finding).
- **Public surface:** Builder API (very wide), AgentResult, runtime layer factory, AgentStream. Several `withX()` builder hooks may trace to dead code paths in older subsystems.
- **Verdict:** **FIX (largest SHRINK target in the harness)**
- **Reason:** ExecutionEngine + builder = 10,353 LOC of orchestration; NS §6 mandates extraction of telemetry/debrief/classifier/skill-loading. Duplicate AgentConfig + observability defaults compound DX harm.
- **Stage 5 actions:**
  1. Extract from `execution-engine.ts`: telemetry (~12K-LOC `telemetry-enrichment.ts` already factored — verify usage), debrief (`debrief.ts` exists), classifier (`classifier-accuracy.ts`, `classifier-bypass.ts`), skill-loading. Target ExecutionEngine < 1,500 LOC.
  2. Audit `builder.ts` for dead `withX()` hooks; collapse those whose callees are deprecated. Target < 2,500 LOC.
  3. Resolve duplicate `AgentConfigSchema`: rename core's to `AgentDefinitionSchema`, leave runtime's as canonical. Update consumers.
  4. Flip `enableObservability` default to `true` at `runtime.ts:1349`.
  5. Replace blanket `Logger.replace(Logger.defaultLogger, Logger.none)` at `execution-engine.ts:4252` with TTY-conditional only.

##### `@reactive-agents/tools`

- **Purpose:** Tool registry, sandboxed execution, MCP client (M11), Healing pipeline (M4), drivers (Native FC + Text Parse + Tool Calling), sub-agent adapter, RAG, caching, validation, skills.
- **Evidence:** MCP rewrite on `@modelcontextprotocol/sdk` (Apr 7) shipped + tested. Healing pipeline 4 stages claimed (FM-A2 mitigation); empirical validation per-tier missing. 58 tests.
- **Health:** broadly sound but with hardcoded caps.
  - **`MAX_RECURSION_DEPTH = 3`** at `adapters/agent-tool-adapter.ts:6` not configurable (FIX-7 confirmed).
  - Sub-agent `maxIterations` cap (`Math.min(userValue, 3)` per Apr 17 audit) — verify in `adapters/agent-tool-adapter.ts:214-217`.
  - `bun:sqlite` likely in caching/registry — confirm and gate (cross-ref memory FIX).
  - 12 subdirs cleanly organized: adapters, caching, drivers, execution, function-calling, healing, mcp, rag, registry, skills, tool-calling, validation.
- **Public surface:** Tool registry, `defineTool`, MCP layer, drivers, healing pipeline, sub-agent tool adapter, skills.
- **Verdict:** **FIX**
- **Reason:** Working but ships hidden caps and likely Bun-only paths beyond memory.
- **Stage 5 actions:**
  1. Make `MAX_RECURSION_DEPTH` configurable via builder/runtime config. Default 3, allow override (FIX-7).
  2. Remove the silent `Math.min(userValue, 3)` cap on sub-agent `maxIterations` — error or warn on bad values, don't silently degrade (FIX-8).
  3. Audit caching/registry for `bun:sqlite` imports; gate behind runtime detection (cross-ref memory pkg).
  4. Mark Sprint 3.x healing-pipeline surfaces `_unstable_*` per Rule 10.
  5. Spike-validate healing pipeline per-tier — does each stage actually unstick a stuck FC? (post-release).

#### Mid-weight (audited via parallel agents)

##### `@reactive-agents/llm-provider`
- **Purpose:** Provider adapters (Anthropic/OpenAI/Gemini/LiteLLM/Local-Ollama/Test) + 7-hook ProviderAdapter system. Mitigates FM-A1, FM-A2, FM-H1.
- **Evidence:** Native FC migration (Mar 2026), bench 35/35 Sonnet. 27 tests / 8K LOC ≈ 1 per 300 LOC.
- **Health:** **qwen3 thinking-mode auto-enable bug at `providers/local.ts:226-251`** (`resolveThinking` returns `true` whenever model advertises capability and config is undefined → empty content). Zero `_unstable_*` markers despite Rule 10. Dead `recommendStrategyForTier` returns `undefined` always (`adapter.ts:301-307`). `ProviderCapabilities` deprecated but still exported.
- **Verdict:** **FIX**
- **Reason:** Core infrastructure with broad evidence and good adapter coverage; ships known-broken auto-thinking on qwen3 + violates Rule 10 across 14+ surfaces.
- **Stage 5 actions:** (1) Fix qwen3 auto-thinking at `local.ts:226-251` + regression test. (2) Mark `_unstable_*`: `Capability`, `resolveCapability`, `CapabilityCache`, `ProviderAdapter`, `selectAdapter`, alias accumulation surface, `buildCalibratedAdapter`, `runCalibrationProbes`. (3) Delete dead `recommendStrategyForTier`. (4) Either delete or rename `ProviderCapabilities` → `_deprecated_ProviderCapabilities` with v0.11 removal target. (5) SHRINK `types.ts` (largest file in package).

##### `@reactive-agents/reactive-intelligence`
- **Purpose:** Entropy detection + intervention dispatcher (early-stop, strategy-switch, temp-adjust, compress, skill-activate, tool-inject). Calibration store, bandit/learning. Mitigates FM-B1, FM-A2 (claimed), FM-D1.
- **Evidence:** Largely **unvalidated**. Apr 19 trace: 0 decisions at entropy 0.150. AUC validation probe = 0.000. 61 tests cover shapes not behavioral lift.
- **Health:** structural defects.
  - **Budget counters dead-zeroed every iteration** at `reactive-observer.ts:294` and `plan-execute.ts:698` (`{ tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 }`) → suppression gates at `dispatcher.ts:69-76` (maxFires=5, maxBudget=1500) **never trip**. `tool-failure-redirect.ts:12` has in-source comment acknowledging this.
  - **3/6 RI hooks not wired** to EventBus (`builder.ts:1006-1008`): `onSkillActivated`, `onSkillRefined`, `onSkillConflict`. The events themselves DO exist (`core/services/event-bus.ts:986-990`) — the hooks just have no subscriber. **Memory note: prior "AgentEvents missing" claim was wrong; correction needed.**
  - **Calibration default `:memory:` claim is stale**: `types.ts:246` already defaults to `~/.reactive-agents/calibration.db`. Memory note needs correction.
  - 4 dead handler files in `controller/handlers/`: `human-escalate.ts`, `memory-boost.ts`, `prompt-switch.ts`, `skill-reinject.ts` — removed from registry per `controller-service.ts:12-21` but files remain.
- **Verdict:** **FIX**
- **Reason:** Capability is real, but two structural defects make the dispatcher near-useless: dead budget counters + 3/6 RI hooks unsubscribed. Net dispatch rate unvalidated post-Apr-19 wiring fixes.
- **Stage 5 actions:** (1) Thread budget through dispatch context via `KernelState.meta.riBudget`. (2) Subscribe the 3 missing hooks at `builder.ts:2657-2681`. (3) Update memory FIX-6 + FIX-9 (both claims partially stale). (4) Make every strategy reach `runReactiveObserver`. (5) Spike-validate dispatch rate post-fixes (30-task corpus, dispatched/skipped per skip-reason). (6) Delete 4 dead handler files.

##### `@reactive-agents/memory`
- **Purpose:** Working/Semantic/Episodic/Procedural + Plan/Skill/Debrief/Experience stores. SQLite + FTS5 + Zettelkasten linking + consolidation. Targets FM-F2.
- **Evidence:** **Unvalidated** for FM-F2. 21 unit tests (CRUD/schema), no cross-run pollution probe.
- **Health:** **`bun:sqlite` hard import** at `database.ts:2` — published `dist/index.js` will throw on Node (`ReferenceError: Bun is not defined`). No `engines` field in `package.json`. Sync-only DB layer (`Effect.sync`) blocks event loop (NS G-3 unaddressed). **`AgentMemory` port not defined in core or wired** — services export Effect Tags directly; reasoning couples straight to `MemoryServiceLive`.
- **Verdict:** **FIX**
- **Reason:** Structurally sound (capability split matches NS §2.7), but Node-broken at runtime + blocks event loop + AgentMemory port never instantiated.
- **Stage 5 actions:** (1) Add `engines: { bun: ">=1.1" }` + Node detection lazy-load (`bun:sqlite` vs `better-sqlite3`). (2) Introduce `SqliteAdapter` Tag port. (3) Migrate hot-path reads to `Effect.promise`/worker (G-3). (4) Define `AgentMemory` port in `core` (`recall(query)` / `record(entry)` / `forget(scope)`); reasoning depends on the port. (5) Add cross-run pollution probe to convert FM-F2 unvalidated → mitigated/known-defect. (6) Trim `MemoryDatabase` re-exports from public index.

##### `@reactive-agents/observability`
- **Purpose:** Distributed tracing (OTel), structured logging, metrics, status TUI, telemetry collector w/ DP, redaction.
- **Evidence:** 21 tests; OTLP exporter validated against `@opentelemetry/api`.
- **Health:** **Default-off** at `runtime.ts:1349` (FIX-10 confirmed). **Blanket `Logger.replace(Logger.defaultLogger, Logger.none)`** at `execution-engine.ts:4252` silences ALL `Effect.log*` calls. Telemetry-collector defects: token split is **70/30 estimate** (`telemetry-collector.ts:103-104`), `cacheHits` declared but never incremented → `cacheHitRate` always 0, `strategy` only captured on `FinalAnswerProduced` (failed tasks attribute as "unknown"). MetricsCollector silent fallback to fresh collector if shared layer not provided.
- **Verdict:** **FIX**
- **Reason:** Default-off contradicts "observability is the spine"; logger silencing + 4 telemetry defects produce silent data loss precisely where evidence is needed.
- **Stage 5 actions:** (1) Default `enableObservability=true`; opt-out flag. (2) TTY-conditional `Logger.none` only. (3) Read `tokensIn/tokensOut` directly from `LLMRequestCompleted`. (4) Wire `cacheHits` increment. (5) Capture `strategy` from `AgentStarted`. (6) Hard-fail or notice on missing `MetricsCollectorTag`. (7) OTLP shutdown error-path test.

##### `@reactive-agents/core`
- **Purpose:** EventBus (1,237 LOC), AgentService, TaskService, ContextWindowManager, EntropySensorService, framework error taxonomy + retry pattern matching, ErrorSwallowed instrumentation, branded IDs, schemas.
- **Evidence:** 12 tests; `EntropySensorService` actively used by RI.
- **Health:** **Skeletal `AgentConfig`/`AgentConfigSchema`** at `types/agent.ts:8-22` (4 fields) collides with `runtime/agent-config.ts:198,276` (17 nested schemas) — autocomplete confusion. **`effect` in `devDependencies` AND `peerDependencies` but NOT `dependencies`** — dual-copy risk. **3 NS canonical ports not defined** here: only `Capability` exists as a data shape, not a Context.Tag service port; `AgentMemory` and `Verification` ports missing entirely.
- **Verdict:** **FIX**
- **Reason:** Foundation serves harness as cross-cutting telemetry/error/state spine, but duplicate `AgentConfig` + dependency hygiene + missing NS ports create real consumer surprise.
- **Stage 5 actions:** (1) Rename core's skeletal types to `AgentDefinition`/`AgentDefinitionSchema`. (2) Move `effect` into `dependencies` or rely solely on peer + lockfile. (3) Define stub `AgentMemory` + `Verification` port Tags marked `_unstable_*`. (4) SHRINK candidate: `event-bus.ts` (1,237 LOC) — defer split until §10.2 mechanism review.

##### `@reactive-agents/benchmarks` (private)
- **Purpose:** v1 + v2 benchmark harness; runner / tasks / judge / sessions (regression-gate, real-world-full, competitor-comparison, local-models); 5 competitor adapters; CI drift detection.
- **Evidence:** `private: true`, never published. 2 test files (one is 16K — substantial v2 coverage). Heavy devDeps appropriate for competitor rig.
- **Health:** Working as private bench tool.
- **Verdict:** **DEFER**
- **Reason:** Private + valuable, but 3K LOC for 2 test files is light coverage relative to claims it produces.
- **Stage 5 actions:** Mark `_unstable_v2_*` on `SessionReport`, `DriftReport`, `runSession`, `computeAllAblation` until N=3 validation lands. Document as internal-only in package README.

##### `@reactive-agents/testing`
- **Purpose:** Mocks, helpers, scenario fixtures, expectation DSLs, **North Star Tier-1 Gate** (`gate/runner.ts` 13.5K).
- **Evidence:** 7 test files. Only 3 import sites in workspace outside package — high surface-to-use ratio.
- **Health:** Working. Tier-1 Gate has no in-tree CI invocation; sibling deps reference `"0.9.0"` not `"workspace:*"` (publish hygiene).
- **Verdict:** **SHRINK**
- **Reason:** Mocks/assertions/scenario harness clearly used; the Tier-1 Gate is unvalidated by external callers (no CI runs found).
- **Stage 5 actions:** (1) Mark `_unstable_gate_*` per Rule 10 until at least one CI invocation of `runGate` lands and produces a baseline diff. (2) Audit whether `runScenario`/`runCounterfactual`/`expectStream` are used beyond 2 runtime tests; if not, mark `_unstable_*`. (3) Fix sibling-dep version pinning (`"workspace:*"`).

#### Small (audited via parallel agents)

##### `@reactive-agents/gateway`
- **Purpose:** External event ingress + scheduling (webhooks, cron, GitHub adapter, policy engine, rate-limit/cost/access-control). Single-agent ingress, NOT multi-agent.
- **Evidence:** Published `0.9.0` on npm. 17 src + 16 test files (real integration tests). Consumed by `runtime/builder.ts`, Cortex `gateway-process-manager`, CLI `deploy`, 2 example apps, meta-agent.
- **Health:** Working and consumed.
- **Verdict:** **KEEP**
- **Reason:** Not aspirational — already shipping in v0.9.0, drives Cortex agent process lifecycle, used in CLI + examples.
- **Stage 5 actions:** Add `description` to `package.json`. Verify dynamic-import path resolves under bun-src exports.

##### `@reactive-agents/a2a`
- **Purpose:** Agent-to-Agent (Google A2A) protocol — server (HTTP/SSE), client, agent-card generator + capability matcher.
- **Evidence:** Published `0.9.0`. 5 test files w/ real HTTP/SSE flow.
- **Health:** Working. Re-exported by `reactive-agents` umbrella, dynamically imported by runtime ("if a2a not installed, empty layer"), used by CLI `serve`.
- **Verdict:** **DEFER**
- **Reason:** Per NS v2.2/v3.0 + memory `project_multi_agent_orchestration`, multi-agent orchestration is post-v1.0 in spec 16.
- **Stage 5 actions:** Add description noting deferred status. Don't feature in v0.10.0 README/docs. Consider gating publish until spec 16 lands; alternatively keep published but mark experimental in CHANGELOG.

##### `@reactive-agents/interaction`
- **Purpose:** 5 autonomy modes + checkpoints + human collaboration.
- **Evidence:** **Unvalidated**; 8 tests / 1,379 LOC ≈ 0.6%. No spike, no benchmark.
- **Health:** Builder advertises 5 modes but only exposes 3 (`autonomy: 'full' | 'suggest' | 'observe'`) — naming drift. `PreferenceLearner` and `CollaborationService` have no traced consumers in runtime/reasoning/cortex.
- **Verdict:** **DEFER (lean SHRINK)**
- **Reason:** Aspirational vs used; 6-service surface includes unreached services.
- **Stage 5 actions:** Validate which of 6 services are reached at runtime; trim unreached ones. Reconcile 5-mode claim with builder's 3-mode `autonomy` field. Mark `_unstable_*`.

##### `@reactive-agents/verification`
- **Purpose:** **Output-level semantic verification** — semantic entropy, fact decomposition, multi-source, NLI, hallucination detection on final response. Distinct from `reasoning/kernel/capabilities/verify/` which does **action-outcome verification** per tool execution.
- **Evidence:** Used as Phase 6 in `execution-engine.ts:3054` behind `enableVerification`. 6 tests; `runtime/tests/verification-quality-gate.test.ts` covers retry path. `VerificationLLM` interface decoupled.
- **Health:** Works. **Not redundant** with kernel verifier.
- **Verdict:** **KEEP**
- **Reason:** Two complementary verifiers at different stages — collapsing them would lose either step-level grounding or response-level entropy.
- **Stage 5 actions:** Rename in docs to clarify `OutputVerifier` package vs `ActionVerifier` capability under shared NS Verify port. No code change for v0.10.0.

##### `@reactive-agents/prompts`
- **Purpose:** Single template engine + library (ReAct + tier variants, Plan-Execute, ToT, Reflexion, adaptive-classify, 5 judge templates, fact-check, default agent).
- **Evidence:** 11 tests / 1,227 LOC. Consumed via `withPrompts()` builder hook (lazy import at `builder.ts:3071`) and `PromptService` tag in `service-utils.ts`.
- **Health:** Works. `service-utils.ts:33` uses local PromptService tag to avoid coupling — healthy decoupling but indicates not fully stable interface.
- **Verdict:** **KEEP**
- **Reason:** Single source of truth for templates; no parallel system in `reasoning/`.
- **Stage 5 actions:** Consolidate local-tag with package's exported `PromptService` (or document as `_unstable_*`). Mark `ExperimentService` `_unstable_*` (only one example consumer).

##### `@reactive-agents/cost`
- **Purpose:** Complexity routing (heuristic), semantic cache, prompt compression, budget enforcement, cost tracking, optional SQLite persistence.
- **Evidence:** 8 tests. Consumed at 3 sites in `runtime/execution-engine.ts` (opt-in via `Effect.serviceOption`), wired in `runtime.ts`, used by benchmarks.
- **Health:** Working. **Hardcoded model SHAs are stale** (`claude-haiku-4-5-20251001`, `claude-sonnet-4-20250514`, `gpt-4o`, `o3`, `gemini-2.5-pro-preview-03-25`) — pinned to mid-2025; we're on opus 4.7. **Heuristic classifier is brittle and English-only** at `complexity-router.ts:192-215`. **No interaction with FC calibration** — cost-tier choice independent of model FC reliability.
- **Verdict:** **KEEP + FIX**
- **Reason:** Real wiring + tests; defects are bounded.
- **Stage 5 actions:** (1) Move model SHA + cost table to `@reactive-agents/calibration` so it lives next to reliability data. (2) Bias router away from tiers with low `toolCallReliability` for tool-heavy tasks. (3) Refresh model IDs.

##### `@reactive-agents/eval` — **RULE 4 BLOCKER**
- **Purpose:** Suite runner + LLM-as-judge scoring + regression check.
- **Evidence:** Rule 4 (frozen judge) compliance fails on **3 of 4** requirements.
- **Health:** **Fixed model: FAIL** — `eval-service.ts:159` resolves `LLMService` from same Effect context as SUT; no `judgeModel` field in `EvalConfig`. **Code-path isolation: FAIL** — judge uses same `LLMService` Tag, same provider stack, same FC drivers, same healing pipeline as SUT. **Fixed code SHA: N/A** — no SHA pinning anywhere. Fixed prompt: PASS (inlined per dimension, temperature 0.0). **`runSuite` is broken** — hardcodes `actualOutput: "[evaluated via LLM-as-judge]"` placeholder; doesn't actually run the agent.
- **Verdict:** **FIX (v0.10.0 release blocker for any benchmark claim)**
- **Reason:** Rule 4 demands frozen judge; eval ships shared-codepath judge.
- **Stage 5 actions:** (1) Add `judge: { model, provider, codeSha }` to `EvalConfig`. (2) Build separate `JudgeLLMService` Tag distinct from SUT's `LLMService`. (3) Guard fails the run if `judge.model === sut.model`. (4) Delete or fix `runSuite`'s placeholder. (5) Pin code SHA in eval reports.

##### `@reactive-agents/orchestration`
- **Purpose:** WorkflowEngine (sequential / parallel / map-reduce / pipeline / orchestrator-workers), EventSourcing (checkpoints, replay), WorkerPool (multi-agent worker spawning), human-in-loop step gates.
- **Evidence:** 4 tests; opt-in via `enableOrchestration` (off by default). Zero non-example consumers in `packages/`.
- **Health:** Working. Workflow engine + event sourcing + worker pool coupled in one Tag (single-agent vs multi-agent concerns mixed). `resumeWorkflow` race risk on multiple resumes. `OrchestrationServiceLive` is `Effect.gen` not `Layer.effect` (inconsistent).
- **Verdict:** **DEFER**
- **Reason:** Per NS v2.2 multi-agent is post-v1.0 in spec 16; `worker-pool.ts` + `WorkerAgent` are squarely deferred territory. Already gated behind opt-in flag.
- **Stage 5 actions:** Document as deferred in CHANGELOG. Consider extracting `workflows/` + `event-sourcing.ts` as `@reactive-agents/workflow` (single-agent durable execution) if v1.0 use case emerges. Otherwise leave installable but unwired by default.

##### `@reactive-agents/guardrails`
- **Purpose:** Pre/post-LLM safety filters: prompt-injection regex, PII scanner, toxicity, kill switch, behavioral contracts.
- **Evidence:** 5 tests (real assertions). Wired through 8 sites in `runtime/builder.ts` + `agent-config.ts`. Sub-agent inheritance honored. Used by 3 runtime tests.
- **Health:** Works. **No meaningful overlap with `tools/trustLevel`** — guardrails operate on input/output text channel; trustLevel marks tool-result content provenance. Complementary, not redundant.
- **Verdict:** **KEEP**
- **Reason:** Distinct from trustLevel work, shipped + wired + tested, opt-in.
- **Stage 5 actions:** Consider `_unstable_*` if external red-team validation pending for v0.10.0 marketing claims.

##### `@reactive-agents/trace`
- **Purpose:** Persistent trace event stream — 17-variant `TraceEvent` discriminated union + JSONL recorder + replay loader + `TraceBridgeLayer`.
- **Evidence:** 3 test files. **9 production consumers** across runtime, testing, reactive-intelligence, diagnose, cli, reasoning. Sprint 3.6 added 5 new event types.
- **Health:** Working. Cleanly imported lazy from `runtime/builder.ts`. **Not redundant with `observability/tracing`** — that's an OTel span tracer for distributed tracing; this is a structured event log for harness diagnostics.
- **Verdict:** **KEEP**
- **Reason:** Load-bearing for Sprint 3.6 diagnostic system, RI learning projection, scenario testing, `rax diagnose`.
- **Stage 5 actions:** None.

##### `@reactive-agents/identity`
- **Purpose:** Agent certificates (ed25519), permission manager (RBAC), audit logger.
- **Evidence:** 3 tests. **2 consumers**: `runtime/runtime.ts:1346` unconditional layer merge + 1 example. **Wiring is dormant** — nothing reads `IdentityService`; no permission checks gate tools, no certificate verification gates sub-agent delegation, no audit entries written from agent runs.
- **Health:** Code works in isolation; service wires into runtime layer but no consumer reads it.
- **Verdict:** **DEFER**
- **Reason:** Shipped scaffolding without integration site.
- **Stage 5 actions:** Mark `_unstable_identity_*` per Rule 10. Add roadmap item to wire `PermissionManager` into tool execution + `AuditLogger` into AgentEvents bus + `CertificateAuth` into A2A delegation in v0.11.

#### Tiny / UI integrations / umbrella

##### `@reactive-agents/diagnose`
- **Purpose:** Sprint 3.6 first-class CLI (`rax-diagnose list/replay/grep/diff`) over JSONL traces; programmatic API for harness-improvement-loop. Addresses FM-A3.
- **Evidence:** 595 LOC, 4 commands. **Empty `__tests__/`**. **Never published to npm.**
- **Health:** Code works (CLI shape complete). Zero automated test coverage.
- **Verdict:** **FIX**
- **Reason:** External users can't access harness-improvement-loop without it on npm; zero tests for 595-LOC user-facing CLI.
- **Stage 5 actions:** (1) Publish to npm at v0.10.0. (2) Scaffold `__tests__/{resolve,replay,grep,diff}.test.ts` (4 happy-path tests minimum).

##### `@reactive-agents/react`
- **Purpose:** React hooks (`useAgent`, `useAgentStream`) parsing SSE from `AgentStream.toSSE()`.
- **Evidence:** 122 LOC streaming hook. Zero tests. Zero in-repo consumers (Cortex UI uses its own framework).
- **Health:** Code correct on inspection (proper React idioms, race-free abort). SSE contract hand-coupled to runtime via `_tag` strings — runtime change would break silently.
- **Verdict:** **KEEP + `_unstable_*`**
- **Reason:** UI integration is strategic surface for new-user discovery; never external-validated.
- **Stage 5 actions:** Add `_unstable` JSDoc tag in `index.ts` + 1 SSE-parser contract test.

##### `@reactive-agents/svelte`
- **Purpose:** Svelte stores (`createAgent`, `createAgentStream`).
- **Evidence:** 105 LOC. Zero tests. Zero in-repo consumers (Cortex UI uses own stores).
- **Health:** Idiomatic. Unused `derived` import in both `agent.ts` and `agent-stream.ts` (lint flag). PeerDep `>=4.0.0` vs devDep `^5.0.0` — version mismatch.
- **Verdict:** **KEEP + SHRINK (minor)**
- **Reason:** Same UI-surface argument as react; minor cleanup needed.
- **Stage 5 actions:** Drop unused `derived` imports. Add `_unstable_*` mark + same SSE contract test. Verify svelte 4+5 compat.

##### `@reactive-agents/vue`
- **Purpose:** Vue 3 composables (`useAgent`, `useAgentStream`).
- **Evidence:** 103 LOC. Zero tests. Zero in-repo consumers.
- **Health:** Correct Vue 3 idioms. Same SSE coupling risk as react/svelte.
- **Verdict:** **KEEP + `_unstable_*`**
- **Reason:** Asymmetric removal would force Vue users to write hooks from scratch.
- **Stage 5 actions:** `_unstable` JSDoc + shared SSE parser contract test.

##### `@reactive-agents/health`
- **Purpose:** Bun.serve `/health`, `/ready`, `/metrics` endpoints; registerable async health checks.
- **Evidence:** 7 unit tests covering all endpoints + lifecycle. **3 real consumers**: `runtime/builder.ts`, `runtime/runtime.ts`, `meta-agent`.
- **Health:** Tightest small package. Tied to Bun (`Bun.serve`) — matches workspace direction.
- **Verdict:** **KEEP**
- **Reason:** Model the other small packages should aspire to.
- **Stage 5 actions:** None.

##### `@reactive-agents/scenarios`
- **Purpose:** Typed catalog of 5 hand-curated **failure-mode reproduction scenarios** (loop-prone-haiku, tool-failure-web-search, context-pressure-noisy, long-horizon-repo-triage, schema-drift-sql).
- **Evidence:** 100 LOC of dense data. 1 test (shape + 2 successCriteria). Real consumer: `runtime/tests/e2e-haiku-ablation.test.ts`. Aligned with FM-* taxonomy.
- **Health:** Healthy.
- **Verdict:** **KEEP**
- **Reason:** Not a stub — fixture catalog supporting RI evidence collection.
- **Stage 5 actions:** Optional belt-and-suspenders union-coverage test on `allScenarios`.

##### `reactive-agents` (umbrella) — **TOP-PRIORITY P0 RELEASE BLOCKER**
- **Purpose:** Single-install entry point (`bun add reactive-agents` / `npm install reactive-agents`). 173 LOC pure re-exports across 15 sub-packages + 14 deep import paths via `exports` map. Ships `rax`/`reactive-agents` bin via `@reactive-agents/cli`.
- **Evidence:** **Massive in-repo footprint** — every example (`apps/examples/**`), all CLI commands (serve/demo/playground/run), `apps/cli` project generators all emit `import { ReactiveAgents } from "reactive-agents"`. Umbrella integration test (382 LOC) covers re-exports/build/run/streaming/health/error-handling/fallbacks. **Never published to npm.**
- **Health:** Package itself is healthy (test passes, exports map matches dist outputs, bin forwards correctly). External harm: every doc / blog / generated project references `npm install reactive-agents` — which **returns 404**. Single highest-leverage release blocker.
- **Verdict:** **FIX (P0 release blocker)**
- **Reason:** Anyone discovering the framework today hits a 404 on the canonical install command.
- **Stage 5 actions:** (1) Verify `dist/` contains every sub-export listed (incl. `core.js`, `memory.js`, …, `a2a.js`); ensure `tsup` config emits all 14 sub-paths. (2) **Publish to npm at v0.10.0 with `--access public`** — must be first publish in release sequence, after all 17 deps at v0.10.0. (3) Add post-publish CI smoke job: clean dir, `npm install reactive-agents`, `import { ReactiveAgents }` — gates GitHub release. (4) Confirm `bin/rax.js` in `files`.

---

#### Verdict tally

| Verdict | Count | Packages |
|---|---|---|
| **KEEP** (no action) | 5 | gateway, verification, prompts, trace, health, scenarios *(6 — gateway counted once)* |
| **KEEP+`_unstable_*`** | 3 | react, svelte, vue |
| **FIX** | 11 | reasoning, runtime, tools, llm-provider, reactive-intelligence, memory, observability, core, cost, eval, diagnose, **umbrella (P0)** *(12 — umbrella counted as P0)* |
| **SHRINK** | 1 | testing |
| **DEFER** | 4 | a2a, interaction, orchestration, identity, benchmarks *(5 — benchmarks already DEFER)* |
| **DELETE** | 0 | none |

**No DELETE verdicts.** Per user policy, every package serves a purpose. The action shifts to FIX (mostly) + `_unstable_*` markers + DEFER documentation in CHANGELOG.

### 10.2 Mechanisms

_(filled during Stage 3)_

---

## 11. Known FIX backlog (carried from prior audits, to be confirmed Stage 3)

These items are flagged in `PROJECT-STATE.md`, the Apr 17 audit (memory `project_v1_audit_apr17`), and the Apr 18 V0.10 blockers (memory `project_v010_audit_blockers`):

1. **Umbrella `reactive-agents` package never published to npm** — anyone trying `npm install reactive-agents` gets nothing. Top priority.
2. **`@reactive-agents/diagnose` never published** — Sprint 3.6 system not on npm.
3. **qwen3 thinking-mode auto-enabled** at `llm-provider/src/providers/local.ts:215` → empties output.
4. **Dual compression systems uncoordinated** (`tool-execution.ts` always-on + `context-compressor.ts` advisory).
5. **ToT outer loop ignores early-stop** (`plan-execute.ts:740`).
6. **3 of 6 skill lifecycle AgentEvents missing** — `SkillActivated`/`SkillRefined`/`SkillConflict` undefined → `_riHooks` callbacks dead.
7. **`MAX_RECURSION_DEPTH = 3` not configurable** (`agent-tool-adapter.ts:6`).
8. **Sub-agent `maxIterations` capped at 3 silently** (`agent-tool-adapter.ts:214-217`).
9. **Calibration defaults to `:memory:`** (`reactive-intelligence/types.ts:164`) — learning lost on restart.
10. **Observability OFF by default** — should be on.
11. **`bun:sqlite` and `Bun.*` in published packages** with no `engines` field — Node users get `ReferenceError: Bun is not defined`.
12. **`rax demo` is fake** — scripted responses, hardcoded token count.
13. **`rax init` hardcodes Anthropic** — OpenAI/Ollama users fail on first run.
14. **`FRAMEWORK_INDEX.md` paths broken** — `strategies/shared/*` → `strategies/kernel/*` (renamed Apr 3).
15. **`VerifierRetryPolicy` + new trace event types not marked `_unstable_*`** — Rule 10 violation.
16. **`RESULTS-p01.md` + `RESULTS-p02.md` overclaim language** — Rule 11 calibration needed.
17. **AUC validation unproven** — failure-corpus AUC=0.000 on first probe.
18. **9 termination paths** in kernel; oracle wired to 1 (NS §2.5).
19. **`ExecutionEngine` 4,404 LOC unchanged** — NS §6 target ~1,500 LOC.
20. **3 compression systems** (per NS §2.7 G-4) — partially closed via curator, deletion deferred.

Stage 3 confirms each, Stage 5 fixes them.

---

## 12. Test suite triage

Stage 3 will pass through every package and answer:

- Does the test exercise behavior, or just typecheck a shape?
- Does the test depend on real LLM/tool calls (and fail flakily)?
- Does the test mock something that should be real?
- Coverage gap: any major code path with no test?

Output: a per-package test verdict in §10.1, plus a list of tests to add or strengthen.

---

## 13. Workflow discipline

- Update this doc as a single source of truth. No parallel audit docs.
- Verdicts only land after the audit dimension is filled in. Don't pre-write verdicts.
- For DELETE verdicts, document the reason precisely; the archival commit will reference it.
- For FIX verdicts, add to §11 backlog if not already there.
- For SHRINK verdicts, name the specific surface to trim.
- This doc lives on `refactor/overhaul`. Updates are branch-local commits until merged at v0.10.0 release.

---

## 14. Audit completion criteria

Audit is complete when:

- [ ] All 28 packages have a verdict in §10.1 with reason + evidence.
- [ ] All 13 mechanisms in §6 have a verdict in §10.2 with reason + evidence.
- [ ] All 35 spec docs have a verdict in §7 (KEEP / archive / fix).
- [ ] All 9 top-level docs in §8 have a verdict.
- [ ] FIX backlog §11 reviewed item-by-item; each confirmed, deleted, or annotated.
- [ ] Test suite triage §12 produces per-package verdicts.
- [ ] Memory reconciliation list ready for Stage 4.

After completion, Stage 5 executes and Stage 6 ships.

---

*Last updated: 2026-04-28 (framework + inventory complete; verdicts pending Stage 3).*
