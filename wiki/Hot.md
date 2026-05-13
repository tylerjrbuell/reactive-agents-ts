---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-05-13
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-05-13, morning)

### Compose API Wave B — COMPLETE ✅

Commits `d8cec216` → `72bc3727` (Parts 1–4). All tests pass (102 runtime, 12 core/reasoning).

**What shipped:**
- `HarnessPipeline` plumbed through `RuntimeOptions` → `ReactiveAgentsConfig` → `ReactiveAgentBuilder`
- `_harnessRegistrations` compiled to `HarnessPipeline` in `runtime-construction.ts`
- `harnessPipeline` threaded through reasoning type chain: `ReasoningExecuteRequest` → `StrategyRegistryInput` → `ReactiveInput`/`DirectInput` → `KernelInput`
- `prompt.system` chokepoint wired in **both** execution paths:
  - Reasoning path: `packages/reasoning/src/kernel/capabilities/reason/think.ts`
  - Inline path: `packages/runtime/src/engine/phases/agent-loop/inline-think.ts`
- Example: `apps/examples/src/advanced/20-compose-harness.ts` (PASSES)

**Root cause found during debug:** inline path (`runInlineThink`) never went through the reasoning kernel, so the `think.ts` chokepoint in `packages/reasoning` was unreachable for agents without `.withReasoning()`. Fixed by adding the chokepoint directly in `inline-think.ts`.

**v0.12 deferred chokepoints** (registrations compile but transforms are pass-through):
- `nudge.loop-detected`, `nudge.healing-failure`, `message.tool-result`, `observation.tool-result`

---

## Previous Session (2026-05-12, evening)

### M3 REWORK Implemented ✅

Commit `051c22be` — 1126/1126 tests pass.

- Removed terminal retry loop (runner.ts sites 1 + 2)
- Retained post-loop pass/fail gate (site 3, ~runner.ts:1547)
- Removed dead vars: `verifierRetries`, `maxVerifierRetries`, `verifierRetryPolicy`, `defaultVerifierRetryPolicy`
- Removed `DEBUG_VERIFIER` env-var logging (superseded by trace events)
- Updated Pivot A test to assert no-retry behavior
- Decision doc: `wiki/Decisions/2026-05-12-m3-terminal-verifier-rework.md`
- Issue #5 (strategy switching) closed; Issue #6 updated to REWORK IN PROGRESS

### Issue #7 Implemented ✅

Commit `4c3cdd1c` — `.withLeanHarness()` added to `ReactiveAgentBuilder`.
- Injects no-op verifier (always passes terminal gate) + disables strategy switching
- Wired through `runtime.ts` → `RuntimeOptions.leanHarness` → `KernelInput.verifier`
- All 1126+753 tests pass
- Empirical basis: NLAH §3 — full harness 13.6× tokens, −0.8pp on frontier models

### Issue #3 Re-scoped ✅

Commit `latest` — terminal retry surface removed by M3 REWORK; no tuning possible.
- `retry-context.ts`, `defaultVerifierRetryPolicy`, `improvedVerifierRetryPolicy` are orphaned public API
- Active FM-A1 mitigation: `oracle-nudge.ts` (Pivot B, already shipped)
- Before v0.11: clean up orphaned exports + `KernelInput.verifierRetryPolicy` (semver consideration)
- Stale verifier retry-budget comment in runner.ts removed

### Clean ablation re-run complete (task b36gfxia2) ✅

5 tasks × 3 models × 2 variants = 30 dispatches. Fixed judge (system prompt + JSON extraction). Verdict: **INCONCLUSIVE** — no pre-stated rule fires at ≥2/3 model threshold. REWORK stands (no reversion warranted). gpt-4o-mini reversal (+5pp ra-full, +15% tokens) is the one KEEP-qualifying signal — worth monitoring post-v0.11. **Issue #6 closed.**

---

## Previous Session (2026-05-12, afternoon)

### M3 Verifier Ablation — Complete ✅

**Verdict: 🔄 REWORK** — disable terminal retry loop; retain heuristic gate.

| Model | ra-full acc | noop acc | Δ | ra-full tokens | noop tokens |
|---|---|---|---|---|---|
| qwen3:14b | 10% | 11% | noop +1pp | 101,795 | 96,596 |
| cogito:14b | 17% | 18% | noop +1pp | 112,962 | 120,215 |
| gpt-4o-mini | 8% | 7% | ra-full +1pp | 162,955 | 176,675 |
| **All** | **12%** | **12%** | **0pp** | | |

Pre-stated REWORK rule fires (≥2/3 models noop ≥ ra-full). Token overhead absent or negative. Retry loop is not converting guard detections into accuracy improvements. Evidence: `wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md`.

**Caveat:** 84% judge parse failure rate — margins are within noise. Verdict provisional until judge upgraded to structured output (JSON schema via tool-use).

