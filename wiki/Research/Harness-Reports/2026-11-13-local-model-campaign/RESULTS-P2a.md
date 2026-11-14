---
type: research
status: complete
created: 2026-11-13
tags: [harness, bench, local-models, campaign, ollama, h3, long-horizon]
---

# Local-model campaign P2a: full H3 (6 models) + long-horizon (3 models)

Pinned SHA `2269ce57e` (worktree `/home/tylerbuell/campaign-worktree`, reasoning dist built). Arm `ra-default` (H3), `lh-a0` (LH). Out-of-repo driver `/home/tylerbuell/campaign-traces/driver-pinned.ts`; `RA_BENCH_ALLOW_FALLBACK=1` (live probe wrote numCtx 32768). Manifest: `manifest.jsonl` (252 new P2/P3a rows, each with SHA and 12-char model digest). /tmp 2.3G before and after (growth 0); / 216G free.

Superseded (re-pulled models, digest changed): granite4:tiny-h `c4d3ac2a16a3 -> 566b725534ea`, qwen3:4b `2bfd38a7daaf -> 359d7dd4bcda`. Their attempt-1 files moved to `/home/tylerbuell/campaign-traces/superseded/`; "superseded" rows appended to the manifest. Kept (digest unchanged): llama3.1 `46e0c10c039e` (36 cells), cogito:8b `75b508ddece1` (32 kept + 4 run now). qwen3.5 (`56671c2ab938`) and gpt-oss (`f38aa0c53da5`) run fresh. gpt-oss smoke: solved, 3 iters, 1790 tok, 18 s (loads and tool-calls on Ollama 0.40.15; not in STATIC_CAPABILITIES, ran under the override).

Noise rule: 36 cells, Bernoulli. Gaps under ~26pp are noise (plan rule; true SE is ~8pp per model). Do not read per-task win/loss at k=3.

## 1. H3 (12 tasks x k=3 = 36 cells per model, all complete)

| Model | Solved | Rate | Median dur | Billed tok / solved | Total tok | endStatus (succ/fail/none) |
|---|---|---|---|---|---|---|
| qwen3.5:latest | 29/36 | 81% | 22 s | 13,946 | 404k | 24/9/3 |
| gpt-oss:latest | 25/36 | 69% | 32 s | 17,225 | 431k | 28/8/0 |
| qwen3:4b | 23/36 | 64% | 55 s | 15,086 | 347k | 24/8/4 |
| granite4:tiny-h | 17/36 | 47% | 9 s | 16,935 | 288k | 27/9/0 |
| cogito:8b | 14/36 | 39% | 15 s | 14,293 | 200k | 23/12/1 |
| llama3.1:latest | 11/36 | 31% | 15 s | 31,845 | 350k | 28/8/0 |

Ranking is credible at the ends (qwen3.5 vs llama3.1/cogito: 42-50pp). Adjacent gaps (qwen3.5/gpt-oss, gpt-oss/qwen3:4b, granite/cogito) are inside noise. Cause-label histograms are in the manifest (`causeLabel`).

Universal failures: rw-2 and rw-3 are 0/18 or near for every model, rw-7 fails on most (hidden checks: stock-out identified, data table, salary grounded). Every model fails the same checks, so treat rw-2/rw-3 as a task-difficulty/grader-strictness probe, not model signal.

qwen3:4b is slower than the attempt-1 baseline (median 55 s vs 33 s; 4 cells hit the 150 s cell timeout, all "aborted", thinking runaway). Cell timeout is part of this score: re-pulled digest thinks longer.

## 2. Failure attribution (`rax-diagnose attribute --all`, zero tokens)

P2 (216 runs, 104 failed): harness 14 (13%), model 77 (74%), environment 12 (12%), unattributed 1.

| Reason | Count | Where |
|---|---|---|
| model:had-evidence-wrong-output | 49 | all |
| model:fabrication-vetoed | 14 | verifier correctly rejected |
| model:evidence-not-gathered | 11 | |
| environment:run-aborted | 8 | 150 s timeout: qwen3:4b 4, qwen3.5 3, cogito 1 |
| environment:tool-failure | 4 | granite 2, llama 2 |
| harness:forcing-unused | 5 | cogito:8b (all 5) |
| harness:evidence-truncated | 4 | granite 2, llama 1, qwen3.5 1 |
| harness:stall-after-work | 2 | granite 1, cogito 1 |
| harness:plan-fanout-blob / evidence-missing / tool-call-dropped | 1 each | gpt-oss |

Per-model harness share of failures: cogito 6/23 (26%), gpt-oss 3/12, granite 3/21, qwen3.5 1/8, llama 1/25, qwen3:4b 0/15.

