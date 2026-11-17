---
type: research
status: active
created: 2026-11-16
tags: [ablation, plan-posture, planToolCatalog, planBudget, wrapUpReserve, planRecon, local-models, protocol]
---

# Plan-posture ablation campaign: protocol (written BEFORE any measured cell)

Warden: ablation-warden. Machine: RTX 4070 Ti SUPER 16 GB, Ollama localhost:11434. Window: 2026-11-16 23:20 to about 07:20.
Main tree HEAD `73b05b173` (dev) with 13 modified + new uncommitted files (the plan-producer substrate). The main tree is never edited, stashed or checked out. Substrate arm uses two detached worktrees (HEAD, and HEAD + a snapshot of the uncommitted diff). Not committed (brief: no commits; this protocol is hashed in `RUNLOG.md` instead).

## 1. Mechanisms and arms

Shared baseline arm **D** = current defaults (planToolCatalog on, planBudget on, wrapUpReserve off, planRecon off). One D arm serves as "on" for M1/M2 and "off" for M3/M4.

| Id | Mechanism | A (reference) | B (candidate) | Env var | Default today |
|---|---|---|---|---|---|
| M1 | planToolCatalog | D | `RA_PLAN_TOOL_CATALOG=0` | judged as: keep ON? | ON |
| M2 | planBudget | D | `RA_PLAN_BUDGET=0` | judged as: keep ON? | ON |
| M3 | wrapUpReserve | D | `RA_WRAPUP_RESERVE=1` | candidate for ON | OFF |
| M4 | planRecon | D | `RA_PLAN_RECON=1` | candidate for ON | OFF |
| M5 | execute levers (flaggable ones only) | D | `RA_BUDGET_ANSWER_TURN=1`, `RA_LEAN_THINKING=1` (one arm each) | candidate for ON | OFF |
| M6 | plan-producer substrate | worktree HEAD | worktree HEAD + uncommitted diff | n/a | not committed |
| M0 (optional, last) | plan posture itself | direct `agent.run(prompt)` | `agent.plan` then `agent.execute` | n/a | explicit API |

For M1/M2 the "mechanism" is the ON state. Lift of the mechanism = acc(D) - acc(off arm). The verdict asks "is the default-on justified".
M5 note: the other execute levers named in the brief (seeded-plan auto-tick on named-tool success, bookkeeping-iteration refund, commit `d2620792e`) have no flag in `harness-flags.ts`, so they cannot be ablated without a source edit. Reported as a follow-up for reasoning-warden, not measured.
M6 runs the strategy planners (`plan-execute-reflect`, `blueprint`) through `agent.run`, not the plan posture API, because the substrate lives there.

## 2. Tasks (deterministic in-process graders, no judge, offline fixtures)

Six multi-step tool tasks, all run as `agent.plan(prompt)` then `agent.execute(plan)` with `file-read` + `file-write` in a per-cell temp workspace (prompt carries absolute paths). Defined in `driver.ts` (copy kept in this dir as `driver.ts.txt`).

| Id | Shape | maxIterations | Why |
|---|---|---|---|
| pp-booking | Airbnb-style: read listings + fee rules, filter, pick cheapest, compute total, write booking.json | 10 | plan then execute shape |
| pp-coins | 4-coin multi-item: 4 price files + holdings, write portfolio.json with 4 values and total | 8 | multi-item |
| pp-recon | recon-needed: id of a named site is only in sites.json; stats live in stats/<id>.json | 10 | plan needs a read first |
| pp-inventory | 3 output files from one CSV (low-stock, totals, summary) | 10 | multi-file |
| pp-notes6 | six independent doubling items | 6 | tight budget: plan (>=6 steps) overflows maxIterations, so planBudget / wrapUpReserve can trigger |
| pp-merge | merge 3 JSON configs by precedence, write merged.json + changelog | 10 | multi-read, precedence |

Score per cell: `accuracy` = 1 iff every hidden check passes, else 0 (Bernoulli; also record fraction of checks passed). A plan that fails (`PlanNoStepsError`) or a cell that times out scores 0 but is flagged. Provider errors / no-trace cells are INCONCLUSIVE (excluded, counted).

