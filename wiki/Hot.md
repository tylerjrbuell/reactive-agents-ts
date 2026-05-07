---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-05-07
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-05-07)

### North Star v4.0 — Consolidated Forward Plan ✅

**Single source of truth for all future work is now `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` v4.0.**

- `07-ROADMAP-v1.0.md` and `Phase 1.5 Improvement Roadmap.md` are superseded and marked accordingly
- `04-PROJECT-STATE.md` retained as separate cold-session framing doc
- Public `ROADMAP.md` (root) needs alignment — flagged as Phase C gate requirement

**Phase sequence (canonical — see North Star §6 for full gates):**

| Phase | Focus | Status |
|---|---|---|
| **A** | Architecture Cleanup: W23–W28 decomposition (`builder.ts` 6,082→≤500 LOC, `execution-engine.ts` 4,499→≤600 LOC) | **Next** |
| **1.5** | Mechanism Improvements: M3/M6/M7/M8/M10 IMPROVE→KEEP | Parallel with A |
| **B** | Compose API: Waves A–F, 24 injection points, 6 killswitches | v0.11 prereq |
| **C** | v0.11 Launch: playground, CLI generator, OTel, skill persistence, Snapshot/Replay | v0.11.0 |
| **D** | Code-as-Action Strategy: 6th reasoning strategy, local model gap | v0.12 |
| **E** | Local Model Engineering: calibration consumers, per-provider parser, paging | v0.12 |
| **F** | Public Benchmark Discipline: τ-bench / BFCL / HAL Princeton | v0.13 |
| **G** | v1.0 Polish & Release | v1.0 |

### v0.10.6 Shipped ✅

- All packages on npm
- All P1 issues resolved (frozen judge FIX-21, agent.run() confirmed, --help handlers wired, CJS shim)
- Layer 1 builders shipped: `buildFinalAnswerDescription` (commit 941bcb3a), `buildOracleNudge` (commit e72f50d3)
- Calibration profiles: cogito:14b, cogito:8b, gemma4:e4b, qwen3:14b all in `packages/llm-provider/src/calibrations/`

### Phase 1 Complete ✅ (8 KEEP + 5 IMPROVE)

All 13 mechanisms spike-validated. IMPROVE mechanisms targeted in Phase 1.5:
- **M3** Verifier+Retry — tune for cogito:14b (target: ≥50% recovery)
- **M6** Skill System — SQLite persistence (target: >70% cross-session recall)
- **M7** Calibration — ≥8 active field consumers (currently ~5)
- **M8** Sub-agent Delegation — real LLM metrics (target: ≥15% accuracy lift)
- **M10** Memory System — multi-session scenarios (target: >80% recall)

---

## What's Next

### Immediate: Phase A — Architecture Cleanup

**Start with Phase A W23** — decompose `execution-engine.ts` (4,499 LOC) into ≤9 phase modules.

**Why first:** Compose API (Phase B) bolts onto these files. Decomposing first prevents rework and makes every subsequent wave cleaner.

**W23 → W24 → W26 → W27 → W28** (sequential; each gate must pass before next wave).

Write tactical implementation plan at `wiki/Planning/Implementation-Plans/2026-05-07-phase-a-architecture-cleanup.md` before starting execution.

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

**Last Updated:** 2026-05-07 1:03pm EDT
**Current Phase:** A (Architecture Cleanup) — not yet started
**Next Review:** After Phase A W23 lands
