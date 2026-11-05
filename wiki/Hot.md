---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-11-05
---

# Hot (Recent Context Cache)

**Purpose:** last-session state. Read first. ≤500 words. Older entries live in `wiki/Log.md` and the plan/audit files linked below.

---

## 2026-11-05 (late) — Plan 9 Phase 1 CLOSED, run scope, Phase 2 started

- Fable post-review at `2a2d184f9`: Phase 1 **CLOSED**. One ledger source per run, one run-wide `state.evidence` (`ToolEvidence`), one required `StrategyTerminalInput` (`FinalizeExtras` gone), honest-partial cases are conformance cells C6-C9.
- **Run scope (1R):** all per-run state is one slot map on one FiberRef (`@reactive-agents/core/internal/run-scope`), opened once by `startRun` (runtime) or `ensureRunScope`; sub-agents nest with `childRunScope`. `scripts/check-run-scope.sh` (CI) bans new run FiberRefs; replay fails on any slot read outside a run. Budget refs still FiberRefs (task #22).
- H3 baseline at `a698ff4cb`: 64/120; raw = billed = trace sum. Its 3 harness defects + 2 found while fixing are fixed. One failure taxonomy: unattributed real failures 95→22/97 (`packages/trace/src/taxonomy.ts`).
- Next (Plan 9 Advisor record items 8-10): evidence family over `state.evidence` → one assessment per pass after act → 2b (model "done" = `ExitProposal`, gate handoff is the only post-loop synthesis) → 2e; 2d in parallel; then re-measure H3.

## 2026-11-05 — Plan 9: substrate done, run isolation, switching opt-in

- Every strategy runs on the strategy-run substrate (Plan 9 Phase 1). Full H3 56→62/120. Plan: `wiki/Planning/Implementation-Plans/2026-11-04-architecture-convergence-program.md`.
- **Run state is per run or per agent, never module-level.** Meta-tool stores, `_tool_result_N` keys, the document store (per agent; share via `.withDocuments(docs, { store })`), the file root and the trace dir all moved off process globals (now run slots, see above).
- **Strategy switching is opt-in** (`enableStrategySwitching: true`): ablation found no lift at +28% billed tokens (`wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md`). Redesign = Plan 9 item 2g.
- `tokensUsed`/`cost` come from the run spend meter; the background debrief is attributed to the run but reported separately (`debriefRich()`).
- Before pushing a default change run `bun run gate:check`. Repo tool: `bun run repo help` (plan `2026-11-03-dev-tool-determinism-and-declutter.md`).

---

## 2026-11-05 — Wardens: plugin, one-file team, warn mode

- The warden system is now the `wardens` Claude Code plugin (github.com/tylerjrbuell/wardens, private for now), enabled in `.claude/settings.json`.
- The team is **one file: `.claude/wardens.yaml`** (kind, `run` allowlist, `mode: warn`). Owned paths stay in `tools/repo/ownership.json`. Agent files are prompts only; `.wardens/` is the gitignored ledger.
- Hooks check briefs, warden tool calls and reports. They only record for now (`warn`). `git stash/clean/restore` and commit/push are blocked for every warden.
- Change authority in `wardens.yaml`/`ownership.json`, never in an agent file. `warden team`, `warden doctor` (`check-wardens` in CI).
- Decision + open items: `wiki/Decisions/2026-11-05-wardens-one-file-hook-enforced.md`.

---


## Standing traps

- **Stale dist:** `bun rax cortex` loads `apps/cortex/dist`. Run `bun run build:apps` after source changes, or use dev mode (`bun start`).
- **Canonical sources:** sequencing `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`; debt `wiki/Architecture/DEBT-REGISTER.md`; agent rules `AGENTS.md`; memory index `.agents/MEMORY.md`.