Harness-attributable, with root-cause hypotheses (anchors for domain wardens; not verified by edit):
1. **harness:forcing-unused, cogito:8b x5** (`01M7B8JH8KVJEP4F84FZPQ7NZS`, `01M7B8GZ71CYABYPGRGZWZ86RM`, `01M7B8M488XK3JPVRXXAMMWPAA`, ...): "4 of 4 turns that offered domain tools made no call and were not forced (actOrAnswer=false)". A required `file-read` stays unsatisfied for several turns and the harness never forces a tool call. Hypothesis: forcing is gated off by `actOrAnswer=false`; look at `packages/reasoning/src/kernel/capabilities/reason/think.ts` (forcing decision) and the required-tool nudge at `packages/reasoning/src/kernel/loop/runner.ts:875`. Kernel-warden.
2. **harness:false-veto (LH only, see 3)**: hidden grader passes (score 1.0) while run-completed is `failure`.

P3a (36 runs, 21 failed): harness 6 (29%): false-veto 5, misleading-guidance 1; model 14; unattributed 1.

## 3. Long-horizon (6 tasks x k=2 = 12 cells per model, 3 best H3 models; all complete)

Note: PLAN said "3 tasks"; the LH suite has 6 (rw-4, rw-7, lh-1 + 3 new offline tasks). 36 cells total. An early `run.sh` default of k=3 was caught after 1 cell and re-run at k=2 (that cell kept; it is valid for k=2).

| Model | Solved | Median dur | Billed tok / solved | Total tok | Per-task (run0,run1) |
|---|---|---|---|---|---|
| gpt-oss:latest | 10/12 | 72 s | 179,835 | 1.80M | rw-4 11, rw-7 11, lh-1 00, debug-green 11, enumerate 11, pipeline 11 |
| qwen3.5:latest | 5/12 | 98 s | 207,865 | 1.04M | rw-4 10, rw-7 11, lh-1 00, debug-green 00, enumerate 11, pipeline 00 |
| qwen3:4b | 5/12 | 168 s | 108,044 | 0.54M | rw-4 01, rw-7 11, lh-1 11, debug-green 00, enumerate 00, pipeline 00 |

Caveat on qwen3:4b lh-1: the hidden grader passed in both runs but the runtime marked both `failure` (false-veto, below). Counted solved here because the grader is the outcome truth.

**lh-1 is environment-gated.** The only search backend is DuckDuckGo instant answers; `web-search` fails ("produced no results ... Only DuckDuckGo instant answers are configured"): 44 failures in one qwen3.5 run, 13 in gpt-oss. lh-1 is 66% of all LH tokens (2.24M of 3.38M): gpt-oss 1.33M of 1.80M (74%), qwen3.5 0.63M of 1.04M, qwen3:4b 0.28M of 0.54M. Scores on lh-1 do not measure the model. The 5 offline tasks: gpt-oss 10/10, qwen3.5 5/10, qwen3:4b 3/10 (rw-4/rw-7 need network for rw-4 only).

**Loop detection (commit 2269ce57e), 36 cells.** `guard-fired loop_guidance` fired in 7 cells, always as graduated `redirect`, never as a terminate:
- qwen3.5 lh-1 run0 (6 fires, pattern d `no-new-evidence`, counter nonSubstantiveSameToolCalls 3/3) and run1 (2); qwen3.5 rw-7 run1 (1, pattern a `repeated-tool-call`).
- gpt-oss lh-1 run1 (2, pattern a); qwen3:4b lh-1 run1 (3x pattern d + 1x pattern e `evidence-staleness`), qwen3:4b rw-4 run1 (2, pattern a).
All 4 lh-1 cells with guidance still ended `stall_deliverable` failure (12-47 iterations); the 2 non-lh-1 cells with guidance (qwen3:4b rw-4 run1, qwen3.5 rw-7 run1) ended success (rw-4) / failure with grader pass (rw-7, false-veto). No cell was killed by a loop guard. Honest read: guidance fires only where a tool is persistently failing, and it did not change those outcomes (the underlying tool was broken); it did not harm the offline long-horizon tasks (0 fires on 27 of 30 non-lh-1 cells). The `harness:misleading-guidance` verdict (qwen3.5 lh-1 run1, `01M7BMAC7EP2A9E3132K1VJX86`): the repeated-identical-failure redirect at `packages/reasoning/src/kernel/loop/iterate-pass.ts:710` told the model to retry `web-search` after it had already switched to `http-get`; findings.json never written. Evidence the new guidance did not distinguish an alternate satisfied path from the failing one.

