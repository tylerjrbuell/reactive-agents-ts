---
type: development-note
status: active
created: 2026-11-03
tags: [agents, workflow, efficiency, tooling, harness]
---

# Agent session learnings (2026-10-29 → 11-03)

Friction and conventions observed while orchestrating ~40 warden/subagent dispatches on `dev`. Written for the codebase-efficiency cleanup so future agent sessions are cheaper, more deterministic and goal-aligned. Everything here was hit in practice; nothing is speculative.

## 1. Tooling traps that cost real time

- **`grep` is an ugrep-based shell function** in this environment and silently skips binary-flagged files (e.g. `packages/reasoning/src/kernel/assessment/assess.ts`). Use `/usr/bin/grep -a` (or the Grep tool) for census/sole-caller checks. A "0 hits" from shell `grep` is not proof of absence.
- **`packages/reasoning` exports `dist`.** Edits to its `src` are invisible to runtime/Cortex/probes until `bunx turbo run build --filter=@reactive-agents/reasoning` runs. Other workspace packages run from `src` under Bun. Turbo's "N cached" line can hide a stale dist; confirm the build actually ran when a downstream test disagrees with a fresh edit.
- **Probe scripts must use absolute paths.** A relative `$0`-derived dir plus a `cd /tmp` made every cell "fail instantly" (a probe bug, not a model bug). `probe.ts` also needs an ABSOLUTE output root.
- **Gitignored evidence.** `wiki/Research/Harness-Reports/*-traces/` directories are gitignored; reports that cite them are not self-contained on a fresh clone. Decide per report: force-add small trace sets, or copy a few into a tracked fixtures dir.
- **Trace corpus isolation.** Tests must never write to the real trace dir (see `packages/trace/src/paths.ts`, `retention.ts`); set `REACTIVE_AGENTS_TRACE_DIR` per probe cell.

## 2. Shared-tree conventions that held up

- No `git stash` in the shared tree. Path-scoped commits only: `git add -- <paths> && git commit -- <paths>`, re-check `git diff --cached --stat` right before committing.
- Domain wardens (kernel, runtime, provider, tools) edit but do not commit; the parent commits the warden's exact path list. This removed every staging-sweep incident after the first.
- One concern per commit; trace/measurement changes are separated from behavior changes, and any behavior change is called out in the commit message.
- **Ratchet ledgers** (`scripts/check-file-size.sh`) fail on SHRINK as well as growth. Any warden that shrinks a pinned file must lower the ceiling in the same change; extract a leaf module instead of growing a pinned file.

## 3. Verification is cheaper when baselines are stable

- Two tests (`as unknown as` ceilings: tests ≤251, src ≤79) fail on every full run and every package run. They mask real failures and force every report to say "only the 2 known failures". Fix the casts or re-baseline the ceilings so "0 fail" is the normal state.
- Per-package scoped commands that were sufficient: `bun test packages/<pkg> --timeout 20000`, `bunx turbo run typecheck --filter=@reactive-agents/<pkg>`, `for s in scripts/check-*.sh; do bash $s || echo FAIL $s; done`, then one full `bun test --timeout 15000` + `bun run build` at the end. A single `scripts/verify-scope.sh <pkg>` wrapping these would remove most per-dispatch boilerplate.
- Every new test file requires `bun run --cwd apps/docs metrics && metrics:sync-readme` (+ bump `apps/docs/src/data/metrics-cache.json`). Do it once per wave, not per agent; wardens should only report "new test files" and not run it.
- Full-suite flake seen once: `nested dashboard rollup` test passes alone, failed in the full run (stdout interference between files). Worth isolating.

## 4. Documentation hygiene that would save tokens

- `AGENTS.md` and `.agents/MEMORY.md` carry stale snapshots (test counts such as 9,979/11,399, "latest full test run" lines, old version snapshots). Agents copy these numbers into reports and briefs. Prefer a single generated status block (`metrics.json`) and link to it.
- `wiki/Hot.md` and `.agents/MEMORY.md` are appended per session and grow without folding; keep the newest entry authoritative and fold older ones.
- Reports should end with a machine-greppable block (paths, commit, gates, open items) so the next session does not re-read prose.
- MissionBrief/UpwardReport are working well; a one-screen template with the standard constraints (no stash, no commit, rebuild dist, red-on-cut, ratchet note) would remove ~40% of brief length.

## 5. Harness-specific working rules (goal alignment)

- **Instrument before concluding.** Several "findings" were instrument faults (probe path bug, an old-trace field that a newer commit had already fixed). Re-verify each claim on a FRESH run before fixing.
- **Wire it AND pin it, red-on-cut.** Every new signal was read back through the normalized trace (`loadTrace` / `toTraceEvent`), and each pin was mutated to confirm it goes red.
- **Boundary-first.** The recurring defect class was "a strategy/guard decides termination on its own". Fix at the shared boundary (`finalizeStrategyResult`, `emitTerminalDecision`, `strategy-terminal-decision.ts`, the terminal verify gate), never per strategy.
- **Strategies are becoming a substrate, not rigid modes.** New logic must not be added per strategy. Put it in the shared finalize/terminal path, the kernel phases, or typed run-envelope rails (`rails.posture` is the template: typed, trace-visible, honored by the kernel, set by callers). Strategy files should converge toward thin policy over shared primitives (see the Plan and Goal Primitives spec, Phase 4 "strategies-as-policies").
- **Measure before defaults.** Default-on behavior changes need the lift rule (>=3pp, <=15% tokens, 2 tiers). A frozen real-task eval (Plan 8 H3) is the gate; hand-rolled probes produced void arm-sets three times.
- **Debugging entry point.** `rax-diagnose cause <runId|path>` (and `cause --all --real`) classifies a run from its trace; `run-started.config` records the mechanisms/builder/env it ran with; `run-completed.outcome` carries authority, kernelAuthority, deliverable, verifierVerdict, outstanding, errorClass. Start there before reading raw jsonl.

## 6. Where to look

- Diagnosis + plans: `wiki/Research/Audit-Reports-2026-11-02/`, `wiki/Research/Audit-Reports-2026-11-03/`, `wiki/Planning/Implementation-Plans/2026-11-02-harness-convergence.md` (Plan 8).
- Evidence: `wiki/Research/Harness-Reports/2026-11-03-*`.
