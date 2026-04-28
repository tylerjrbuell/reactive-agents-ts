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

_(filled during Stage 3)_

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
