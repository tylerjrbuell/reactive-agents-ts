---
type: research
status: blocked
created: 2026-11-15
tags: [ablation, compute-offload, local-models, instrument]
---

# computeOffload ablation: BLOCKED at the instrument check (no verdict)

Verdict: none. The brief's stop rule fired (systemone traffic on the shared Ollama during measured cells). Cause attributed to OTHER processes on the machine, not to the bench cells. Only 16 pilot/partial cells exist (cogito:8b). They are contaminated and cannot support a gate result. The gate (`evaluateLiftGate`) was not run: no paired cell has 3 runs per arm on 2 tiers, so the honest state is `underpowered` / not measured.

## Pre-stated decision rule (written before any measured cell)

Gate: `evaluateLiftGate`, `DEFAULT_LIFT_POLICY` (minLiftPp 3, 95% band 1.96, maxTokenOverheadPct 15 billed, minTiers 2, minRuns 3).
- Primary metric: per-run accuracy and solved rate on the 5 trigger tasks (`h3-required-tools`, `h3-plan-only`, `h3-todo-heavy`, `lh-pipeline-stages`, `lh-enumerate-audit`), per tier (weak = llama3.1, cogito:8b, qwen2.5:14b, granite4:tiny-h; strong = qwen3.5, gpt-oss).
- default-on needs: lift >= 3pp (above the 1.96 band) in >= 2 tiers, billed-token overhead <= 15% on every tier, and no new false-success class on controls `h3-continuation` and `rw-9` (accepted-and-wrong rate and `harness:ignored-guidance` unchanged).
- Noise: Bernoulli cells, k=5 x 4 models = n=20/arm on the weak tier, SE about 11pp, so only a lift above about 20pp is detectable on one tier.
- Diagnostics (not in the rule): code-execute call rate and success rate per arm.

## Instrument findings (valid, load-bearing)

1. A1 is NOT separable by config. `computeOffload` is one flag: the `builtins-floor` surface change (`resolve-think-surface.ts:180`) and the guidance line (`iterate-compute-offload-seam.ts`) both read `harness.computeOffload`. Only A0 (off) vs A2 (on) can be run without source edits.
2. Surface floor is a no-op on `h3-required-tools` (and `rw-7`, `lh-debug-green`): the task already declares `code-execute` as `available`. Verified in traces: A0 and A2 both show `visible:[file-read,file-write,code-execute]`. On that task A2 = guidance only. Floor effect exists only on `h3-plan-only`, `h3-todo-heavy`, `lh-pipeline-stages`, `lh-enumerate-audit`. A pooled "arithmetic item" lift mixes two different treatments; report per task.
3. Verified pilots (cogito:8b): A0 `h3-todo-heavy` visible `[file-read,file-write]`; A2 `[file-read,file-write,code-execute]` (`builtins-floor`). Run-started config records `computeOffload:false` (A0) and `true` (A2). Flag toggle is `RA_COMPUTE_OFFLOAD=1` env (bench picks it up through `resolveHarnessConfig`).
4. Trigger (`asksForComputedAggregate`) on the task prompts: fires on all 5 target tasks, quiet on both controls `h3-continuation`, `rw-9`. It also fires on `rw-2`, `ab-trap-5`, `h3-exact-value` (not in this matrix).
5. No judgment/shadow events in any bench trace; cells ran with `REACTIVE_AGENTS_NO_AUTO_SHADOW=1`.

## Why it stopped: ambient /v1/systemone traffic

- During the first measured chunk (cogito:8b A0, 2026-11-15 23:14-23:21) the ollama journal logged `/v1/systemone` (2 hits in that window: 23:15:44 and 23:20:20, HTTP 499).
- With NO bench process running (checked with `ps`), a second window showed 219 `/v1/systemone` + 375 `/api/tags` per minute. The `ss -tnp` owners of the connections to :11434 were pid 1638556 (Cortex dev server `bun run server/index.ts`, up since 22:56) and pid 2311346 (`bun test packages/runtime`, started by `bun run repo verify packages/runtime` from the main thread). So the traffic is the dev stack and concurrent repo test runs sharing the same Ollama, not the bench.
- Consequence: the GPU is shared. One cell in the partial data hit the 150 s cell timeout (`h3-plan-only` A0 run1, inconclusive, 0 tokens), consistent with contention. Cell timing and timeouts are not trustworthy while this runs, and token/latency overhead comparisons would be confounded.
- I could not separate "my" systemone from ambient by journal alone, so per the brief I stopped. Evidence my cells made none: zero judgment events in traces, env opt-out set, systemone present while the driver was absent.

## Partial data (cogito:8b only; contaminated, do not gate on it)

16 cells in `manifest-offload.jsonl` (A0 12, A2 2 pilot cells plus 2 earlier pilot cells; every row: gitSha 6f24b599b, model digest `75b508ddece1`, arm). Solved: A0 5/12 conclusive-ish (1 inconclusive), A2 0/2 on trigger tasks. n is far below any gate threshold; no inference.

## To resume (needs owner action)

1. Quiet the shared Ollama: stop the Cortex dev stack (pid 1638556) or run it with `REACTIVE_AGENTS_NO_AUTO_SHADOW=1`, and do not run `bun test` suites that hit Ollama while cells run.
2. Re-run: `/home/tylerbuell/campaign-traces/step.sh <model>` (one <=590 s invocation per call, alternates A0/A2, prints `systemone=` and `http503=` counts per invocation). Worktree `/home/tylerbuell/offload-worktree` at `6f24b599b`, reasoning dist built. Void and re-run the 16 existing cells.
3. Estimated cost: about 420 runs, 6-8 h of wall time for the full 6-model matrix; weak tier first.
4. Consider asking kernel-warden for a separate flag for the guidance line if A1 vs A2 attribution matters.

Artifacts: `/home/tylerbuell/campaign-traces/offload/` (cell json, logs, traces), drivers `driver-offload.ts`, `runo.sh`, `step.sh`.
