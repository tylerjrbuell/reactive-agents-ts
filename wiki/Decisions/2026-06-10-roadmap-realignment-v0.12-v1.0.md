---
type: decision
status: accepted
created: 2026-06-10
tags: [roadmap, v0.12.0, v0.13.0, v0.14.0, v1.0, strategy, launch]
---

# Decision: Roadmap realignment v0.12 → v1.0 (2026-06-10)

## Context

Three roadmap-bearing documents drifted from reality and from new evidence:

- Root `ROADMAP.md` (2026-05-14) still described v0.10.6 as current, a June-2026 Show-HN at v0.11 (never happened), and a v0.12 centered on code-as-action (shipped in v0.11).
- `07-ROADMAP-v1.0.md` (2026-05-03) — phases 0–2 done, 3 shipped-unvalidated, 4 ~70% absorbed by other work, 6 done; **Phase 5 (public benchmark) is the unexecuted keystone**.
- North Star v5.0 (2026-05-11) predates three decisive facts.

The three facts (all post-May-11 evidence):

1. **Durable execution became 2026 table stakes** (LangGraph checkpoints, Pydantic-AI+Temporal, OpenAI SDK, Vercel Workflow DevKit) — RA has primitives but no story; evaluators filter on it before differentiators are considered.
2. **Our own data killed strategy-count as the story** — heavy strategies show parity with reactive at 3–15× local cost (2026-06-05); the real, externally-demanded differentiator is local-model *reliability* (calibration + healing + tier-context), which no competitor has.
3. **Mastra proved DX-polish wins TS mindshare** (1.0, 300k weekly downloads); RA's 77-method builder + Effect leakage is the adoption blocker.

Full analysis: `wiki/Research/Audit-Reports-2026-06-10/v0.12.0-leverage-audit.md` (3-agent sweep: mechanism census, DX audit, competitive landscape with citations).

## Decision (user-ratified 2026-06-10)

**The vision (`00-VISION.md`, 8 pillars) is NOT amended** — the competitive audit independently validated its problem list. What changes is execution sequencing:

| Milestone | Theme | Contents |
|---|---|---|
| **v0.12 — "Durable & Honest"** | Table stakes + surface | Durable execution (crash-resume, durable HITL via RunStore + `.withDurableRuns()` + `resume(runId)`); **memory default OFF** (breaking-ish — bundled with all surface changes so users absorb ONE migration); DX wave (Effect-free hooks, builder consolidation 77→grouped facades, observability 5-methods→1, plain-Error boundary); harness cost honesty (tier-aware debrief synthesis, meta-tool prompt audit); strategy-surface honesty (adaptive routes to reactive on local tier by default; heavy strategies documented as frontier/niche). |
| **v0.13 — "Receipts"** | Evidence + launch | Public reproducible local-model bench — same suite, qwen/llama 7–14B via Ollama, RA vs Mastra vs LangGraph.js vs raw AI SDK, first-attempt success + tokens (executes old Phase 5/F with competitive teeth). Flight-recorder productization (replay + rax-diagnose as README headline, positioned vs the LangSmith funnel). OIDC trusted publishing. **Show-HN launch happens HERE, with receipts** — not at v0.12. |
| **v0.14 — "Compounding"** | Research bet | Recitation + experience-reuse (the capability axis, audit grade D) behind ablation gates — sequenced after v0.13 so lift is *measured on the public bench* (≥3pp rule), making results publishable rather than anecdotal. |
| **v1.0** | Polish | Old Phase G/7 unchanged: every gate re-run, pillar artifact table complete, README states only validated claims. |

### Ratified forks

1. **Launch timing: v0.13, with receipts.** Launching at v0.12 reads as another generic TS framework next to Mastra; the differentiated claim needs its evidence first.
2. **DX wave ships inside v0.12** alongside durable execution (different files, parallelizable; one migration event).
3. **Compounding axis at v0.14**, not parallel-now and not cut.

## What this supersedes

- Root `ROADMAP.md` v0.12/v0.13 sections (rewritten same day).
- `07-ROADMAP-v1.0.md` phase sequencing for remaining work (amendment log entry added; phases 5/7 retained as v0.13/v1.0 content; Phase 4 residue folds into v0.12 honesty items).
- The June-2026 Show-HN target from North Star v5.0 Phase C framing.

## What this does NOT change

- The 8 pillars, anti-pillar doctrine, Pillar-1 control triad, research discipline rules.
- Anti-scaffold §9, ablation lift rule (≥3pp / ≤15% tokens), falsified-lever blacklist.
- Tag-driven lockstep release flow.

## Evidence anchors

- `wiki/Research/Audit-Reports-2026-06-10/v0.12.0-leverage-audit.md`
- `wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md` (v0.12 track 1, Phase A shipped `b901e9f6`)
- `wiki/Research/Audit-Reports-2026-06-02/architecture-health-audit.md` (structure A−, capability axis D)
- Heavy-strategy parity: memory `project_heavy_strategy_improvement_2026_06_05`
- Competitive citations: in the leverage audit (Mastra 1.0, LangSmith backlash, durable-exec wave, CrewAI cost incidents)
