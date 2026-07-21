---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-07-12
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-07-12) — state-of-the-framework audit + doc-truth restoration

**Version: v0.14.0 (release-ready, tag OWNER-GATED)** as of 2026-07-21. `main` pushed (origin/main `8158c757`+). The debt burndown (Waves 0–5) closed the audit façade: tool-policy enforced on every strategy incl. code-action sandbox, abstention across all 8 strategies, sub-agent cancellation/recursion, trust receipt + process model shipped, ~9 lying withers removed/wired, orchestration+scenarios packages unpublished, CHANGELOG `[Unreleased]` complete. Docs fully synced to 0.14 (README/whats-new/ROADMAP/AGENTS/skills). Only remaining before cut: owner tags `v0.14.0` (retitle `[Unreleased]`→`## 0.14.0`) + optional bench re-baseline. Canonical debt state: `wiki/Architecture/DEBT-REGISTER.md`.

**Canonical snapshot (read this before any July plan/audit doc):**
[`wiki/Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md`](Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md) — full map of shipped vs open programs, the live built-never-wired register, the 226-commit process-failure analysis, corrective doctrine, and the deduped open-work list.

**July program status (detail + hashes in the snapshot):**
- ✅ SHIPPED: Arc 1 (`3c9c15fa`); adaptive-harness overhaul (Phase-6 gate unmet, ablation INCONCLUSIVE); meta-loop Waves A–G **in full** (07-08); strategy ledger/receipt truth; stream tool events + guard reachability; dual API (spec `a0eb5755`).
- ◐ PARTIAL: capability measurement (llm-judge→graded remainder); goal-reliability (open: #44 spine, #39 per-entity, #38 thought-continuity); root-cause closure (Tier 1–3 open list = canonical backlog); probe fleet QA (residue: success+empty-output, ToT cost floor, reflexion budget collision).
- ⬜ DRAFT: subagents-and-logging plan (07-11, awaiting RATIFY) — detached-dispatch boundary still broken (`spawn-handlers.ts:140,163`).

**New H-risk findings (2026-07-12 audit):** 3/7 provider-adapter hooks orphaned by APC deletion `279b61fb` (`taskFraming`/`toolGuidance`/`systemPromptPatch`, calibration writes nothing reads); CompletionEnvelope not consumed by blueprint + code-action; RA_RECITE ablation arms byte-identical (measures noise).

## What's Next

1. **v0.14 launch line** — cut v0.14, publish bench receipts (Arc 1 launch-gate item 5), Show-HN, push main. Overdue since Wave A/B boundary (07-08).
2. **Wire-or-delete sweep** — adapter hooks, CompletionEnvelope (blueprint/code-action), RA_RECITE session, ledger dead kinds, verifierTier, adaptive-plan fields.
3. **#39 per-entity requirements**, **#44 kernel→engine signal unification**, **#38 thought-continuity ablation** (Ollama `thinking` capture prereq).
4. RATIFY-or-reject subagents-and-logging DRAFT.
5. Bench P2 remainder (7 llm-judge → graded, re-baseline) + P3 `horizon:long` tasks; then #36 adaptive re-cut.
6. Small: `metrics-cache.json` 7190→7671 write-back (else next `metrics:sync-readme` regresses README); `.agents/MEMORY.md` 407KB archive split.

## Prior Sessions (compact pointers)

- **2026-07-05→12** — the harness root-cause fortnight: Arc 1, meta-loop, measurement rebuild, wiring audits ×4, probe fleet, receipt truth. Full map: the 07-12 snapshot above. Process lesson recorded there (§4): ~14% same-week rework, whack-a-mole before class-level prevention.
- **2026-07-02** — v0.13.0 RELEASED (35 pkgs); v0.13.5 + v0.13.6 followed 2026-07-05/06 (Groq+xAI, ui-core).
- **2026-07-01** — comprehensive framework review + v13 lift plan (superseded by 09-UNIFIED-PROGRAM).
- **Earlier** — see `git log -- wiki/Hot.md` and MEMORY-ARCHIVE.

## Authoritative Document Hierarchy

| Order | Doc | Role |
|---|---|---|
| 1 | `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` | Program sequencing + convergence rulings (CANONICAL) |
| 2 | `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` v6.0 | Product-arc content, exit gates, honest-claims law |
| 3 | `wiki/Architecture/Design-Specs/2026-07-11-harness-north-star-architecture.md` | Kernel architecture (RATIFIED 07-11) |
| 4 | `wiki/Planning/Implementation-Plans/2026-07-10-harness-root-cause-closure-program.md` | Ranked open backlog (active) |
| 5 | `wiki/Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md` | Current empirical state |

`04-PROJECT-STATE.md` is deprecated as the empirical-state read (banner added 07-12). Conflict rule: lower defers upward; changing a higher doc is a ratification event.

## How to Update This Note

At session end: replace "Latest Session" with new date + key updates, demote prior to one-line pointers, update "What's Next." Keep under 120 lines.

**Last Updated:** 2026-07-12
**Current Phase:** v0.14 launch line + wire-or-delete sweep (post root-cause fortnight)
