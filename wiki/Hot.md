---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-06-16
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-06-16) — v0.12 pre-release reconcile: #194 closed, issues triaged, ROADMAP refreshed

**v0.12 is mid-flight on `main` (VERSION still 0.11.2).** Most of the milestone has already landed since the 2026-06-10 plan:
- **Durable execution A–D + durable HITL** all merged to `main` (NOT a separate branch — `feat/durable-hitl-2026-06-16` work landed directly: `7cec56c7` run()-path HITL, `42f6970e` PAUSED-state checkpoint, `918d73b6` strategy threading, docs sweep `7819d5a7`). `.withDurableRuns()`/`resumeRun()`/`.withApprovalPolicy`/`approveRun`/`denyRun`/`listPendingApprovals` live on both run() and runStream(). Phase E (Cortex UI) is the only durable piece left.
- **Memory default-OFF** shipped (builder.ts `_enableMemory=false`; `balanced()`/`intelligent()` opt in).
- **Effect-free hooks** shipped (`.withHook()` plain fns).
- **Typed structured output** merged (`.withOutputSchema`→`result.object`, `streamObject()`).
- Health-sweep debt HS-34/HS-35 CLEARED 2026-06-16; both governance ceilings green.

**This session's work:**
1. **PR #194 closed (NOT merged, NOT pushed).** Its commits (`abfabc93`, `a7bf8bc6`, merge `3e808cb7`) are already in local `main`; the branch went stale (−1916 docs lines that landed after) so merging would regress live docs. Closed with a reconcile comment; will land on origin with the next `main` push.
2. **v0.12 issue triage (milestone #6):** KEEP `#195` (P1 strategy-honesty — core hook/killswitch/calibration threading already fixed across 4 heavy strategies; narrowed to the `tool_call` batch-emit sub-gap). SLIPPED `#188`→v0.13 (AgentStreamEvent re-export arch-debt), `#47`→v0.13 (tool-result paging feature), `#35`→v0.13 (code-action runPromise bug, experimental-scope), `#43`→v0.14 (memory multi-session — conflicts with memory-default-OFF). Each got a triage comment.
3. **ROADMAP.md v0.12 table refreshed** — status column now reflects shipped vs remaining (was all "Planned").

**⚠️ The real outstanding action: local `main` is ~50 commits ahead of origin and has NEVER been pushed.** Push syncs durable-exec + docs overhaul + HITL and auto-confirms #194's closure on origin.

**Stale-doc note:** `wiki/Issues/Running Issues Log.md` still lists HS-34/HS-35 as open-FILE (they're cleared) — not yet updated this session.

---

## Prior Session (2026-06-10) — v0.11.2 RELEASED + v0.12.0 strategy locked + durable-exec Phase A

**v0.11.2 published to npm** (35 pkgs lockstep, GH release live, `VERSION=0.11.2`) — beat the June-15 `claude-sonnet-4-20250514` retirement by 4 days.
- Release journey: CI attempt 1 failed on `debrief.test.ts:254` 5s-timeout flake (now pinned at 30s, `2a60554e`); attempt 2 npm E401 — `NPM_TOKEN` expired, user rotated. Consider OIDC trusted publishing for 0.12.0 (requires `npm publish` instead of `bun publish` in release.ts + per-package npmjs config).
- Pre-release sweep caught: residual retired-model fallbacks in `createRuntime`/`createLightRuntime` (fixed `46251613` + guard test pinning every `claude-*` literal to the capability table), 20 retired ids in 13 published READMEs, 7 stale v0.11.0-era changesets that would have produced wrong release notes.
- **Changeset coverage gap closed:** span v0.11.1→v0.11.2 was 622 commits with ONE changeset; 7 themed notes authored (ancestry-verified) before tagging. **Lesson: changeset discipline at merge time, not release time.**
- **publish.yml sync-back fixed** (`4bcd5cc5`): now commits VERSION + CHANGELOG + consumed-changeset deletions to main (previously only VERSION — consumed notes lingered and re-aggregated).

**Roadmap realigned + ratified** — `wiki/Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0.md`: v0.12 "Durable & Honest" → v0.13 "Receipts" (**launch here**, public local-model bench) → v0.14 "Compounding" → v1.0. Root ROADMAP.md rewritten; 07-ROADMAP amendment logged; vision pillars unchanged.

**v0.12.0 strategy locked** — full audit: `wiki/Research/Audit-Reports-2026-06-10/v0.12.0-leverage-audit.md` (3-agent sweep: mechanism census, DX audit, competitive landscape).
- Verdict: structure healthy (A−); leverage = identity not architecture. Differentiators already built but buried: (1) local-model reliability, (2) local-first deterministic replay + rax-diagnose. Table-stakes gap: **durable execution**.
- User decisions: durable-execution = first 0.12.0 track; **memory default OFF in 0.12.0**; then DX wave (Effect-free hooks, 77 builder methods → facades), local-model bench receipts, tier-aware debrief, strategy-surface honesty.

**Durable execution Phase A SHIPPED** on `feat/durable-execution` (`b901e9f6`), design spec `wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md`:
- `RunControllerLike.onCheckpoint?(state, iteration)` seam at iteration boundary (zero-cost when absent, throw-safe) + versioned `kernel-codec.ts` (lossless Map/Set/Date, meta WARN-skip). 12/12 new tests, reasoning 1620/0.
- Phase B next: RunStore (SQLite) + `.withDurableRuns()` + checkpoint writes (runtime-warden). Phase B should also consolidate the pre-existing LOSSY `serializeKernelState` pair at `kernel-state.ts:856/886` (zero callers).

**Cleanup pass (2026-06-10):**
- Track A cortex "dangling fixes" scare RESOLVED: `a7a35216`/`b6f05d67` were pre-rebase duplicates — fixes live on main as `88ae945c` + `a66e4069` (cherry-pick verified empty). Rescue branches deleted.
- Branches deleted (verified merged): `feat/cortex-parameterized-runs`, `worktree-provider-models` (local+remote), `feat/cortex-dynamic-models`, `feat/cortex-rich-trace-timeline-2026-06-06`. Kept: `worktree-docs-sync-0.12.0` (open PR #194), `feat/durable-execution`.
- Memory pruned both files (stale unmerged/pending claims flipped; index back under size limit).

## Prior Sessions (compact pointers)

- **2026-06-08** — model-support refresh (#193) + cortex parameterized-runs Phase 1 (both now released in 0.11.2). Docs-sync PR #194 still OPEN.
- **2026-06-02→05** — canonical sprint2 (PRs #180-#183 merged), observability sprint (6 levers falsified — see memory, do not resurface), heavy-strategy parity finding (reflexion fix `660c4856`), backlog honesty cluster (PRs #185-#192).
- **2026-05-23→25** — Harness Convergence Phase 0 (5 P0s), 22 GH issues #104-#125, execute-backlog bundles. Full detail in git history of this file (`git log -- wiki/Hot.md`).

## What's Next

1. **Push `main` to origin** (~50 commits unpushed) — confirms #194 closed, syncs durable-exec + HITL + docs overhaul.
2. **Finish v0.12 remaining levers:** `#195` `tool_call` batch-emit sub-gap; DX-wave builder consolidation (observability 5→1); cost-honesty full per-tier debrief policy; strategy-honesty adaptive-routing local-tier default; durable Phase E (Cortex UI).
3. **Cut v0.12.0** — bump VERSION, `bun run release:dry 0.12.0` (sole drift gate), tag-driven publish.
4. **Stale-doc cleanup:** update `wiki/Issues/Running Issues Log.md` (HS-34/HS-35 → cleared).
5. Team-ownership pilot window ended 2026-06-15 — ablation-warden lift-rule evaluation outstanding.

## Authoritative Document Hierarchy

| Order | Doc | What it tells you |
|---|---|---|
| 1 | `wiki/Research/Audit-Reports-2026-06-10/v0.12.0-leverage-audit.md` | v0.12.0 direction + ranked levers |
| 2 | `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` v5.0 | Architecture target |
| 3 | `wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md` | Active track design |
| 4 | `wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md` | 12 rules for harness changes |
| 5 | `.agents/MEMORY.md` | Cross-agent session memory |

## How to Update This Note

At session end: replace "Latest Session" with new date + key updates, demote prior to one-line pointers, update "What's Next." Keep under 120 lines.

**Last Updated:** 2026-06-10
**Current Phase:** v0.12.0 — durable execution (track 1 of leverage audit)