**False-veto, 5 LH cells (harness, decisive), plus 1 P3a-adjacent:** grader score 1.0, run `failure`:
- gpt-oss rw-4 run0 `01M7BMRZ767PW0AGJVZ6P37Z0S`: `runtime-success-veto:terminal-outcome`, verifier `action-success` "final-answer returned success=false", terminal at max_iterations after `ri-early-stop:block`.
- qwen3:4b lh-1 run0/run1 (`01M7BPDFCEXW00Y46XNKCNNFZH`, `01M7BQHPD1NTK65DTP6KVXGKNZ`): `runtime-success-veto:outstanding-criteria` outstanding `tool:web-search` (requirement unsatisfiable because the tool backend is broken, yet the deliverable was produced).
- qwen3.5 rw-7 run0/run1 (`01M7BKH59X68AJ4B7WVK0SZ9KS`, `01M7BM82NW1W7JMHFGE5RDZPNC`): `unclassified:stall_deliverable` "last text was narration around a tool call"; fix landed correctly (hidden test passes).
Anchor: `packages/runtime/src/engine/finalize/status-authority.ts:32-33` (outstandingContractNotSuccess / terminalOutcomeNotSuccess) and `packages/reasoning/src/kernel/loop/runner-helpers/stall-deliverable.ts:270` (stall_deliverable terminate). Runtime-warden / kernel-warden.

## 4. Token spend (zero-token read of `llm-exchange` per purpose; `harness-cost-attribution.ts` not run, it is a separate live single-task A/B writing to /tmp)

Spend on cells that did not solve: P2 llama 85%, cogito 84%, granite 70%, qwen3.5 55%, qwen3:4b 51%, gpt-oss 46%. P3a: qwen3.5 78%, gpt-oss 74%, qwen3:4b 27%. `think` is 85-100% of calls and 80%+ of tokens in every model; `synthesize` 7-20%; `verify` and `extract` negligible.
Shape differs by family: qwen3:4b output tokens are 69% of spend (out 304k vs in 138k, 1.0M thinking chars in P2, `think` llmSec 1,700); gpt-oss P3a is 94% input (1.68M in / 112k out, ~7k input per call, 239 calls); qwen3.5 P3a 88% input.

## 5. Ranked efficiency levers

1. **Fail fast on a persistently broken required tool** (lh-1 web-search): 2.24M of 3.38M LH tokens (66%) bought no solve; gpt-oss ran 46-47 iterations before `stall_deliverable`. Loop guidance fires but only redirects; no escalation to "requirement unsatisfiable, finish with what you have" or surface a tool-down message. Savings estimate: up to ~60% of LH tokens on tool-broken tasks (~1.3M of 1.8M for gpt-oss). Also removes the 2 lh-1 false-vetoes. Anchors: `loop-guidance.ts:86`, `iterate-pass.ts:710`, `stall-deliverable.ts:270`. Evidence: 4 traces above.
2. **Bound thinking for the qwen3 family**: qwen3:4b spends 69% of tokens on output/thinking, 4/36 H3 cells and 6 LH redirects were `thinking-runaway`, and 4 cells timed out at 150 s (0 tokens recorded, dead time). Existing `thinking-runaway` recovery is reactive (`packages/reasoning/src/kernel/capabilities/reason/thinking-runaway.ts`). A pre-emptive thinking cap/num_predict budget for `thinking:true` models is the candidate; unverified. Savings: plausibly 30-50% of qwen3:4b tokens/time (not measured).
3. **Stop re-sending a growing context for tool-heavy long runs**: gpt-oss/qwen3.5 LH input is 88-94% of tokens (7k+/call, 239 calls). Evidence-truncated and head-truncation-guard already fire; lever is projection compaction between iterations (`packages/reasoning/src/assembly/project.ts`). Estimate unmeasured; needs a per-iteration input-size curve (zero-token, from the traces already collected) before any change.
4. **Force the tool call when a required read is unmet** (cogito 5 forcing-unused failures; 0.0 score each, tokens wasted on 4-5 no-call turns). Correctness lever, small token saving.
5. **Close false-veto**: 5/36 LH cells with a passing hidden grader marked failure (14% of LH cells; changes gpt-oss rw-4 and qwen3.5 rw-7 to successes). Correctness; zero token cost.

Not levers: llama3.1 31.8k tok/solved is mostly model (wrong-answer, stall-after-work 14/36 = model-final stall); rw-2/rw-3 universal failure is a task/grader question, not a harness defect found here.

## 6. Dispatch (no code edited by me)
- kernel-warden: forcing-unused (cogito), misleading-guidance redirect when alternate tool already satisfied, fail-fast on broken required tool, pre-emptive thinking budget.
- runtime-warden: false-veto reconciliation (`status-authority.ts:32-33`) for unsatisfiable-tool and narration-then-fix cases.
- provider-warden: STATIC_CAPABILITIES row for `gpt-oss:latest` (loads, native-fc works, 131072 ctx per Ollama show; confirm) and the section 3 rows from PLAN.md.
- Owner: lh-1 needs a real search backend or should be excluded from LH aggregates; P3b/P4 untouched.

## 7. Artifacts
Results `/home/tylerbuell/campaign-traces/p2/*.json`, `/home/tylerbuell/campaign-traces/p3a/*.json`; traces `/home/tylerbuell/campaign-traces/traces/{p2,p3a}/<model>/`; logs `p2-*.log`, `p3a-*.log`; analysis scripts `agg.ts sum.ts lh.ts cost.ts`; superseded `/home/tylerbuell/campaign-traces/superseded/`.
