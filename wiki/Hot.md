---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-07-01
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-07-01) — comprehensive framework review + v0.13 lift plan

**v0.12.0 "Durable & Honest" is RELEASED** — all 35 pkgs on npm since 2026-06-17, GH release live. Durable execution A–D + durable HITL + **durable Phase E (Cortex UI) all SHIPPED and live-verified end-to-end** (pause → `listPendingApprovals` → approve → resume → clear; `.withDurableRuns`/`.withApprovalPolicy` wired in Cortex on both saved-agent and inline paths). Memory default-OFF, Effect-free hooks, and typed structured output (`.withOutputSchema`→`result.object`, `.streamObject()`) all shipped. External channels package (`@reactive-agents/channels`) merged to `main`.

**This session's work — 2026-07-01 comprehensive review:**
- 4 parallel read-only audits (arch health, docs accuracy, DX/simplification, plans triage) + **5 live "first-touch" probe agents** built and run against real providers (claude-haiku-4-5 cloud, qwen3:14b + gemma4:e4b local Ollama) by an agent that had never used the framework. Full report: [`wiki/Research/Audit-Reports-2026-07-01/comprehensive-framework-review-and-v13-north-star.md`](wiki/Research/Audit-Reports-2026-07-01/comprehensive-framework-review-and-v13-north-star.md).
- **Headline: the cross-tier promise is real** — a cold external tester reproduced the README core claim (identical correct typed `.withOutputSchema` object on a 4B local model, gemma4:e4b) without help. That is the launch asset. First-10-minutes DX papercuts catalogued.
- v0.13 execution plan authored: [`wiki/Planning/Implementation-Plans/2026-07-01-v13-lift-execution.md`](wiki/Planning/Implementation-Plans/2026-07-01-v13-lift-execution.md) — subagent-parallel, package-isolated bundles; **DX wave ships _before_ Show-HN**. North star holds: harness = product, receipts = proof, first-touch DX = funnel.

**⚠️ Outstanding action (now larger): local `main` is 98 commits ahead of `origin` and has NEVER been pushed.** Push syncs the entire v0.12 line (durable exec + HITL + Cortex Phase E + docs overhaul + channels) and closes stale-branch bookkeeping on origin.

---

## Prior Sessions (compact pointers)

- **2026-06-16** — v0.12 pre-release reconcile: PR #194 closed (its commits already in local `main`; branch went stale), v0.12 issue triage (slipped #188/#47/#35 → v0.13, #43 → v0.14), #195 closed (code-action field-drop matrix — `observation.tool-result` per sandbox tool call), ROADMAP v0.12 table refreshed. Durable A–D + HITL confirmed landed on `main`.
- **2026-06-10** — v0.11.2 RELEASED to npm (35 pkgs lockstep); roadmap realigned + ratified (v0.12 "Durable & Honest" → v0.13 "Receipts" **launch** → v0.14 "Compounding" → v1.0, `wiki/Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0.md`); v0.12.0 leverage audit; durable-execution Phase A shipped (`onCheckpoint` seam + versioned `kernel-codec.ts`).
- **2026-06-08** — model-support refresh (#193) + cortex parameterized-runs Phase 1 (both now released in 0.11.2).
- **2026-06-02→05** — canonical sprint2 (PRs #180-#183 merged), observability sprint (6 levers falsified — see memory, do not resurface), heavy-strategy parity finding (reflexion fix `660c4856`), backlog honesty cluster (PRs #185-#192).
- **2026-05-23→25** — Harness Convergence Phase 0 (5 P0s), 22 GH issues #104-#125, execute-backlog bundles. Full detail in git history of this file (`git log -- wiki/Hot.md`).

## What's Next

1. **Push `main` to origin** (98 commits unpushed) — syncs the whole v0.12 line (durable exec + HITL + Cortex Phase E + docs overhaul + channels).
2. **Execute the v0.13 lift plan** ([`wiki/Planning/Implementation-Plans/2026-07-01-v13-lift-execution.md`](wiki/Planning/Implementation-Plans/2026-07-01-v13-lift-execution.md)) — DX wave (first-touch papercuts from the 2026-07-01 audit) ships *before* Show-HN, then public local-model bench receipts.
3. **Cut v0.13** — bump VERSION, `bun run release:dry` (sole drift gate), tag-driven publish.
4. **Stale-doc cleanup:** update `wiki/Issues/Running Issues Log.md` (HS-34/HS-35 → cleared).

## Authoritative Document Hierarchy

| Order | Doc | What it tells you |
|---|---|---|
| 1 | `wiki/Research/Audit-Reports-2026-07-01/comprehensive-framework-review-and-v13-north-star.md` | Current framework review + v0.13 north star |
| 2 | `wiki/Planning/Implementation-Plans/2026-07-01-v13-lift-execution.md` | Active v0.13 execution plan |
| 3 | `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` v5.0 | Architecture target |
| 4 | `wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md` | 12 rules for harness changes |
| 5 | `.agents/MEMORY.md` | Cross-agent session memory |

## How to Update This Note

At session end: replace "Latest Session" with new date + key updates, demote prior to one-line pointers, update "What's Next." Keep under 120 lines.

**Last Updated:** 2026-07-01
**Current Phase:** v0.13 "Receipts" — DX wave + public local-model bench (launch line)