**Next M3 action:** Disable retry at `runner.ts:568` (0.5 day). Separate: cogito FM-A1 retry prompt tuning (Issue #3) is unrelated — still open.

### Other fixes shipped (2026-05-12)
- `fix(judge-server): extract JSON from LLM response before parsing` (`989bee1a`)
- Strategy switching now **on by default** (`enableStrategySwitching !== false`)
- Issues log updated: #1/#2 closed, #5 split, #7 (Pruning Principle gap) added
- `test.ts` moved to `examples/spot-test.ts`

---

## Previous Session (2026-05-11)

### Harness Research Integration — Three Papers Verified ✅

Four March 2026 papers reviewed; all quantitative claims verified against primary sources before any changes were made.

| Finding | Source | Impact |
|---|---|---|
| Verifier gates net-negative: -0.8pp SWE, -8.4pp OSWorld | Tsinghua NLAH (arXiv:2603.25723) | M3 ablation-gated in Phase 1.5 roadmap; kernel heuristic verifier already correct (finding applies to LLM-as-judge, not our guard) |
| Self-evolution most consistent positive module: +4.8pp SWE, +2.7pp OSWorld | Same | M14 added to Phase 1.5 as Compose API hook |
| File-backed state also positive: +1.6pp SWE, +5.5pp OSWorld | Same | Confirms SQLite session history (gateway-chat) was correct |
| Adding full harness costs 13.6× tokens and is 0.8pp *worse* | Same | Pruning Principle added to North Star §9 |
| Raw traces essential: 50% → 34.6% accuracy without them | Stanford Meta-Harness (arXiv:2603.28052) | `@reactive-agents/trace` + Snapshot/Replay are critical path |
| Harness transfers across 5 models (+4.7pp avg) | Same | Strengthens M7 calibration consumer priority |

### North Star v5.0 Promoted ✅

Canonical doc: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`
Design spec: `wiki/Architecture/Design-Specs/2026-05-11-harness-research-integration.md`

### v0.10.6 Shipped ✅

All packages on npm. All P1 issues resolved.

---

## What's Next

### Pre-Phase-B Gate: M3 Ablation (1 day)

Run the M3 ablation before starting Compose API Wave A. Temporarily pass a `noopVerifier` via `KernelInput.verifier` in a dev test harness, run gate corpus (20+ tasks), measure accuracy delta. Note: the NLAH finding is for LLM-as-judge gates; our `defaultVerifier` is a heuristic guard — ablation determines whether the same pattern holds here. Result informs Phase 1.5 M3 priority.

### Immediate: Phase B — Compose API Wave A

**Start with Wave A** — `harness-pipeline.ts` registry + resolver, generated tag catalog, `TagMap`/`PayloadFor`/`ContextFor`, and `.compose()` on the builder.

**Why first:** Phase A W23/W24/W25 decomposed the runtime enough for clean injection points. Compose API is the v0.11 differentiator and critical path.

Before implementation, decide how to handle the existing `runtime/src/compose.ts` functional composition API so naming does not collide with harness composition.

### Parallel: Phase 1.5

M3/M6/M7/M8/M10 can run concurrently with Phase A — different files, no conflicts.

---

## Authoritative Document Hierarchy

| Order | Doc | What it tells you |
|---|---|---|
| 1 | `00-VISION.md` | Eight pillars. Stable anchor — never amended. |
| 2 | **`05-DESIGN-NORTH-STAR.md` v4.0** | **Architecture + full forward plan (Phases A–G). Read this.** |
| 3 | `01-RESEARCH-DISCIPLINE.md` | 12 rules for any harness change |
| 4 | `02-FAILURE-MODES.md` | Failure mode catalog |
| 5 | `03-IMPROVEMENT-PIPELINE.md` | How discoveries flow into harness changes |
| 6 | `04-PROJECT-STATE.md` | Cold session framing |
| — | `2026-05-06-compose-harness-api.md` | Compose API design spec (Phase B detail) |
| — | `2026-05-06-v0.11-launch-readiness.md` | v0.11 tactical rollout (Phase C detail) |

---

## Key Decisions (May 7, 2026)

1. **North Star v4.0 is the single forward-planning document** — no more sprawl across roadmap + improvement roadmap + launch checklist
2. **Phase A (decomposition) before Compose API** — bolting new API onto 6K-line builder creates debt in every subsequent wave
3. **Snapshot/Replay promoted to v0.11 (Phase C)** — unique auditable-by-demo capability, 1-week build on existing `packages/trace`
4. **`04-PROJECT-STATE.md` retained** — different framing purpose from §2 of North Star
5. **Root `ROADMAP.md` alignment is a Phase C gate** — public roadmap must match this plan before v0.11.0 ships

---

## How to Update This Note

At session end: replace "Latest Session" with new date + key updates, update "What's Next," add decisions. Keep it under 120 lines.

**Last Updated:** 2026-05-12
**Current Phase:** B (Compose API) — Wave A next; M3 ablation gate cleared
**Next Review:** After Compose API Wave A lands
