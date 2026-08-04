---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-07-28
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Active program (2026-07-28)

**A-TIER GAP CLOSURE** — [[Planning/Implementation-Plans/2026-07-28-a-tier-gap-closure]].
Supersedes the simplification program as the WIP=1 item; the simplification
program's motivating figure (555–640% harness overhead) was **retracted** on
2026-07-28 because the instrument was broken (`2f97ca1e`).

**Highest open defect:** [[Failure-Modes/RUNNING-CATALOGUE#F10]] — the request
prefix churns every iteration, so the prompt cache never hits. Lazy tool
disclosure saves 41% of tokens and costs 17% MORE money.

**Do not cite** any token-overhead figure predating `2f97ca1e`.

**Measurement ladder:** deterministic replay → haiku → fast non-reasoning local
tool-callers. Promotion requires rungs 2 and 3 to agree in sign.

**External gate:** τ-bench (ratified 2026-07-28).

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
