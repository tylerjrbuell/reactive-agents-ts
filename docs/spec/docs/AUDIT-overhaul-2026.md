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

- `docs/spec/REACTIVE_AGENTS_BUSINESS_MODEL.md` — **archive** unless actively used for positioning; not architectural.
- `docs/spec/REACTIVE_AGENTS_TECHNICAL_SPECS.md` — **archive** if superseded by `15-design-north-star.md` v3.0 (likely yes — needs spot check).
- `docs/spec/TOOL_SYSTEM_PROPOSAL.md` — **archive** if pre-current tool system; spot check first.
- `docs/spec/docs/explorations/` — **keep** as-is. Speculative/exploration docs by design.

### 7.5 Stage 4 archival plan

**Action:** create `docs/spec/docs/_archive/` and move March-era + superseded docs there with a one-line banner at top of each: `> Status: archived 2026-04-28; pre-overhaul. See PROJECT-STATE.md for current state.`

**Files to archive (28):** all `2026-03-11` dated files in `docs/spec/docs/` (full list in §7.3) plus:
- `docs/spec/REACTIVE_AGENTS_BUSINESS_MODEL.md`
- `docs/spec/REACTIVE_AGENTS_TECHNICAL_SPECS.md` (pending spot check)
- `docs/spec/TOOL_SYSTEM_PROPOSAL.md` (pending spot check)

