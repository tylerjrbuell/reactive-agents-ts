---
type: research
status: partial
created: 2026-11-15
tags: [ablation, compute-offload, local-models, instrument]
---

# computeOffload ablation: weak tier measured, strong tier not run. Not default-on; no lift found.

Pinned worktree `/home/tylerbuell/offload-worktree` at `6f24b599b`. Arms: A0 flag off, A2 `RA_COMPUTE_OFFLOAD=1`. A1 is not separable by config (one flag drives both the surface floor and the guidance line). Every cell ran with `REACTIVE_AGENTS_NO_AUTO_SHADOW=1` and `RA_BENCH_ALLOW_FALLBACK=1`; arms alternated per invocation (`step.sh`). Rows: `manifest-offload.jsonl` (each has SHA, model digest, arm, `voided` flag).

## Verdict

- Gate: NOT default-on. `rax eval gate` was not run and no ledger entry was written: it needs a report with 2 tiers x >=3 runs per paired cell, and the strong tier has zero cells. In `evaluateLiftGate` terms the result is `underpowered` for the promotion question, and the measured weak tier shows no lift (opt-in at best).
- Weak tier, trigger tasks (n about 70 per arm): solved 3/68 (A0) vs 2/70 (A2), lift -1.6pp, SE 3.2pp; accuracy lift -2.1pp. Billed tokens/run +38%, wall time +48% (27 s to 40 s). Fails the lift bar (>=3pp) and the overhead bar (<=15%).
- The default-on rule needs lift in >=2 tiers. Strong tier (qwen3.5, gpt-oss) not run; weak tier does not pass alone. Cannot promote.
- Controls (`h3-continuation`, `rw-9`): 23/30 vs 24/30 solved, +12% tokens. No new false-success class seen (h3-continuation 15/15 in both arms; rw-9 8/15 vs 9/15, noise).

## Pre-stated decision rule (written before any measured cell)

Gate `evaluateLiftGate`, `DEFAULT_LIFT_POLICY`: lift >=3pp above the 1.96 band in >=2 tiers; billed-token overhead <=15% on every tier; no new false-success class on controls. Bernoulli cells: k=5 x 4 weak models gives n=20/arm per task-set, SE about 11pp, so only a lift above about 20pp is detectable on one tier.

## Coverage (what actually ran)

| Model | Digest | H3 (25/arm) | LH (10/arm) |
|---|---|---|---|
| llama3.1:latest | 46e0c10c039e | full | full |
| cogito:8b | 75b508ddece1 | full | full |
| qwen2.5:14b | 7cdf5a0187d5 | full | A0 4, A2 5 of 10 (stopped) |
| granite4:tiny-h | 566b725534ea | not run | not run |
| qwen3.5, gpt-oss | 56671c2ab938, f38aa0c53da5 | not run | not run |

Stopped at 09:11 on 2026-11-16 (about 2 h of work). The brief's stop rule fired again: the invocation window 09:03-09:10 logged `/v1/systemone` x49. Concurrent processes on the shared Ollama: `bun run repo test packages/runtime` (pid 458464, started about 09:08) and the restarted Cortex dev server (pid 225317). The preceding invocations (07:16-09:03) each logged systemone=0 and http503=0. The 2 qwen2.5:14b LH A0 cells from the contaminated invocation (`lh-enumerate-audit` run 2, `lh-pipeline-stages` run 2) were removed from the analysis and kept in the manifest flagged `voided`. The 18 earlier voided rows (first attempt, 2026-11-15) are also flagged.

## Per model (target tasks = the 5 trigger tasks)

| Model | A0 solved | A2 solved | lift pp | tokens/run | s/run |
|---|---|---|---|---|---|
| llama3.1 | 0/25 | 0/25 | 0 (acc +4.8) | 9749 -> 17117 (+76%) | 13 -> 17 |
| cogito:8b | 0/25 | 0/25 | 0 (acc -4.1) | 10770 -> 11321 (+5%) | 15 -> 17 |
| qwen2.5:14b | 3/18 (1 inconclusive) | 2/20 | -6.7 (SE 11) | 8133 -> 11314 (+39%) | 63 -> 99 |

