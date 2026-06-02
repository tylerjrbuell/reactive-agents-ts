---
title: Phase 1 — PostConditionVerifier Spine — Live-Run Gate Evidence
date: 2026-05-30
phase: "Phase 1 (WS-1) — PostConditionVerifier spine (the headline)"
plan: "[[2026-05-30-canonical-agentic-convergence-plan]]"
flag: RA_POST_CONDITIONS (default OFF — control-first)
---

# Phase 1 — PostCondition spine: state-grounded success authority

A deterministic (no-LLM, ledger-only) **PostCondition spine** is now the kernel's
success authority, gated behind `RA_POST_CONDITIONS` (default OFF). When a run has
non-empty derived post-conditions and the flag is on, the harness **cannot report
success while any condition is unmet** — at BOTH seams:
- **Mid-loop steer** (arbitrator `applyPostConditionGate`): a would-be exit-success
  with unmet conditions is demoted → steering ("You still must: write ./commits.md;
  call the `file-write` tool") → continue (bounded).
- **Terminal hard-stop** (`terminate()`, the single-owner imperative gateway): ANY
  forced termination (stall/harness-deliverable, `low_delta_guard`, loop-graceful,
  oracle-forced, nudge-exhausted) whose ledger leaves a condition unmet resolves to
  `status:"failed"` → `result.success=false`. This closes the "9 termination paths,
  1 owner" gap that an arbitrator-only wiring left open.

Conditions are derived ONCE at run-start and stored on `state.meta.postConditions`;
both gates read the same set (DRY).

## What lands
- `kernel/capabilities/verify/post-conditions.ts` — `PostCondition` union
  (`ToolCalled | ArtifactProduced | OutputContains`) + pure `verify()` + `describeUnmet()`.
  ArtifactProduced satisfied only by a successful WRITING-tool observation linked
  (toolCallId) to the target path (file-read / failed-write / different-path excluded).
- `kernel/capabilities/verify/derive-conditions.ts` — deterministic `deriveConditions`;
  high-precision path heuristic (real-file-extension allowlist + URL/decimal/abbreviation
  guards); nothing-derives → `[]` (prose fallback, additive-only).
- `kernel/capabilities/decide/arbitrator.ts` — mid-loop steer gate (reads stored set).
- `kernel/loop/terminate.ts` + `runner.ts` + `state/kernel-state.ts` — run-start derive+store
  + terminal hard-stop.
- `strategies/reflexion.ts` — reflexion completion gate "B" generalized onto the spine
  (flag-gated; flag-off keeps the narrow required-tools gate).
- `task-quality-gate.ts` — `postConditionsMet` column wired to real `verify()` output.

## LIVE-RUN GATE

### 1. Honesty (headline) — `success:true` impossible without the deliverable
Spot-test: cogito:14b + GitHub-MCP, task = *"Fetch the last 10 commits … and create a
markdown file (./commits.md) …"*. `deriveConditions` → `[ArtifactProduced('./commits.md'),
ToolCalled('file-write')]`.

| arm | flag | result.success | ./commits.md |
|---|---|---|---|
| A (prose authority — old) | off | **`true`** ❌ THE LIE | **ABSENT** |
| B (state-grounded) ×5 cogito | on | `false` ✓ | absent |
| B sonnet-4-6 ×1 | on | `false` ✓ | absent |

**6/6 flag-on runs honest** (cogito ×5 + sonnet ×1); zero false-success. Flag-off was
observed lying (Arm A: success:true, no file). The agents call `recall` with
`key:"./commits.md"` (recall-as-file-write confusion) or never write — the correct
outcome is honest FAILURE (the plan makes failure honest; it does not guarantee a weak
model can complete the task).

**Met→success direction confirmed LIVE (no MCP):** sonnet + local `file-write` only,
task *"write the exact text 'hello' to ./out.txt"*, `RA_POST_CONDITIONS=1` →
`result.success=true` AND `./out.txt` written (`content=[hello]`), no steering. This
closes the asymmetry: `ArtifactProduced` recognition is correct in BOTH directions
(met→success here against a real file-write observation; unmet→fail ×6 above) — not
just the synthetic integration test.

### 2. rax:diagnose — terminal gate firing on an imperative path
`rax:diagnose replay 01KSWSHT32TF73ABK43DRCDN31` (post-fix cogito flag-on run):
- 12× post-condition steering ("still must" injected)
- `kernel-state-snapshot status=failed terminatedBy=low_delta_guard`
- `run-completed status=failure`

The run stalled (`low_delta_guard` — an imperative path that PREVIOUSLY force-delivered
a success: trace `01KSWR3S5FEW0KM61PCF1M6946` showed `[harness-deliverable] Assembling
output … after 4 stalled iterations` → `success:true` with no file). The terminal gate
now converts that to honest `status=failed`.

### 3. No-regression — cross-tier pass^k flat (fixture-pinned, N=3)
Arm A (flag off) vs Arm B (flag on), `hn-fixture-2026-05-30.json`:

| tier | pass^k A→B | avg composite A→B |
|---|---|---|
| gpt-4o-mini | 3/5 → 3/5 | 78% → 79% |
| cogito:14b | 5/5 → 5/5 | 91% → 88%* |
| qwen3.5 | 5/5 → 5/5 | 92% → 92% |
| sonnet-4-6 | 5/5 → 5/5 | 95% → 95% |

*Caveat: Arm A was captured on mid-implementation code (before the warden's fixes
landed); Arm B on final code. So this table reflects code-change + flag, NOT a clean
flag-only A/B — treat it as corroborating, not definitive. No-regression is carried by
the **construction argument** (synthesis tasks T1–T5 derive `[]` or an already-met
`ToolCalled(get-hn-posts)` → both gates no-op) + the green suite (1486/0). `met→success`
proven by the deterministic integration test AND the live file-write test above.

### 4. Unit/suite
- `post-conditions.test.ts` + `derive-conditions.test.ts` + `post-condition-gate.test.ts`
  + `terminal-post-condition-gate.test.ts` — RED→GREEN (incl. the stall-path integration case).
- Full `@reactive-agents/reasoning` suite: **1486 pass / 0 fail**; build + typecheck clean.
- 3 review-caught bugs fixed: ArtifactProduced unlinked-fallback false-met; URL `//`
  slip; derive `(e.g.` false-match. Spec ✅ + code-quality ✅ on both the spine and the
  terminal gate.

## Default
Ships behind `RA_POST_CONDITIONS` default OFF (control-first checkpoint). Both gate
directions are now proven (kill-the-lie ×6 + trace; met→success live + integration test),
so the mechanism is sound opt-in. **Default-flip is a clean follow-up decision** — not
taken in this commit, per the plan rollback ("authority gated until proven") + the
team-ownership pilot caution + the fact that the no-regression table above is code+flag,
not a clean flag-only A/B.
