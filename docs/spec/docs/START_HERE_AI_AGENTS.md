# Start Here — AI Agents Working on Reactive Agents

> **Last updated:** 2026-04-28 (refactor/overhaul)
> **Audience:** Any AI agent (Claude Code, Copilot, Codex, etc.) opening this repo for the first time.
> **Purpose:** One page that tells you exactly what to read and in what order.

---

## The first read at session start

Read **`PROJECT-STATE.md`** first. It is the synthesis of where the project is empirically and methodologically — without forcing you to spelunk 30+ scattered docs.

If you only have time for one document, read that one.

---

## Are we mid-overhaul?

Yes — as of 2026-04-28, the project is on `refactor/overhaul` working toward a clean-break v0.10.0 release. The single source of truth for what's being audited, fixed, deleted, deferred, and shipped is:

**`AUDIT-overhaul-2026.md`** — 28 packages + 13 mechanisms + 44-item FIX backlog + 14-wave Stage-5 execution plan (W0-W13).

Read this before making any non-trivial change. Stage 5 is sequenced; jumping waves out of order will produce regression.

---

## The canonical doc hierarchy

Read in this order. Stop when you have what you need.

| Order | File | What it gives you |
|---|---|---|
| 1 | `PROJECT-STATE.md` | Current empirical state — what's validated, what's broken, what's unproven |
| 2 | `AUDIT-overhaul-2026.md` | The overhaul plan: per-package + per-mechanism verdicts; 44-item backlog; W0-W13 sequencing |
| 3 | `00-VISION.md` | What we're building toward — Reliability / Control / Security / Performance pillars |
| 4 | `15-design-north-star.md` v3.0 | Architecture target — 10 capabilities, kernel cognitive architecture, ports |
| 5 | `00-RESEARCH-DISCIPLINE.md` | The 12 rules governing every harness change — spike-validation, hypothesis-first, frozen judge, scope-of-claims |
| 6 | `01-FAILURE-MODES.md` | Catalog of harness failure modes with severity × prevalence × controllability |
| 7 | `02-IMPROVEMENT-PIPELINE.md` | Operational rhythm — DISCOVERY → CATALOG → PRIORITIZE → DISSECT → DESIGN → INTEGRATE+VALIDATE → DEPRECATE |

Everything else under `docs/spec/docs/_archive/` is pre-overhaul history. Do not treat archived docs as authoritative — they are kept for traceability, not guidance.

---

## Top-level repo docs

For repo-wide operational context (build commands, package map, quality gates):

- **`AGENTS.md`** (root) — canonical agent workflow, package matrix, quality gates
- **`README.md`** (root) — public product overview and quickstart
- **`CHANGELOG.md`** (root) — release-level history
- **`ROADMAP.md`** (root) — what shipped / what's deferred / what's in flight

---

## Memory artifacts

If you have access to persistent memory:

- **`.agents/MEMORY.md`** — in-repo project memory shared across all AI agents
- Personal memory — your tool's individual memory store. Cross-reference against `AUDIT-overhaul-2026.md §9.1` for entries known to be stale.

Reconciliation note: per audit §9.1, two prior memory entries are stale and need correction:
1. The "AgentEvents missing" claim — events DO exist; **3/6 RI hooks just lack subscribers**.
2. The "calibration default `:memory:`" claim — already corrected to `~/.reactive-agents/calibration.db` in code.

---

## What NOT to do

- **Do not read `_archive/` docs as architecture truth.** They predate the kernel refactor (Apr 3) and the v3.0 north star.
- **Do not deviate from `00-RESEARCH-DISCIPLINE.md` Rules 1-12.** Every harness change requires prior spike validation. Single-spike findings shape the next spike, not harness-level decisions (Rule 11).
- **Do not jump Stage-5 waves out of order** without consulting the user. W0 → W13 is sequenced so the test suite stays green at every commit.

---

*This file is the agent entry point. If you find it stale, you can update it directly — but keep it short.*