Floor of 0 on llama3.1 and cogito:8b: those models solve none of the trigger tasks in either arm, so lift cannot show on the "solved" metric.

## Per task (weak tier pooled)

| Task | A0 | A2 | lift pp | tokens/run | Treatment |
|---|---|---|---|---|---|
| h3-required-tools | 0/15 | 0/15 | 0 | +49% | guidance only (tool already declared available) |
| h3-plan-only | 0/15 | 0/15 | 0 | +4% | floor + guidance |
| h3-todo-heavy | 3/15 | 1/15 | -13.3 (SE 12) | +48% | floor + guidance |
| lh-pipeline-stages | 0/11 (1 inc) | 0/12 | 0 | +74% | floor + guidance |
| lh-enumerate-audit | 0/12 | 1/13 | +7.7 (SE 8) | +22% | floor + guidance |
| h3-continuation (control) | 15/15 | 15/15 | 0 | -2% | quiet trigger |
| rw-9 (control) | 8/15 | 9/15 | +6.7 (SE 18) | +18% | quiet trigger |

Every difference is inside 1 SE. No task shows a promotable lift.

## code-execute usage (trace-derived, H3 tasks only; LH traces were not covered by the script's path glob, so this is partial)

| Arm | target runs | runs with a code-execute call | ok calls | failed calls |
|---|---|---|---|---|
| A0 | 45 | 5 | 0 | 8 |
| A2 | 45 | 15 | 4 | 27 |

The mechanism did what it was built to do on the surface: the tool is called 3x as often (5 to 15 runs of 45). But 27 of 31 A2 calls failed, so the extra calls did not turn into correct figures. This matches the spike's own warning: "if A2 calls succeed less than half the time, do (c) deeper first". The code-execute reliability work (description, language mismatch, sentinel mode) is the lever; offload amplifies an unreliable tool.

## Instrument checks

- A0 `h3-todo-heavy`: visible `[file-read,file-write]`; A2: `[file-read,file-write,code-execute]` with reason `builtins-floor`. Run-started config recorded `computeOffload` false/true. `h3-required-tools` declares `code-execute` available, so the floor is a no-op there.
- Trigger fires on all 5 target tasks and stays quiet on both controls.
- Zero judgment/shadow events in bench traces; opt-out env set.
- `/v1/systemone` seen in the journal only in the contaminated 09:03 window (49) and the first-attempt windows; the source processes were identified by `ss -tnp` and `ps` and are not bench processes.

## Caveats

- Weak-tier "arithmetic item" correctness is the task's hidden-grader solved flag, not a per-figure score; a task can fail for non-arithmetic reasons (see rw-2 anchoring in the spike).
- Two of three measured weak models score 0/25 on the trigger tasks in both arms; this tier gives little room to show lift.
- qwen2.5:14b LH is a partial pair (4 vs 5 cells per arm).
- Wall-time and token overhead were measured with the GPU free except for the contaminated window; the A2 overhead is real (extra tool calls, failed code-execute turns), not a contention artifact.

## Recommendation

1. Do not make `computeOffload` default-on. Keep it opt-in; it adds +38% tokens on the weak tier for no solved-rate gain.
2. Fix code-execute reliability first (27 of 31 calls failed in A2); re-run after that, A2 only on `h3-todo-heavy`, `lh-pipeline-stages`, `lh-enumerate-audit` and granite4:tiny-h, plus the strong tier for the 2-tier requirement.
3. If A1 vs A2 attribution matters, ask kernel-warden to split the flag.

To resume: `/home/tylerbuell/campaign-traces/chain-offload.sh qwen2.5:14b granite4:tiny-h qwen3.5:latest gpt-oss:latest` (aborts on any systemone or 503 in an invocation window). Artifacts: `/home/tylerbuell/campaign-traces/offload/` (cell json, `chain.status`, traces, `voided/`), analysis `offload-analyze.py`.