**Files to FIX (regenerate, don't archive):**
- `START_HERE_AI_AGENTS.md` → first paragraph points at `PROJECT-STATE.md`; remove pre-overhaul guidance
- `DOCUMENT_INDEX.md` → regenerate to list only the canonical 7 + this audit + `_archive/` link

**Files to keep as-is:**
- The canonical 7 in §7.1 (PROJECT-STATE, 15-design-north-star, 01-FAILURE-MODES, 00-RESEARCH-DISCIPLINE, 02-IMPROVEMENT-PIPELINE, 00-VISION, AUDIT-overhaul-2026)
- `docs/spec/docs/explorations/`

---

## 8. Inventory — Top-level repo docs

| File | Verdict | Stage 5 action |
|---|---|---|
| `README.md` | **KEEP + FIX** | Accuracy sweep against current state (kernel paths, npm install instructions once umbrella publishes, removal of stale claims) |
| `AGENTS.md` | **KEEP + FIX** | Sweep for stale section refs to deleted/renamed files; verify "Before Starting Work" still cites canonical docs |
| `CLAUDE.md` | **KEEP** | Already a thin pointer to AGENTS.md |
| `CHANGELOG.md` | **KEEP + FIX** | Append v0.10.0 entry capturing the overhaul: deletions/_unstable_*/breaking changes |
| `CONTRIBUTING.md` | **KEEP** | Review-only for accuracy after overhaul lands |
| `CODING_STANDARDS.md` | **KEEP** | Review-only |
| `CAPABILITIES.md` | **KEEP + FIX** | Verify against §10.1 package matrix; remove anything not actually shipping in v0.10.0 |
| `FRAMEWORK_INDEX.md` | **DELETE** | Apr 17 audit confirmed "all kernel paths broken" (5/5 stale). Replaced by `PROJECT-STATE.md` + `AUDIT-overhaul-2026.md` + `15-design-north-star.md`. Don't try to fix; delete and rely on canonical 7. |
| `ROADMAP.md` | **FIX (rewrite)** | Full rewrite for v0.10.0: what shipped, what's `_unstable_*`, what's deferred to v0.11+ (multi-agent orchestration, healing-pipeline spike validation, frontier verifier expansion). |

---

## 9. Inventory — Memory artifacts

| Source | Files | Status |
|---|---|---|
| `~/.claude/projects/.../memory/*.md` | 35 + `MEMORY.md` index | reconcile against current code |
| `.agents/MEMORY.md` (in repo) | 1 | reconcile, sync with personal |

### 9.1 Stage 3 corrections (entries known to be stale or wrong)

| Memory entry | Status | Action in Stage 4 |
|---|---|---|
| `project_v010_audit_blockers` (Apr 18) — claim "AgentEvents missing" | 🟡 partial-stale | Update: events exist at `core/services/event-bus.ts:986-990`; **3/6 hooks lack subscribers** is the real issue. Fix at `builder.ts:2657-2681`. |
| `project_v010_audit_blockers` — claim "calibration defaults to `:memory:`" | ❌ stale | Delete or correct: defaults already at `~/.reactive-agents/calibration.db` (`reactive-intelligence/types.ts:246`). |
| `project_running_issues` — claim "ToT outer loop doesn't honor early-stop" | ✅ confirmed | Keep, link to FIX-5 + M2 verdict. |
| `project_running_issues` — claim "dual compression uncoordinated" | ✅ confirmed | Keep, link to FIX-4/M5 verdict. |
| Memory `MEMORY.md` line "Local is 118 commits ahead of origin" | ❌ stale | Update: `refactor/overhaul` is 100 commits ahead of `main` and now pushed; previous `feat/phase-*` branches archived. |
| Memory `Current Status (Apr 22, 2026)` block — "v0.10.0 release prep complete" | 🟡 misleading | The release prep was docs/changeset, NOT version bumps. All 28 packages still at `0.9.0` locally. Correct phrasing: "v0.10.0 release docs drafted; version bumps + npm publish deferred to overhaul completion." |
| Memory entries about Phase-0 / Phase-1 sprints (multiple `project_*`) | ⏸️ context | Keep historical sprint context as archive but flag with "see AUDIT-overhaul-2026.md §10 for current package state." |

### 9.2 Stage 4 walk-through plan

For each of 35+ memory files:
1. Read the entry
2. Cross-reference against §10.1 (packages), §10.2 (mechanisms), §11 (FIX backlog)
3. Verdict: **KEEP** (still true and load-bearing), **CORRECT** (truth has shifted; update content), **ARCHIVE** (historical, not load-bearing — move to MEMORY-ARCHIVE.md), **DELETE** (false or duplicated).
4. Sync `.agents/MEMORY.md` (in-repo) with personal `~/.claude/projects/.../memory/MEMORY.md` after updates.

Stage 4 produces a single MEMORY-RECONCILIATION.md log of all changes for traceability.

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

> Cross-cutting verdicts that span multiple packages. Most file:line evidence is in §10.1; these focus on whether each mechanism *as a whole* earns its keep against the failure modes it claims to address.

##### M1 — Reactive Intelligence dispatcher (entropy → intervention)

- **Failure modes addressed:** FM-B1 (mitigated via tool-failure-streak handler), FM-A2 (claimed via tool-failure-redirect), FM-D1 (claimed via early-stop), FM-H1 (escalating-redirect handler).
- **Evidence:** Spike-corpus dispatcher AUC = 0.750 (Apr 24); failure-corpus AUC validation probe = 0.000 (memory). Apr 19 trace: 0 decisions at entropy 0.150. **No clean spike that fixes one mechanism in isolation.**
- **Health:** Two structural defects (per `reactive-intelligence` package): dead budget counters at `reactive-observer.ts:294` and `plan-execute.ts:698` make suppression gates unreachable; 3/6 RI hooks have no event subscriber. 4 dead handler files in `controller/handlers/`. ToT outer loop never reaches `runReactiveObserver` (per M2 verdict below).
- **Verdict:** **FIX**
- **Reason:** Capability is real but two structural defects make dispatch near-useless in production; the empirical evidence for net contribution is absent.
- **Stage 5 actions:** Inherited from `reactive-intelligence` package §10.1 — fix budget counter threading, wire 3 missing hooks, delete 4 dead handler files, spike-validate dispatch rate post-fixes. After fixes, run a 30-task corpus reporting dispatched/skipped per skip-reason.

##### M2 — Strategy switching (ReAct ↔ Plan-Execute ↔ ToT ↔ Reflexion ↔ Adaptive)

- **Failure modes addressed:** FM-B2 (verify-loop never converges — claimed), FM-D2 (strategy switch that doesn't recover — known limitation per memory).
- **Evidence:** Strategy registry in `reasoning/services/strategy-registry.ts`. **Unvalidated end-to-end** — no spike validates that a strategy switch actually breaks the failing pattern.
- **Health:** ~~**ToT outer loop bypasses early-stop** (FIX-5)~~ ✅ **resolved W5** — `tree-of-thought.ts` now declares `perStrategyRiBudget` + `perStrategyEarlyStop` after services resolution, scores the best frontier thought via `entropySensor`, evaluates decisions through `reactiveController`, dispatches via `services.dispatcher`, accumulates budget across BFS depth iterations, and breaks the outer for-loop when any patch.kind === `early-stop`. Mirrors plan-execute pattern at depth-iteration boundaries (~75 LOC, fully gated on `services` Some). Step record `[TOT] Dispatcher early-stop signal received at depth N — terminating exploration.` emitted on break. Strategy switch infrastructure works but the new strategy still spawns as a sub-kernel that doesn't inherit the parent's intervention budget or early-stop signals (separate concern, deferred).
- **Verdict:** **FIX (resolved W5; cross-strategy budget-inheritance audit deferred)**
- **Reason:** ToT bypass closed and regression-tested; remaining work is the cross-strategy parent-budget audit.
- **Stage 5 actions:** ~~Mirror `plan-execute.ts:605,716,741` perRIEarlyStop pattern in `tree-of-thought.ts`.~~ ✅ done in commit `89bbe321`. ~~Add T4 regression test confirming a parent-issued early-stop terminates a ToT sub-kernel.~~ ✅ done — `tree-of-thought.test.ts` "dispatcher early-stop terminates BFS outer loop at depth 1 (T4 / FIX-5)" asserts dispatchCallCount, `[TOT] Dispatcher early-stop signal received at depth 1` step, and absence of `[TOT d=2]`/`[TOT d=3]` markers. Audit all strategies for parent-budget inheritance (deferred — Reflexion/Adaptive don't currently have nested budget threading).

##### M3 — Verifier (`agent-took-action` + grounding) + Verifier-driven retry

- **Failure modes addressed:** FM-A1 mitigated for cogito (spike `p01b`: 5/5 reject); FM-C2 (control hook for long-form synthesis fabrication regression on retry).
- **Evidence:** **Spike-validated, mechanism-isolated.** Verifier converts cogito:8b confident-fabrication → honest-fail. Verifier-driven retry HELPS qwen3 (1/1 recovery on rw-2 trace `01KQ84GK70AX1HG485ZRY9QMAS`) and **KILLs cogito** (`p02`: 0/5 + 4× tokens). Control-pillar retry policy injection commit `14135d6d`.
- **Health:** Working. Verifier capability lives at `reasoning/kernel/capabilities/verify/verifier.ts`. `VerifierRetryPolicy` + new trace event types from Sprint 3.6 are missing `_unstable_*` markers (Rule 10 violation).
- **Verdict:** **KEEP + FIX (markers)**
- **Reason:** The harness's clearest empirically-validated lift. Marker hygiene is the only issue.
- **Stage 5 actions:** Mark `VerifierRetryPolicy` + Sprint 3.6 trace event types `_unstable_*`. Calibrate `RESULTS-p01.md` + `RESULTS-p02.md` overclaim language per Rule 11 (FIX-16). Add cross-provider expansion (claude-haiku) before claiming the gate generalizes. Note distinction: this is the **action-outcome verifier** (per-step); `@reactive-agents/verification` package is the complementary **output verifier** (final response). Both kept.

##### M4 — Healing pipeline (4 stages) for FC failures

- **Failure modes addressed:** FM-A2 (persistent FC failure — claimed).
- **Evidence:** **Unvalidated per-tier.** Spike `p02` shows cogito:8b ignores feedback → retry KILL — implication for the healing pipeline is that downstream stages probably also don't help cogito. Stages: tool-name-healer (edit distance), param-name-healer, path-resolver, healing-pipeline orchestrator.
- **Health:** Working as a pipeline shape. Routing decisions and per-stage effectiveness untested.
- **Verdict:** **DEFER (post-release spike validation)**
- **Reason:** Plausible mechanism, no harm, but claims exceed evidence.
- **Stage 5 actions:** Mark Sprint 3.x healing-pipeline surfaces `_unstable_*`. Post-release: design 4 spike scenarios (one per stage) — does each stage actually unstick a stuck FC? On which models?

##### M5 — Context curation: three-stage compression pipeline

- **Failure modes addressed:** FM-F1 (context overflow with information loss).
- **Evidence:** ~~**Known problem** per memory `project_running_issues #4` — two compression systems may both fire on the same run~~ ✅ **W6 investigation closed** — the "dual compression" framing was inaccurate. There are three stages and they're sequenced, not redundant:
  1. **`tool-execution.ts:574`** `compressToolResult()` — per-tool-result content compression. Produces small `displayText` for the prompt; stashes the **full content** in `state.scratchpad` keyed by `storedKey`. Always-on, deterministic, character-budget governed by per-tier `profile.toolResultMaxChars`.
  2. **`context-curator.ts:206-223`** `selectObservationContent()` — the curator (G-4 sole prompt author) reads from scratchpad via `storedKey` and renders the **full content** capped to per-tier budget. This is what the model actually sees in the "Recent tool observations:" section.
  3. **`patch-applier.ts:52-59` + `reactive-observer.ts:357-365`** `compress-messages` — RI-dispatched, advisory, fires when `contextPressure > 0.80`. Trims `state.messages` only. **Steps and scratchpad are intentionally untouched**, so the curator can still re-render observations on the next iteration.
- **Health:** **Pipeline is coordinated.** Verified via grep: `patch-applier.ts` only modifies `state.messages` (not `steps`/`scratchpad`); `reactive-observer.ts:357-365` mirrors that constraint. Curator runs every iteration in `think.ts:298`, so post-trim renders re-populate observations from steps + scratchpad.
- **Verdict:** **KEEP (resolved-by-discovery)** — the audit's prior prescription to "delete tool-execution.ts compression" would have broken the scratchpad write that the curator depends on. The actual coordination is sound.
- **Reason:** Three sequenced stages with distinct roles; no genuine redundancy.
- **Stage 5 actions (W6):** ~~Pick one as canonical.~~ ~~Delete (or hard-disable) the parallel `tool-execution.ts` compression path.~~ ✅ done by discovery — the prescription was based on a misreading. **Done in W6:**
  - Regression test added (`context-curator.test.ts` — "compression coordination (W6 / FIX-4 / FIX-20)"): asserts steps + scratchpad survive a thread-level message trim, and the curator's section still renders FULL_CONTENT via storedKey lookup. Pins the invariant; future patch handlers that touch `state.steps` or `state.scratchpad` on `compress-messages` will fail this test.
  - Fallback test (storedKey missing → curator degrades to displayText) confirms graceful degradation.
  - Audit row updated to describe the three-stage pipeline.

##### M6 — Skill system (lifecycle, AgentEvents, RI hooks)

- **Failure modes addressed:** None directly; learning-pillar capability (NS §3.1 cap #10).
- **Evidence:** Skills exist (resolver, distiller, compression, registry, injection in `reactive-intelligence/`). **Lifecycle wiring incomplete.**
- **Health:** **3/6 RI hooks have no subscriber** (`onSkillActivated`/`onSkillRefined`/`onSkillConflict`). The events themselves exist in `core/services/event-bus.ts:986-990`. Memory note about "AgentEvents missing" is stale — events exist; subscribers don't.
- **Verdict:** **FIX**
- **Reason:** Half-wired. Either complete the wiring or remove the hooks from the public API.
- **Stage 5 actions:** Subscribe `SkillActivated` → `onSkillActivated`, `SkillRefined` → `onSkillRefined`, `SkillConflictDetected` → `onSkillConflict` at `builder.ts:2657-2681`. If no producer ever emits these events from real agent runs, document and either DEFER the hooks or remove them.

##### M7 — Calibration (3-tier resolver, observation store, classifier reliability)

- **Failure modes addressed:** FM-A2 (calibration says native-fc but FC unreliable for cogito — known).
- **Evidence:** Three-tier resolver works; observation store uses 50-run window; `classifierReliability` derived from FP rate.
- **Health:** **Calibration default is correct** at `types.ts:246` (`~/.reactive-agents/calibration.db`) — the memory note about `:memory:` is stale. **Cost router does NOT consult calibration** (`@reactive-agents/cost` audit) — when a tier scores poorly on tool-call reliability, cost-tier choice ignores it.
- **Verdict:** **FIX**
- **Reason:** Calibration data exists but isn't read where it should bias decisions; calibration's claim about cogito (`native-fc`) is itself wrong.
- **Stage 5 actions:** (1) Bias cost router away from tiers with low `toolCallReliability` for tool-heavy tasks (cross-pkg integration). (2) Auto-detect FC unreliability in calibration and downgrade to `text-parse` for cogito-class models. (3) Update memory entry FIX-9 — `:memory:` claim is stale.

##### M8 — Sub-agent delegation (`agent-tool-adapter`)

- **Failure modes addressed:** FM-G1 (sub-agent delegation produces unusable output — unvalidated).
- **Evidence:** `tools/src/adapters/agent-tool-adapter.ts` confirmed. **Unvalidated** — no real multi-agent run trace mining.
- **Health:** **`MAX_RECURSION_DEPTH = 3`** hardcoded at `agent-tool-adapter.ts:6` (FIX-7 confirmed). Sub-agent `maxIterations` cap (`Math.min(userValue, 3)` per Apr 17 audit) silently degrades user values.
- **Verdict:** **FIX**
- **Reason:** Hidden caps + unvalidated capability.
- **Stage 5 actions:** Make `MAX_RECURSION_DEPTH` configurable via builder/runtime config (default 3). Remove silent `Math.min` cap on `maxIterations` — error or warn, don't degrade. Post-release: trace-mine multi-agent runs to estimate FM-G1 prevalence.

##### M9 — Termination oracle (Arbitrator)

- **Failure modes addressed:** FM-D1 (premature termination — mitigated/unvalidated). The 9-path scatter problem.
- **Evidence:** **Architectural blocker confirmed.** 9 `status:"done"` transition sites: 1 oracle (`capabilities/decide/arbitrator.ts:885`) + 8 bypass sites in `kernel/loop/runner.ts:679,817,879,953,1011,1234,1262,1291`. CHANGE A wired the oracle into 1 of 9. Most failure-corpus failure scenarios call `final-answer` as a tool, exiting through act/runner paths that bypass the veto entirely.
- **Health:** Oracle works at the one site it's wired into. The other 8 are dispersed unilateral terminations.
- **Verdict:** **FIX (single highest-value architectural action in the overhaul)**
- **Reason:** This is the corpus-failure root cause per NS §2.5. Until termination is single-owner, the dispatcher / verifier / oracle can't coordinate.
- **Stage 5 actions:** Refactor to a single `terminate(state, reason)` helper in `kernel/loop/` that always consults the arbitrator before transitioning. Replace the 8 direct sites with calls to the helper. Add a CI lint that fails on direct `transitionState({status:"done"})` outside the helper. Re-run failure corpus post-fix and report delta.

##### M10 — Memory system (Working / Semantic / Episodic / Procedural)

- **Failure modes addressed:** FM-F2 (memory pollution across runs — unvalidated theoretical).
- **Evidence:** Per-package audit: 21 unit tests, no cross-run probe. SQLite + FTS5 + consolidation. ~~**AgentMemory port not defined or wired.**~~ ✅ **resolved W11** — `AgentMemory` Tag now in `@reactive-agents/core` with adapter in `memory/src/services/agent-memory-adapter.ts`; kernel resolves the port. PlanStoreService coupling at `plan-execute.ts:21` remains and is deferred.
- **Health:** `bun:sqlite` hard import breaks Node consumers; sync DB blocks event loop.
- **Verdict:** **FIX** (verdict from `@reactive-agents/memory` package).
- **Reason:** Capability shape matches NS §2.7 but the runtime is Bun-only and the port is dead.
- **Stage 5 actions:** Inherited from package §10.1.

##### M11 — Diagnostic system (Sprint 3.6)

- **Failure modes addressed:** FM-A3 (output-leak diagnosis — addressed by recent commit `5e654e5c`).
- **Evidence:** TraceEvent stream + JSONL recorder + `rax diagnose` CLI. Sprint 3.6 added 5 diagnostic event types. **`@reactive-agents/diagnose` never published** to npm — external users cannot run `rax diagnose`.
- **Health:** Working internally; 0 tests for the 595-LOC CLI.
- **Verdict:** **FIX**
- **Reason:** Critical for Rule 11 spike-validation flywheel; not externally accessible.
- **Stage 5 actions:** Inherited from `@reactive-agents/diagnose` package §10.1 (publish + 4 smoke tests).

##### M12 — Provider adapter system (7 hooks)

- **Failure modes addressed:** FM-A1 (no-tool fabrication — partly via taskFraming/qualityCheck/synthesisPrompt), FM-H1 (required-tool nudges — via continuationHint), broader DX across tiers.
- **Evidence:** All 7 hooks wired (memory `project_composable_adapters`); native FC migration shipped Mar 2026. 35/35 Sonnet bench. Tier-specific adapters (`defaultAdapter`/`localModelAdapter`/`midModelAdapter`).
- **Health:** Hooks work; calibration → tier resolution at `selectAdapter`. qwen3 thinking auto-enable bug is in the same package but a different code path.
- **Verdict:** **KEEP**
- **Reason:** The cleanest validated end-to-end mechanism in the harness.
- **Stage 5 actions:** None at the mechanism level. Package-level fixes (qwen3 thinking + `_unstable_*` markers) are in §10.1.

##### M13 — Guards + meta-tools registry

- **Failure modes addressed:** FM-D1 (premature termination — required-tools guard).
- **Evidence:** Guards live in `kernel/capabilities/decide/` (or similar — verify). Required-tools guard at `runner.ts:1260-1290` per memory; in-loop redirect.
- **Health:** **Required-tool nudges don't work for non-compliant models** (FM-H1 — empirical: `p02` shows cogito ignores nudge feedback). The guard fires; the model doesn't comply. This is FM-H1's "requires-model-swap" controllability.
- **Verdict:** **KEEP + FIX**
- **Reason:** Mechanism fires correctly; the issue is downstream — non-compliant models. Auto-detection of non-compliance + text-parse fallback would help.
- **Stage 5 actions:** Add auto-detection: after N nudge-without-comply events for a session, switch the driver to text-parse for that model (if calibration permits). Tie into M7 calibration.

---

#### Mechanism tally

| Verdict | Count | Mechanisms |
|---|---|---|
| **KEEP** | 1 | M12 (provider adapter system) |
| **KEEP + FIX** | 2 | M3 (verifier+retry — markers only), M13 (guards — auto-detect non-compliance) |
| **FIX** | 8 | M1 (RI dispatcher), M2 (strategy switching), M5 (dual compression), M6 (skill hooks), M7 (calibration→cost integration), M8 (sub-agent caps), M9 (**9-termination-path scatter — top action**), M11 (diagnose publish) |
| **FIX (inherited)** | 1 | M10 (memory) — verdict from package |
| **DEFER** | 1 | M4 (healing pipeline — needs spikes) |
| **DELETE** | 0 | none |

**The single highest-leverage Stage 5 action is M9** — collapsing the 9 termination paths to single-owner via the arbitrator. NS §2.5 calls this the architectural blocker; the failure corpus confirms it; CHANGE A is "a gate at one door of a building with nine doors."

---

## 10.5 Empirical — failure-corpus 3/8 → 8/8 (Stage 5 quality fix, 2026-04-28)

A scratch run on cogito:14b + failure-corpus rerun surfaced three independent verifier/observability defects compounding into systemic quality damage. Prior to fix, the framework was actively rejecting legitimate answers and showing "Status: Success" on failed runs.

**Empirical delta:**

| Run | Correct booleans | Entropy gap (success vs failure) |
|---|---|---|
| Before fix | 3/8 (4/4 successes incorrectly failed) | -0.038 (no signal) |
| After fix | **8/8** | +0.257 (clear signal) |

**Defects (all in same Stage-5 commit):**
1. **`agent-took-action`** fired on every wired tool (not just `requiredTools`) — trivial tasks like "capital of France" got rejected because they didn't call any tool, even though answer was correct. Fix: gate on explicit user `requiredTools`.
2. **`synthesis-grounded`** Title-Case extractor produced 64-73% ungrounded rates on legitimate paraphrased summaries (HN digests, search results) because section labels and abridged titles count as "claims." Fix: split the check — compression-marker detection stays always-on (zero false-positive risk); substring claim-grounding becomes opt-in via `enableClaimGrounding`.
3. **Status display lie** — `console-exporter.ts` computed status from phase health, ignoring the actual kernel-level success. Showed "Status: Success" on verifier-rejected runs. Fix: emit `execution.success` gauge from runtime; exporter prefers it over phase inference.

**This is the single largest quality improvement of the overhaul so far.** Nothing else moved the failure-corpus score this much.

---

## 11. FIX backlog — Stage 3 reconciled

Status legend: ✅ confirmed | 🟡 partial / corrected | ❌ stale (no action needed) | 🆕 newly discovered.

### 11.1 Carried-forward items (1–20)

| # | Item | Status | Resolution / file:line |
|---|---|---|---|
| 1 | Umbrella `reactive-agents` package never published | ✅ | **P0 release blocker.** Action in `reactive-agents` (umbrella) §10.1. |
| 2 | `@reactive-agents/diagnose` never published | ✅ | Action in diagnose §10.1. |
| 3 | ~~qwen3 thinking-mode auto-enabled~~ | ✅ **resolved W7** | Inverted default: thinking is OPT-IN. `resolveThinking()` at `providers/local.ts:226-263` returns `undefined` unless `configThinking === true`. Capability verification still gates explicit opt-in (so granite3.3-style models warn-once and omit instead of erroring at the API). |
| 4 | ~~Dual compression systems uncoordinated~~ | ✅ **resolved-by-discovery W6** | The "dual" framing was wrong. Three stages sequenced: `tool-execution.ts` compress-and-stash → curator render-from-stash → `compress-messages` patch trims messages only (steps/scratchpad untouched, so curator re-renders next iteration). Regression test in `context-curator.test.ts` pins the invariant. See M5. |
| 5 | ~~ToT outer loop ignores early-stop~~ | ✅ **resolved W5** | Commit `89bbe321`: BFS frontier scored via `entropySensor`; `reactiveController` decision evaluation; `services.dispatcher` dispatch with `perStrategyRiBudget` accumulator across depth iterations; outer for-loop breaks on `patch.kind === "early-stop"`. ~75 LOC, gated on `services` Some so no-dispatcher runs unaffected. Mirrors plan-execute pattern at depth-iteration boundaries. T4 regression test added (`tree-of-thought.test.ts` — verifies BFS terminates at depth 1 with stub dispatcher returning `early-stop` patch). |
| 6 | 3/6 skill lifecycle AgentEvents missing | ✅ **resolved W2** | Events DO exist at `core/services/event-bus.ts:986-990`. Subscribers wired at `builder.ts:2682-2716` (commit on `refactor/overhaul`). |
| 7 | ~~`MAX_RECURSION_DEPTH = 3` not configurable~~ | ✅ **resolved W7** | New `resolveMaxRecursionDepth()` reads from explicit `SubAgentConfig.maxRecursionDepth` → `REACTIVE_AGENTS_MAX_RECURSION_DEPTH` env var → default 3. Both depth-check sites updated. `MAX_RECURSION_DEPTH` retained as `@deprecated` alias. |
| 8 | Sub-agent `maxIterations` capped silently | ✅ **already resolved (Apr 17)** | W2 verification: cap is gone. `agent-tool-adapter.ts:212` reads `const effectiveMaxIter = config.maxIterations ?? subAgentDefaults.maxIterations` — user config fully honored. Comment at line 92 confirms. |
| 9 | Calibration defaults to `:memory:` | ❌ **stale** | `types.ts:246` already defaults to `~/.reactive-agents/calibration.db`. **Memory note FIX-9 needs correction.** |
| 10 | Observability OFF by default | ✅ **already resolved (Apr 17)** | W2 verification: `builder.ts:896` reads `private _enableObservability: boolean = true`. Default is ON with `verbosity: "minimal"` (line 898). The blanket `Logger.none` silencing at execution-engine.ts:4244 is a separate item (#27, W8). |
| 11 | ~~`bun:sqlite` + `Bun.*` without `engines` field~~ | ✅ **resolved W12 (part a; Node fallback deferred to v0.11)** | `engines: { bun: ">=1.1.0" }` added to 8 published packages with direct Bun runtime usage (a2a, cost, eval, health, llm-provider, memory, reactive-intelligence, tools) plus the umbrella `reactive-agents`. Audit by grep: `bun:sqlite` imports in `cost/budgets/budget-db.ts`, `memory/database.ts`, `reactive-intelligence/calibration-store.ts` + `bandit-store.ts`; real `Bun.*` calls (excluding doc comments) in 9 src files across the package set. `runtime` excluded — only JSDoc references. `benchmarks` excluded — `private: true` (workspace-internal). Umbrella standardized from `>=1.0.0` → `>=1.1.0`. Guard test at `core/tests/engines-field.test.ts` pins the contract going forward. **Node fallback (T14: lazy-load `bun:sqlite` vs `better-sqlite3`) is the v0.11 follow-up** — Bun is the primary engine for v0.10.0, conversion plan is separate. |
| 12 | `rax demo` is fake (scripted responses, hardcoded token count) | ⏸️ | Not re-audited. Apr 17 finding carry-forward; Stage 5 fix in CLI. |
| 13 | `rax init` hardcodes Anthropic | ⏸️ | Not re-audited. Apr 17 finding carry-forward. |
| 14 | `FRAMEWORK_INDEX.md` paths broken (`strategies/shared/*`) | ⏸️ | Apr 17 finding. Top-level doc verdict in §8: **FIX or DELETE**. |
| 15 | `VerifierRetryPolicy` + new trace event types not `_unstable_*` | ✅ **bigger than reported** | llm-provider has 14+ surfaces missing markers. M3 mechanism + llm-provider §10.1 action. |
| 16 | `RESULTS-p01.md` + `RESULTS-p02.md` overclaim language | ✅ | Rule 11 calibration. M3 action. |
| 17 | AUC validation unproven (corpus AUC = 0.000) | ✅ | Confirms M1 unvalidated. Post-RI-fix, re-run. |
| 18 | ~~9 termination paths in kernel; oracle wired to 1~~ | ✅ **resolved W4** | All 8 imperative sites in `runner.ts` now route through `kernel/loop/terminate.ts` `terminate()` helper. Arbitrator remains the verdict-driven oracle. CI lint at `scripts/check-termination-paths.sh` enforces the single-owner invariant going forward. |
| 19 | ExecutionEngine 4,404 LOC unchanged | ✅ **actual 4,476 LOC** | Plus newly discovered: **`builder.ts` is 5,877 LOC** — even larger orchestration surface. Combined: 10,353 LOC. Action in runtime §10.1. |
| 20 | ~~3 compression systems (NS §2.7 G-4)~~ | ✅ **resolved-by-discovery W6** | Three exist by design — sequenced as a pipeline (compress-and-stash → curator-render → optional thread-trim), not three redundant compressors. See #4 + M5. |

### 11.2 Newly discovered (Stage 3 audit)

| # | Item | Severity | File:line |
|---|---|---|---|
| 21 | ~~Eval Rule 4 frozen-judge fails 3/4~~ | ✅ **resolved W9** | New `JudgeLLMService` Tag at `eval/src/services/judge-llm-service.ts` distinct from SUT's `LLMService`; eval-service yields the judge tag instead. `JudgeConfig` schema (model + provider + optional codeSha) added to `EvalConfig`. `createEvalLayer` doc block now describes the separate-provider wiring pattern. Code-path isolation enforced by Tag distinction. |
| 22 | ~~**`runSuite` is broken**~~ | ✅ **resolved W6.5** | New required `agentRunner: SuiteAgentRunner` parameter on `runSuite(suite, agentConfig, agentRunner, config?)` — caller supplies the SUT runner, output flows through to dimension scoring + `EvalResult.actualOutput`. Placeholder `"[evaluated via LLM-as-judge]"` removed. Rule-4 guard added: `runSuite` fails with `BenchmarkError` when `config.judge.model === agentConfig`. Tests rewritten to (a) provide `JudgeLLMService` (W9 left them broken on `LLMService`) and (b) pass a stub `SuiteAgentRunner`. T10 happy + sad path landed. apps/cli/eval updated to wire `JudgeLLMService` via `buildJudgeLayer()` + builds an `LLMService`-backed `SuiteAgentRunner`. README example updated to show the new signature. |
| 23 | ~~RI budget counters dead-zeroed every iteration~~ | ✅ **resolved W3** | Added `riBudget` to `KernelMeta` (kernel-state.ts:160-176); reactive-observer threads through `KernelState.meta.riBudget`; plan-execute declares `perStrategyRiBudget` outside refinement loop. Suppression gates (`maxFiresPerRun=5`, `maxInterventionTokenBudget=1500`) now reachable. Stale comment in `tool-failure-redirect.ts:12` updated. |
| 24 | **`builder.ts` is 5,877 LOC** — biggest single orchestration surface, undocumented prior to this audit | High (top SHRINK target with ExecutionEngine) | `runtime/src/builder.ts` |
| 25 | ~~Duplicate `AgentConfigSchema`~~ | ✅ **resolved W2** | core renamed `AgentConfigSchema` → `AgentDefinitionSchema` and `AgentConfig` → `AgentDefinition`; runtime's full version is now unambiguous. Consumer updated at `tools/src/adapters/agent-tool-adapter.ts:2,477`. |
| 26 | ~~`effect` not in core's `dependencies`~~ | ✅ **resolved W2** | Moved from `devDependencies` to `dependencies`; `peerDependencies` retained. Conservative library pattern — package works standalone if peer not satisfied; npm dedupes overlapping versions. |
| 27 | Blanket `Logger.replace(Logger.defaultLogger, Logger.none)` at execution-engine silences all `Effect.log*` calls | Medium (designed-as-intended w/ tradeoff) | `runtime/src/execution-engine.ts:4252`. W8 inspection: this is a deliberate "ObservableLogger owns all output" enforcement — TTY-conditional was tried and abandoned because it caused CI/terminal divergence. The deeper fix is to wrap `ObservableLogger` as a custom Effect Logger so `Effect.log*` events become structured `ObservableLoggerService` events instead of being silenced. Updated source comment to document the tradeoff. Track for v0.11. |
| 28 | ~~Telemetry token split is 70/30 estimate~~ | ✅ **resolved W8** | `LLMRequestCompleted` gains optional `tokensIn`/`tokensOut` fields. Telemetry collector prefers provider-reported values; falls back to 70/30 estimate for providers that don't report them yet (incremental rollout per provider). |
| 29 | ~~`cacheHits` declared but never incremented~~ | ✅ **resolved W8** | `LLMRequestCompleted` gains optional `cached?: boolean`. Collector increments `acc.cacheHits` when `event.cached === true`. `cacheHitRate` now reflects real cache behavior. |
| 30 | ~~`strategy` only captured on `FinalAnswerProduced`~~ | ✅ **resolved W8** | Subscribed to `ReasoningIterationProgress` (fires every iteration regardless of outcome) so failed tasks get strategy attribution. `FinalAnswerProduced` retained as no-op fallback. First-write-wins (`unknown` guard). |
| 31 | **MetricsCollector silent fallback** to fresh collector if shared layer missing → undetectable divergence | Medium | `observability/src/observability-service.ts:478-484` |
| 32 | ~~**Cost router does NOT consult calibration**~~ | ✅ **resolved W10** | New `RoutingContext` parameter on `analyzeComplexity` / `routeToModel` carries `requiresTools` + per-tier `calibration.toolCallReliability` + `toolReliabilityThreshold` (default 0.5). `escalateForToolReliability()` walks the haiku→sonnet→opus ladder, returning the first tier whose calibration is missing (unknown → assume usable) or meets threshold; falls back to most-reliable tier when all are below. Adds factor `tool-reliability-escalation:<from>-><to>` or `tool-reliability-confirmed`. Pure function, no service lookup; caller translates from their calibration store into the narrow shape. Six new tests in `complexity-router.test.ts`. |
| 33 | ~~**Hardcoded model SHAs in cost are stale**~~ | ✅ **resolved W10** | Anthropic sonnet → `claude-sonnet-4-6`, opus → `claude-opus-4-7`; gemini sonnet/opus moved off `gemini-2.5-pro-preview-03-25` pin to stable `gemini-2.5-pro`; litellm opus → `claude-opus-4-7`. Sonnet `maxContext` bumped to 1M to match Sonnet 4.6 capability. Haiku already current at `claude-haiku-4-5-20251001`. SHA-refresh sanity test added. |
| 34 | ~~**AgentMemory port not defined or wired**~~ | ✅ **resolved W11 (scoped to tool-execution semantic write; PlanStoreService coupling deferred)** | New `AgentMemory` Tag in `@reactive-agents/core/src/services/agent-memory.ts` with narrow surface (`storeSemantic` only — what kernel actually consumes today). New `AgentMemoryEntry` input type (port-level shape). Adapter Layer `AgentMemoryFromMemoryService` at `memory/src/services/agent-memory-adapter.ts` bridges the heavy `MemoryService` impl to the port. Wired into `createMemoryLayer` so the standard happy path satisfies the port without extra setup. Kernel resolves `AgentMemory` (not `MemoryService`) at `reasoning/src/kernel/utils/service-utils.ts:185-190`. Phase-2 prep: payoff arrives when a second `AgentMemory` provider (user agent without the memory package) wires up. Tests: `core/tests/agent-memory.test.ts` proves a no-`MemoryService`-Layer satisfies the port; `memory/tests/agent-memory-adapter.test.ts` pins the SemanticEntry conversion. **Scope flag:** `plan-execute.ts:21` still imports `PlanStoreService` from `@reactive-agents/memory` — separate plan-store decoupling deferred to v0.11. |
| 35 | **Sync-only memory DB layer** (`Effect.sync` over bun:sqlite) blocks event loop | Medium | `memory/src/database.ts`, NS G-3 |
| 36 | **Identity service merged into runtime layer but no consumer reads it** — `IdentityService`, `PermissionManager`, `AuditLogger`, `CertificateAuth` all dormant | Low (DEFER) | `runtime/src/runtime.ts:1346` is sole reference |
| 37 | ~~4 dead RI handler files~~ ❌ **stale** — Stage 5 W2 verification found no such files. The 4 names are *evaluators* in `controller/evaluators/`, intentionally kept per explicit source comment at `controller-service.ts:12-21`: "evaluator source files remain so the logic is recoverable; re-add them only when a real dispatch handler ships alongside." Test `tests/controller/new-evaluators.test.ts` still references them. **No action needed.** | resolved | — |
| 38 | ~~`recommendStrategyForTier` returns `undefined` always~~ | ✅ **resolved W2** | Function deleted from `llm-provider/src/adapter.ts`; export removed from index; call site at `runtime/execution-engine.ts:1647` simplified to `const effectiveStrategy = c.selectedStrategy ?? "reactive"`. |
| 39 | **`ProviderCapabilities` `@deprecated` but still exported as supported** | Low | `llm-provider/src/index.ts:2` |
| 40 | **Testing pkg `gate/` runner has zero CI invocations** — 13.5K LOC unvalidated by external callers | Medium (SHRINK) | `testing/src/gate/runner.ts`; mark `_unstable_gate_*` |
| 41 | **`ExperimentService` (in prompts) used by only one example** — needs `_unstable_*` | Low | `prompts` package |
| 42 | **react/svelte/vue zero in-repo consumers** — Cortex UI uses its own framework, not the published packages | Low (DX gap) | dogfooding gap; mark `_unstable_*` |
| 43 | **svelte unused `derived` imports** (lint flag) and **peerDep `>=4.0.0` vs devDep `^5.0.0`** version mismatch | Low | `svelte/src/agent.ts`, `agent-stream.ts` |
| 44 | ~~**diagnose `__tests__/` directory exists empty**~~ | ✅ **resolved W6.6** | New `packages/diagnose/tests/diagnose.test.ts` lands T11: 12 smoke tests covering `resolveTracePath` (absolute/missing/bare-id/did-you-mean), `listTraces` (mtime-desc sort), `replayCommand --json` (JSONL round-trip + default timeline header), `grepCommand` (predicate match, empty-expr reject, invalid-expr reject, silent skip on field errors), `diffCommand` (stat block emit). 12/12 pass. The empty `__tests__/` directory referenced by the original finding never existed in src; tests now live under `tests/` matching the rest of the workspace convention. |

### 11.3 Backlog priority for Stage 5

**P0 (release blocker — must ship for v0.10.0 to be "clean"):**
- #1 Publish umbrella `reactive-agents`
- #2 Publish `@reactive-agents/diagnose`
- #3 Fix qwen3 thinking auto-enable
- #18 Collapse 9 termination paths to single-owner
- #21 Eval frozen-judge (if v0.10.0 claims benchmark numbers)

**P1 (high — strongly degrades release quality):**
- ~~#4/#20 Pick canonical compression system~~ ✅ **resolved-by-discovery W6** (audit framing was wrong; pipeline is coordinated)
- ~~#5 ToT outer loop early-stop~~ ✅ **resolved W5** (T4 regression test landed)
- #6 Wire 3 missing skill-hook subscribers
- #7 Make `MAX_RECURSION_DEPTH` configurable
- #15 Mark `_unstable_*` per Rule 10 (multiple packages)
- #19/#24 SHRINK ExecutionEngine + builder.ts
- #23 Thread RI budget through dispatch context
- #25 Resolve duplicate `AgentConfigSchema`

**P2 (medium — quality-of-life):**
- #10 Default observability ON
- ~~#11 `engines: { bun: ">=1.1" }`~~ ✅ **resolved W12** (part a — engines field landed; Node fallback deferred to v0.11 per "Bun is primary engine" direction)
- #14 Fix or delete FRAMEWORK_INDEX.md
- #16 Calibrate p01/p02 RESULTS overclaim
- ~~#22 Fix or delete `runSuite` placeholder~~ ✅ **resolved W6.5** (FIX-22, T10)
- #27/#28/#29/#30/#31 Observability/telemetry defects
- ~~#32/#33 Cost router calibration coupling + SHA refresh~~ ✅ **resolved W10**
- ~~#34 Define `AgentMemory` port~~ ✅ **resolved W11** (Phase-2 prep — pays off when a second consumer/provider lands)
- ~~#44 Add diagnose smoke tests~~ ✅ **resolved W6.6** (T11 landed; 12/12 pass)

**P3 (low — cleanup, post-v0.10.0 OK):**
- #8 Sub-agent maxIterations cap
- #9 Update memory FIX-9 (stale claim)
- #12 `rax demo` authenticity
- #13 `rax init` provider neutrality
- #17 Re-run AUC after #23 lands
- #26 effect dependency hygiene
- #35 Async memory DB
- #36 Wire identity into tool exec
- #37/#38 Delete dead handler files + dead `recommendStrategyForTier`
- #39 Resolve ProviderCapabilities deprecation
- #40 `_unstable_gate_*` markers
- #41/#42/#43 UI integration `_unstable_*` + svelte cleanup

---

## 12. Test suite triage

Stage 3 first pass (synthesized from per-package audits in §10.1).

### 12.1 Coverage by tier

| Tier | Packages | Verdict |
|---|---|---|
| **Strong** (real behavioral tests, healthy ratio) | core, runtime, reasoning, tools, gateway, a2a (HTTP/SSE), health, prompts, guardrails, verification | KEEP — no action needed beyond fix-driven test additions |
| **Adequate-but-shape-heavy** | reactive-intelligence (61 tests cover shapes, not behavioral lift), observability (21 tests, OTLP shutdown path missing), memory (21 unit tests, no cross-run probe), llm-provider (27 / 8K LOC ≈ 1 per 300), trace, identity, interaction (0.6% coverage ratio), cost, orchestration, scenarios, umbrella | FIX — add behavioral / regression tests per Stage 5 actions |
| **Zero coverage** (release-blocker for npm publish at v0.10.0) | `diagnose` (empty `__tests__/`), `react`, `svelte`, `vue` | FIX — add minimum smoke + contract tests |
| **Coverage producing wrong signal** | `eval` (Rule 4 frozen-judge fails; `runSuite` is broken), `benchmarks` (private, 2 test files for 3K LOC), `testing` (`gate/` has zero CI invocations) | FIX (eval), `_unstable_*` markers (benchmarks/testing/gate) |

### 12.2 Specific tests to add (cross-package)

| # | Test | Package(s) | Why |
|---|---|---|---|
| T1 | `resolveThinking(client, "qwen3:14b", undefined)` returns `undefined` | llm-provider | Closes FIX-3 regression |
| T2 | Cross-provider verifier `agent-took-action` test (claude-haiku + cogito + qwen3) | reasoning | Validates M3 generalizes (Rule 3 cross-provider) |
| T3 | Single-owner termination lint: fail CI if `transitionState({status:"done"})` appears outside the helper | reasoning | Defends M9 architectural invariant |
| T4 | ToT early-stop regression: parent issues early-stop, ToT sub-kernel terminates | reasoning | Closes FIX-5 |
| T5 | RI dispatcher 30-task corpus probe with budget threading enabled | reactive-intelligence | Validates M1 post-fix; replaces 0.000 AUC probe |
| T6 | Cross-run memory pollution probe (agent A's recall never returns agent B's entries) | memory | Converts FM-F2 unvalidated → mitigated/known-defect |
| T7 | OTLP shutdown error-path test | observability | Closes coverage gap |
| T8 | `MAX_RECURSION_DEPTH` configurable: builder override propagates to adapter | tools | Closes FIX-7 |
| T9 | Sub-agent `maxIterations` no longer silently capped: bad value errors or warns | tools | Closes FIX-8 |
| T10 | Eval judge model differs from SUT model assertion | eval | Enforces Rule 4 |
| T11 | Diagnose CLI smoke: `resolveTracePath`, `replay --json` round-trip, `grep` predicate parsing, `diff` outputs | diagnose | Closes diagnose 0-test gap |
| T12 | UI SSE parser contract test (one shared parser, exercised by react+svelte+vue) | react/svelte/vue | Closes 0-test gap; prevents silent runtime/UI drift |
| T13 | Umbrella `npm install reactive-agents` clean-dir CI smoke | umbrella | Gates GitHub release |
| T14 | Memory `bun:sqlite` import behind runtime detection (Bun ↔ Node fallback) | memory | Closes FIX-11 |
| T15 | `enableObservability=true` default: spans + metrics fire on every run without explicit opt-in | observability | Closes FIX-10 |

### 12.3 Tests that should be deleted or rewritten

| # | Test | Reason |
|---|---|---|
| TR1 | `eval/runSuite` test (if any) hitting `actualOutput: "[evaluated via LLM-as-judge]"` placeholder | Tests broken behavior; either fix `runSuite` or delete |
| TR2 | Any RI test asserting suppression-gate behavior (`maxFiresPerRun`, `maxInterventionTokenBudget`) | Currently passes only because budget counters are dead-zeroed; rewrite after fix #23 |

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

- [x] All 28 packages have a verdict in §10.1 with reason + evidence.
- [x] All 13 mechanisms in §6 have a verdict in §10.2 with reason + evidence.
- [x] All 35 spec docs have a verdict in §7 (KEEP / archive / fix).
- [x] All 9 top-level docs in §8 have a verdict.
- [x] FIX backlog §11 reviewed item-by-item; each confirmed, deleted, or annotated. 44 items total (20 carried + 24 newly discovered), prioritized P0-P3.
- [x] Test suite triage §12 produces per-package verdicts and 15-test addition list.
- [x] Memory reconciliation list ready for Stage 4 in §9.1.

**Stage 3 audit complete: 2026-04-28.** Stage 4 (doc + memory reset) and Stage 5 (overhaul execution) are the next two stages. Stage 6 validates and ships v0.10.0.

---

## 15. Stage 5 execution sequencing (preview)

Stage 5 executes the verdicts in waves. Each wave is a discrete commit on `refactor/overhaul`. Waves are sequenced so test suite stays green at every commit.

| Wave | Focus | Backlog items | Target commits |
|---|---|---|---|
| **W0 — Memory + doc hygiene** | Stage 4 outputs: archive 28 March-era spec docs, regenerate START_HERE/DOCUMENT_INDEX, delete FRAMEWORK_INDEX, rewrite ROADMAP, reconcile memory entries | docs/§7, §8; memory/§9.1 | 4–6 commits |
| **W1 — `_unstable_*` markers (Rule 10)** | Mechanical: tag every newly-added or unvalidated public API per the package audits. No behavior change. | #15 (broad), #38, #39, #40, #41, #42, #43 | 8–10 commits, one per package |
| **W2 — Stale corrections (low risk)** | #9 memory FIX, #6 hook subscriber wiring, #25 duplicate AgentConfigSchema rename, #26 effect dependency hygiene, #37 delete 4 dead RI handler files, #38 delete dead `recommendStrategyForTier` | #6, #9, #25, #26, #37, #38 | 5–6 commits |
| **W3 — RI dispatcher fix** | #23 thread budget through `KernelState.meta.riBudget`. Add T5 30-task dispatch-rate probe. | #23 | 2 commits |
| **W4 — Architectural blocker (M9)** | **#18 collapse 9 termination paths to single-owner via Arbitrator.** Add T3 CI lint. Re-run failure corpus, report delta. **The single highest-value action in the overhaul.** | #18 | 3–4 commits + corpus rerun |
| **W5 — Strategy switching parity** | #5 ToT early-stop wiring. T4 regression test. Audit other strategies for parent-budget inheritance. | #5 | 2 commits |
| **W6 — Compression coordination** | #4 / #20 pick curator as canonical compression; delete or hard-disable `tool-execution.ts` parallel path. Long-context probe. | #4, #20 | 2–3 commits |
| **W7 — Provider + tool fixes** | #3 qwen3 thinking auto-enable + T1 regression. #7/#8 MAX_RECURSION_DEPTH config + maxIterations cap removal + T8/T9 tests. #11 memory bun:sqlite engines/Node fallback + T14. | #3, #7, #8, #11 | 4–6 commits |
| **W8 — Observability defaults** | #10 default-on. #27 TTY-conditional Logger.none. #28/#29/#30/#31 telemetry-collector defects + T7. T15. | #10, #27, #28, #29, #30, #31 | 4–5 commits |
| **W9 — Eval Rule 4** | #21 frozen-judge: `JudgeLLMService` Tag, `judge.model !== sut.model` guard. #22 fix or delete `runSuite`. T10. | #21, #22 | 3 commits |
| **W10 — Cost router calibration coupling** | #32 calibration consultation. #33 SHA refresh. | #32, #33 | 2 commits |
| **W11 — SHRINK heavyweights** | #19 ExecutionEngine extraction (telemetry/debrief/classifier/skill-loading) target < 1,500 LOC. #24 builder.ts extraction target < 2,500 LOC. Test suite must stay green at every commit. | #19, #24 | 8–15 commits (multi-session) |
| **W12 — Publish + smoke gate** | #1 publish umbrella reactive-agents. #2 publish @reactive-agents/diagnose. T11/T12/T13 smoke tests. Re-run AUC corpus (#17). | #1, #2, #17, T11, T12, T13 | 4–5 commits + npm publish |
| **W13 — Stage 6 validation** | bench, typecheck, full test suite, README/CHANGELOG/ROADMAP polish, tag v0.10.0 | — | 3 commits + tag |

Estimated: 50–75 commits across 6–10 sessions for Stages 4–6. P0 items (#1, #2, #3, #18, #21) are the gating set for v0.10.0; everything else is "should land for clean release" but the P3 tier can defer to v0.10.1 if scope creeps.

---

*Last updated: 2026-04-28 (Stage 3 audit complete; all sections populated; ready for Stage 4 execution).*
