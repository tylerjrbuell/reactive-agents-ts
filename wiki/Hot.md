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

**🚀 v0.13.0 RELEASED 2026-07-02** — publish.yml green 10m12s, 35 pkgs on npm, GH Release live, CI sync-back `020c6360` pulled. Pre-tag work: gpt-5.x `max_completion_tokens` blocker fixed (`be0875cd`); 0.13.0 notes moved to changeset (`bce57a96` — release.ts only reads `.changeset/*.md`, hand-drafted CHANGELOG section was dead); docs gaps closed (`46e6c28a`: withLlmTimeout/.quick()/defineTool-v2/abstention + counts 6,854/851); pre-flight green (build 38/38, typecheck 69/69, keyless test 6854/0). Remaining launch line: competitive bench + cold first-touch probe vs published tarball → Show-HN.

---

## Prior Sessions (compact pointers)

- **2026-06-16** — v0.12 pre-release reconcile: PR #194 closed (its commits already in local `main`; branch went stale), v0.12 issue triage (slipped #188/#47/#35 → v0.13, #43 → v0.14), #195 closed (code-action field-drop matrix — `observation.tool-result` per sandbox tool call), ROADMAP v0.12 table refreshed. Durable A–D + HITL confirmed landed on `main`.
- **2026-06-10** — v0.11.2 RELEASED to npm (35 pkgs lockstep); roadmap realigned + ratified (v0.12 "Durable & Honest" → v0.13 "Receipts" **launch** → v0.14 "Compounding" → v1.0, `wiki/Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0.md`); v0.12.0 leverage audit; durable-execution Phase A shipped (`onCheckpoint` seam + versioned `kernel-codec.ts`).
- **2026-06-08** — model-support refresh (#193) + cortex parameterized-runs Phase 1 (both now released in 0.11.2).
- **2026-06-02→05** — canonical sprint2 (PRs #180-#183 merged), observability sprint (6 levers falsified — see memory, do not resurface), heavy-strategy parity finding (reflexion fix `660c4856`), backlog honesty cluster (PRs #185-#192).
- **2026-05-23→25** — Harness Convergence Phase 0 (5 P0s), 22 GH issues #104-#125, execute-backlog bundles. Full detail in git history of this file (`git log -- wiki/Hot.md`).

## What's Next

1. ~~Cut v0.13.0~~ ✅ RELEASED 2026-07-02.
2. **Competitive bench** (plan 2.2 Receipts deliverable, still missing) — RA vs Mastra vs LangGraph.js vs raw AI SDK, pinned models/seeds, published traces, run vs published 0.13 tarball. Current published bench = internal ablation only (+13pp).
3. **Cold first-touch re-verify** — re-run the 6 audit probes from OUTSIDE the repo against npm 0.13.0 (fail-fast build() now opt-in `.withStrictValidation()` — check missing-key DX) → Show-HN.
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
