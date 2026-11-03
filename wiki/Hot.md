---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-11-03
---

# Hot (Recent Context Cache)

**Purpose:** last-session state. Read first. ≤500 words. Older entries live in `wiki/Log.md` and the plan/audit files linked below.

---

## 2026-11-03 — Repo efficiency pass (in progress)

- Goal: canonicalize agent context paths, shrink always-loaded context, remove stray root files.
- Done: this file rewritten to cap. `AGENTS.md` gained an agent-efficiency rules section.
- Blocked: deletion of stray root files (`scratch.ts`, `note.md`, `.claude/RESUME.md`, `tsconfig.tsbuildinfo`) and archiving of `.agents/MEMORY.md` sections (94 KB) were denied by the auto-mode classifier. Needs user go-ahead via a Bash permission rule or manual run.

---

## 2026-11-02 — Plans 5–8 landed; harness convergence plan written

- Shipped on `dev` since 10-29: run posture `plan` (kernel + runtime + Cortex `/plan`, `/go`), capability-from-reported-metadata, signalId + `wire-request` trace facts, K1 terminal-outcome reconcile + K3 strike carry, Cortex refresh-storm fix, todo dedupe.
- Live plan-posture probe: 0/12 non-plan tools; plan quality partial pre-rewording.
- Diagnosis: `wiki/Research/Audit-Reports-2026-11-02/`. Plan 8: `wiki/Planning/Implementation-Plans/2026-11-02-harness-convergence.md`. Harness is mis-wired (progress guards gated on `horizon`, pace tied to maxIterations), not simply rigid.
- In flight: outcome wiring (core + runtime), H1 wire corpus.
- Open: D3 inferred rows, K2, ablations, README metrics sync.

---

## 2026-10-29 (late) — Plan 4 goals/loops/polish: Waves A, B, D shipped; C1 browser pass BLOCKED

- Gates: `bun run build` exit 0; `bun test --timeout 15000` 11,399 pass / 30 skip / 4 todo / 1 fail. The 1 fail = pre-existing WS-5b `as unknown as` ceiling (90 sites vs ≤79).
- Shipped: `/goal` supervisor + Cortex goal service/routes/UI, `/loop` + `/schedule`, composer card.
- NOT verified: UI items in a browser (Playwright MCP profile locked by stale Chrome). Goal feature never run against a real model.
- Open: C1/D6 browser pass; `http-get` `headers` schema normalizer repair; DNS-rebinding on doc fetch; name-shape fallback in `makeRunTree` (legacy rows).

---

## 2026-10-29 — Cortex reliability, run visibility, checklist (Phase 1) shipped

- Shipped on `dev`: three plans (`wiki/Research/Audit-Reports-2026-10-29/plans-vs-shipped.md`). Browser record: `wiki/Research/Harness-Reports/2026-10-29-cortex-browser-verification.md`.
- Opt-in, not lift-measured: `.withMetaTools({ todo, todoGuidance })`. On `cogito:14b` n=1, to-do statuses did not move.
- Open: V5 guidance ablation verdict; conversation to-do dock at 420px not verified; TUI real-TTY check not done; D-2026-10-29-CHILD-COST (failed children's cost not rolled up, runtime-warden).

---

## Standing traps

- **Stale dist:** `bun rax cortex` loads `apps/cortex/dist`. Run `bun run build:apps` after source changes, or use dev mode (`bun start`).
- **Canonical sources:** sequencing `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`; debt `wiki/Architecture/DEBT-REGISTER.md`; agent rules `AGENTS.md`; memory index `.agents/MEMORY.md`.
