---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-11-05
---

# Hot (Recent Context Cache)

**Purpose:** last-session state. Read first. ≤500 words. Older entries live in `wiki/Log.md` and the plan/audit files linked below.

---

## 2026-11-05 — Plan 9: substrate done, run isolation, switching opt-in

- Every strategy runs on the strategy-run substrate (Plan 9 Phase 1). Full H3 56→62/120. Plan: `wiki/Planning/Implementation-Plans/2026-11-04-architecture-convergence-program.md`.
- **Run state is per run or per agent, never module-level.** Meta-tool stores (`withRunToolStores`), `_tool_result_N` keys, the document store (per agent; share via `.withDocuments(docs, { store })`), the file root (FiberRef, fixes a sandbox write escape) and the trace dir all moved off process globals.
- **Strategy switching is opt-in** (`enableStrategySwitching: true`): ablation found no lift at +28% billed tokens (`wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md`). Redesign = Plan 9 item 2g.
- `tokensUsed`/`cost` now come from the run spend meter (every call, sub-agents folded once). A switch keeps prior spend.
- Embedded prose tool calls now execute (end_turn fast path fixed); users set risk levels with `.withTools({ riskLevels })`.
- Spec 09 §2: modality-neutral core is a program invariant.
- Before pushing a default change run `bun run gate:check` (North Star gate runs only inside `bun test` in CI).

---

## 2026-11-05 — Wardens: plugin, one-file team, warn mode

- The warden system is now the `wardens` Claude Code plugin (github.com/tylerjrbuell/wardens, private for now), enabled in `.claude/settings.json`.
- The team is **one file: `.claude/wardens.yaml`** (kind, `run` allowlist, `mode: warn`). Owned paths stay in `tools/repo/ownership.json`. Agent files are prompts only; `.wardens/` is the gitignored ledger.
- Hooks check briefs, warden tool calls and reports. They only record for now (`warn`). `git stash/clean/restore` and commit/push are blocked for every warden.
- Change authority in `wardens.yaml`/`ownership.json`, never in an agent file. `warden team`, `warden doctor` (`check-wardens` in CI).
- Decision + open items: `wiki/Decisions/2026-11-05-wardens-one-file-hook-enforced.md`.

---

## 2026-11-03 — Repo tool + declutter executed (outcome verification pending)

- `bun run repo <cmd>` exists (`tools/repo/`): `status`, `scope`, `check [--all]`, `test`, `verify`, `ratchet`, `find`, `outline`, `place`, `session-stats`, `warden-report`. Run `bun run repo help`; start with `bun run repo status`.
- Hooks (Claude Code `PreToolUse`): deny piped `bun test`, scripted edits, recursive shell grep; `Write` checks file placement (`tools/repo/placement.json`). Some rules ship as `warn`. Escapes: `REPO_ALLOW=<id> REPO_ALLOW_REASON=...`, `REPO_HOOKS=off`, `git commit --no-verify`. Hooks fail open.
- Pre-commit runs fast scoped checks (`repo check --changed --stage pre-commit`); CI runs `repo check --all` once.
- `AGENTS.md` is now a short contract; detail moved to `wiki/Development/Agents-Extended-Reference.md`. `scripts/` holds runnable scripts only.
- Both `as unknown as` ceiling failures were fixed with typed test builders; ceilings only ratchet down.
- Plan: `wiki/Planning/Implementation-Plans/2026-11-03-dev-tool-determinism-and-declutter.md` (execution log at the end). The plan is not `completed` until `repo session-stats --since <ISO>` meets its thresholds over at least 3 sessions.
- Plan 8 (harness convergence) was not touched by this work.

---


## Standing traps

- **Stale dist:** `bun rax cortex` loads `apps/cortex/dist`. Run `bun run build:apps` after source changes, or use dev mode (`bun start`).
- **Canonical sources:** sequencing `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`; debt `wiki/Architecture/DEBT-REGISTER.md`; agent rules `AGENTS.md`; memory index `.agents/MEMORY.md`.
