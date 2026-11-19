---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [code-execute, retry-guide, call-success, suite-v2, h3, live-validation, predictions]
---

# code-execute retry guide: pre-registered predictions (addendum 8)

Written BEFORE any live cell. Prior art: [arithmetic-lever census](../2026-11-19-arithmetic-lever-census/README.md) (baseline numbers), [zoo-live addendum 7](../2026-11-18-zoo-live/README.md).

Build: HEAD `3402eb77577e` (`fix(tools): code-execute failure observations carry a runnable JS retry guide`, `CODE_RETRY_GUIDE` at `packages/tools/src/skills/code-execution.ts:69`, used at lines 78, 228, 373). Working tree clean for `packages/reasoning`, `packages/tools`, `packages/benchmarks` at start (`git status --short` empty). Reasoning src last changed at `a6b0f8844` (clean). Bench resolves reasoning and tools from `src` under Bun. Another session's kernel-warden may edit `packages/reasoning` concurrently: reasoning src SHA and dirty flag are re-recorded at the end; a change is flagged and the affected cells are marked contaminated. `ollama ps`: empty (no model loaded). Host load 3.4 on 6 CPUs at start. One bench:drive supervisor at a time. Env `RA_ACT_OR_ANSWER=0 RA_LEAN_FINAL_TURN=0 RA_PARALLEL_TOOL_HINT=0`, default arm, runner `src/spikes/h3-extra-tiers.ts`, `allowContention: true`.

## Baseline (census, pre-guide, mixed SHAs)

- Calculator visible: 188 runs. Called: 67 (36%). Value returned: 3 (1.6%).
- Among engaged offered runs: 2 of 44 returned a value (about 5%).
- cogito:8b `h3-required-tools` offered: 52 runs, 22 engaged, 0 valued.
- Failed calls 290 of 326; never executed (class A wrong language/shell/param + class B JS syntax): 213 of 290 = 73%.

## Definitions (fixed now)

Per run, from `tool-call-start` / `tool-call-end` events on `code-execute`:
- engaged: at least 1 call.
- never-executed call: result text lacks `"executed":true`, or carries a pre-execution marker (language not supported, shell command, parameter must be one of, JS syntax error: `Unexpected`, `must be initialized`, `JSON Parse error`). Classes A and B of the census.
- value returned: a call whose result has `"executed":true` and a non-null `result` or non-empty `output`, and no failure marker.
- Never-executed share = never-executed calls / all failed calls (failed = not value-returned), pooled over the cell set.
- After a valued call: figure the model wrote (or answered) compared with the task's true figure.

## Cells

Part 1 (arithmetic lever, suite v2, `code-execute` offered): cogito:8b `h3-required-tools` k=10; cogito:8b `rw-2-calc`, `rw-3-calc`, `h3-plan-only-calc` k=5; qwen3:4b the same three v2 tasks k=5 plus `h3-required-tools` k=5 (the census has its offered baseline: 12 of 29 called, 0 valued). Cell timeout 300 s.
Part 2 (no-regression): gemma4:e4b on `rw-7` k=5 (test-runner use of `code-execute`); `lh-debug-green` if the task is registered for that runner, else `rw-7` only. Baseline for solved: whatever the census/zoo corpus shows for gemma4 on rw-7; if no baseline exists, the regression check is "solved at k=5 is not below 4/5 and no tool-failure rise", stated as such. Cell timeout 300 s.

## Predictions

Credences are stated, not measured.
- Engagement (>=1 call) stays at the census level: cogito `h3-required-tools` 30-50%, v2 tasks low (0-20%). The guide changes failure text only, so I expect no engagement rise. 75% credence engagement does not rise by more than 15pp.
- Value-returned rate among engaged runs, pooled over cogito+qwen3:4b Part 1: point guess 15%, range 5-30%. Credence it reaches >= 25%: 30%.
- Never-executed share of failed calls: point guess 60%, range 45-70%. Credence it falls to <= 50%: 35%.
- Credence the pre-registered rule says confirmed (either branch): 50%.
- No regression on rw-7 (gemma4:e4b): solved unchanged, 80% credence. Token delta from longer refusal text: under +5% per run, 75% credence.
- Solved counts: secondary; cogito `h3-required-tools` 0-1 of 10 (baseline 0 of 52); qwen3:4b unchanged near its 27-of-29 head-arithmetic rate.

## Decision rule (verbatim from the brief)

- Confirmed: value-returned rate among engaged runs rises to >= 25% (pooled Part 1), OR never-executed share of failed calls drops from 73% to <= 50%.
- Refuted: neither.
- Solved count is secondary: reported, not the verdict.
- Regression flag: gemma4:e4b rw-7 solved drops versus baseline, or tool-failure/token rise beyond the prediction above.
- If engagement stays low but call success rose (confirmed): say L3 (write-time nudge) is now justified to spike, quoting the census numbers (ungrounded figure written in 84% of arithmetic-task runs; trigger 0 of 798 on non-arithmetic tasks).

Power: Part 1 engaged-run counts will be small (tens, not hundreds); rates carry wide intervals and are reported with counts. Bernoulli solved SE ~13pp at k=10, ~20pp at k=5; no KEEP claims. Verdict words: confirmed / refuted / underpowered (declare underpowered if fewer than 10 engaged runs pooled, or if the 95% interval on value-returned straddles 25%; in that case the verdict is the point rule with that caveat attached).
