---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-06-10
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-06-10) — v0.11.2 RELEASED + v0.12.0 strategy locked + durable-exec Phase A

**v0.11.2 published to npm** (35 pkgs lockstep, GH release live, `VERSION=0.11.2`) — beat the June-15 `claude-sonnet-4-20250514` retirement by 4 days.
- Release journey: CI attempt 1 failed on `debrief.test.ts:254` 5s-timeout flake (now pinned at 30s, `2a60554e`); attempt 2 npm E401 — `NPM_TOKEN` expired, user rotated. Consider OIDC trusted publishing for 0.12.0 (requires `npm publish` instead of `bun publish` in release.ts + per-package npmjs config).
- Pre-release sweep caught: residual retired-model fallbacks in `createRuntime`/`createLightRuntime` (fixed `46251613` + guard test pinning every `claude-*` literal to the capability table), 20 retired ids in 13 published READMEs, 7 stale v0.11.0-era changesets that would have produced wrong release notes.
- **Changeset coverage gap closed:** span v0.11.1→v0.11.2 was 622 commits with ONE changeset; 7 themed notes authored (ancestry-verified) before tagging. **Lesson: changeset discipline at merge time, not release time.**
- **publish.yml sync-back fixed** (`4bcd5cc5`): now commits VERSION + CHANGELOG + consumed-changeset deletions to main (previously only VERSION — consumed notes lingered and re-aggregated).

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

1. **Durable execution Phase B** — RunStore + `.withDurableRuns()` via runtime-warden on `feat/durable-execution`; then Phase C resume(), Phase D durable HITL, Phase E cortex UI (spec §4).
2. **Docs-sync PR #194** — review/merge (0.12.0 API surface).
3. **Team-ownership pilot evaluation 2026-06-15** — ablation-warden applies lift rule; ~10 logged tasks in pilot log.
4. v0.12.0 lever stack after durable-exec: DX wave → bench receipts → cost honesty → strategy honesty (audit doc has the ranked table).

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
