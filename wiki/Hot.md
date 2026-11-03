---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-11-03
---

# Hot (Recent Context Cache)

**Purpose:** last-session state. Read first. ≤500 words. Older entries live in `wiki/Log.md` and the plan/audit files linked below.

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

## 2026-11-02 — Plans 5–8 landed; harness convergence plan written

- Shipped on `dev` since 10-29: run posture `plan` (kernel + runtime + Cortex `/plan`, `/go`), capability-from-reported-metadata, signalId + `wire-request` trace facts, K1 terminal-outcome reconcile + K3 strike carry, Cortex refresh-storm fix, todo dedupe.
- Diagnosis: `wiki/Research/Audit-Reports-2026-11-02/`. Plan 8: `wiki/Planning/Implementation-Plans/2026-11-02-harness-convergence.md`. Harness is mis-wired (progress guards gated on `horizon`, pace tied to maxIterations), not simply rigid.
- Open: D3 inferred rows, K2, ablations, README metrics sync.

---

## 2026-10-29 — Cortex goals/loops and checklist

- Shipped on `dev`: `/goal` supervisor, `/loop` + `/schedule`, run visibility, checklist (Phase 1). Records: `wiki/Research/Audit-Reports-2026-10-29/plans-vs-shipped.md`.
- NOT verified: UI items in a browser (C1/D6); goal feature never run against a real model. `.withMetaTools({ todo, todoGuidance })` is opt-in, not lift-measured.
- Open: V5 guidance ablation verdict; D-2026-10-29-CHILD-COST (failed children's cost not rolled up, runtime-warden).

---

## Standing traps

- **Stale dist:** `bun rax cortex` loads `apps/cortex/dist`. Run `bun run build:apps` after source changes, or use dev mode (`bun start`).
- **Canonical sources:** sequencing `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`; debt `wiki/Architecture/DEBT-REGISTER.md`; agent rules `AGENTS.md`; memory index `.agents/MEMORY.md`.