## 3. Tiers and runs

- Tier small/mid: `qwen3:latest` (8.2B, thinking). Tier mid/large: `cogito:14b` (14.8B). Third tier `qwen3.5:latest` only if time remains.
- `qwen3:latest` is not in `STATIC_CAPABILITIES`: runs need `RA_BENCH_ALLOW_FALLBACK=1`-equivalent honesty check. The driver builds the agent directly (no bench preflight), so the pilot verifies from the trace that `llm-request` carries a real `numCtx` (not 2048) before any matrix cell.
- 6 tasks x 3 runs = 18 cells per arm per tier. `minRuns` = 3 per paired cell (task) is met by design.
- Cell timeout 170 s hard kill (AbortSignal). One process on the GPU at a time. Run-major order so a cut leaves balanced coverage; resume by cell id.

## 4. Metrics

Primary: accuracy (Bernoulli 0/1). Secondary: LLM calls (sum of `LLMRequestCompleted` over plan + execute), billed tokens (`billedTokens ?? tokensUsed`), wall time, iterations. Trigger rate: share of B-arm cells where the mechanism's trace signal fired (`plan-budget`, wrap-up reserve answer turn, plan recon findings, catalog line).

## 5. Decision rule (fixed now)

Per tier, with pA, pB the accuracies and n cells per arm: lift = pB - pA (pp); sigma = sqrt(pA(1-pA)/nA + pB(1-pB)/nB).
For M1 and M2 the roles swap (A = off arm, B = D); the question is whether the default holds.

- **REWORK**: any tier with lift < 0 and |lift| > 1 sigma (the gate's `reject`), at >= 3 runs per cell. For M1/M2 this means the default-on mechanism hurts and should be reworked or turned off.
- **INCONCLUSIVE**: fewer than 3 measured runs in any paired cell, more than 20% of cells voided or inconclusive in a tier, or the mechanism's trigger rate is under 30% of B-arm cells (it was not exercised, so a null is uninformative). Reported as such, never as "no effect".
- **PASS (default-on / keep default-on)**: >= 2 tiers, every tier has lift >= 3 pp AND |lift| > 1.96 sigma AND billed-token overhead <= 15%; OR the efficiency path: in every tier LLM calls fall >= 15% (paired bootstrap 95% CI of the per-cell calls difference excludes 0) with no REWORK condition and accuracy lift >= -1 sigma, and token overhead <= 15%.
- **OPT-IN**: everything else (positive or flat but not promotable, one tier only, within noise, or over the token budget).
- For M1/M2 (currently default ON): PASS means "default justified by evidence"; OPT-IN means "no evidence it helps; default stays only on a cost/UX argument, recommend owner decide"; REWORK means "evidence against".

Power statement (honest): at 18 cells per arm per tier the sigma on a 50% accuracy is about 16 pp for a two-arm difference, so a 1.96-sigma promotion needs a lift above roughly 30 pp on one tier. Most mechanisms will land OPT-IN or INCONCLUSIVE by construction. The efficiency path (calls) is paired and more sensitive; use it. Where the lift gate `rax eval gate` applies (2 tiers x >= 3 runs), the verdict is also run through it and written to the ledger.

## 6. Contamination and instrument rules

- Other agents share this Ollama. A foreign client already posts to `/v1/systemone` (a 9B `nimble:latest` model is resident; `bun test apps/cortex/server/tests`, pid 1409389 at 23:23, was the source at that moment). Per invocation record the journal count of `/v1/systemone` and HTTP 503; any invocation with a nonzero count, or with a foreign model resident in `/api/ps` at start, has its cells flagged `voided` and re-run. Voided rows stay in the manifest.
- Instrument first: print the visible tool surface per arm; pilot cell on each tier and a check of the trace (numCtx, flags recorded in `run-started.config`) before the matrix.
- No source edits. Drivers live outside the repo (`/home/tylerbuell/campaign-traces/plan-posture/`) and are copied here as `.txt`.
- Ollama: one resident model of mine at a time; `keep_alive` default; models stopped at the end (`ollama stop`).
