---
type: experiment
status: complete
created: 2026-11-18
tags: [harness, h3, regression-check, release, v0.19.0]
---

# v0.19.0 harness regression check: dev vs v0.18.0 (targeted H3, local tiers)

**Verdict: GO for the harness on the measured cells.** Neither tier shows a harness regression. Pass rates move inside the noise band (Wilson intervals overlap). No `harness:*` reason rose, and none is new. Billed tokens on completed runs moved +1.5% (qwen3:4b) and -2% (cogito:8b). Mean iterations went down on both tiers. Every extra qwen3:4b failure on dev is a 180 s cell timeout (`environment:run-aborted`). Its trace shows a host stall or a think turn near the token cap, and both arms show the same stalls.

Scope limit: this run covers the 7 targeted H3 tasks (70 cells per arm), not the 5 `rw-*` tasks. See "Not run" for what the full run would cost.

## Setup

| | Before | After |
|---|---|---|
| code | `v0.18.0` (`da184d82e`), worktree `/home/tylerbuell/h3-v018-wt` | dev `0f3cc0f84`, worktree `/home/tylerbuell/h3-dev-wt` (pinned; the shared checkout moves) |
| `@reactive-agents/reasoning` dist | rebuilt in the worktree | rebuilt in the worktree |
| commits between | 569 (`git rev-list --count v0.18.0..0f3cc0f84`) | |

- Baseline choice: no committed H3 results match the current suite hash `d79b1c9d…`. `rw-3` and `rw-6` were re-frozen on 2026-11-15 (`418f0fc4d`, `0e2fa2c06`). The newest full run (`2026-11-06-6a6a-batch-full-h3`) also predates v0.18.0 by 239 commits. So both arms were run fresh, on the same host, back to back.
- Tasks (hash-identical in both checkouts): `h3-todo-heavy, h3-plan-only, ab-trap-4, ab-trap-5, h3-required-tools, h3-continuation, h3-exact-value`. They cover the changes the brief named: wrap-up/to-do, abstain/finalize, tool surface and verifier.
- Flags (identical): `--k 5 --budget-sec 585 --cell-timeout-sec 180 --start-margin-sec 100`, arm `ra-default`. One `--out` per tier, and only one Ollama model loaded at a time (qwen3:4b both arms, then cogito:8b both arms).
- Attribution and verdict: dev's `@reactive-agents/trace` scored both arms (`verdict.ts` and `rax-diagnose attribute --all` run from the dev worktree). The `causeLabel=parse-failed` in the v0.18.0 results JSON is the old runner's out-of-worktree CLI spawn. That instrument fault was fixed after v0.18.0. Attribution recomputes from the traces, so it does not matter here.
- Host: load average 8 to 10 throughout, 4 to 10 GB free RAM, swap full, with other sessions running. Wall time is confounded by load. Use tokens, iterations and counts instead.
- Traces (local, not committed): `/home/tylerbuell/h3-traces-v019check/{v018,dev}-{qwen3-4b,cogito-8b}/`.

## Zero-token lanes (all green)

- `bun run bench:replay`: 7/7 goldens green.
- `bun run repo test packages/testing/tests/gate/north-star-gate.test.ts packages/reasoning/src/kernel/loop`: 164 pass, 0 fail.
- `bun run repo test packages/benchmarks/tests packages/diagnose packages/trace`: 1090 pass, 0 fail.

## verdict.ts (before = v0.18.0, after = dev)

qwen3:4b:

```
NO-CHANGE · harness:tool-call-dropped 0→0 · pass 33/35 → 30/35 (-9pp, within noise); harness:tool-call-dropped absent from the baseline cells (wrong target?)
  activity changed: guard:terminal_decision:terminate 33/35→30/35; guard:dispatcher_early_stop:terminate 3/35→2/35; guard:plan-fanout-split:redirect 1/35→2/35; signal:redirect@thinking-runaway 2/35→1/35
```

(The qwen3:4b tier has no `harness:*` reason in either arm, so any target reads `absent`. The line is used for the pooled pass count and the activity deltas.)

cogito:8b:

```
NO-CHANGE · harness:forcing-unused 3→3 · pass 20/35 → 21/35 (+3pp, within noise)
  activity changed: signal:redirect@capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate 14/35→11/35; guard:deliverable_decision:block 3/35→0/35; guard:dispatcher_early_stop:terminate 6/35→4/35; guard:exit_gate:terminate 3/35→1/35; guard:pending_batch:warn 3/35→1/35; signal:nudge@runner.ts 3/35→1/35
```

Pooled, both tiers:

```
NO-CHANGE · harness:forcing-unused 3→3 · pass 53/70 → 51/70 (-3pp, within noise)
```

Wilson 95% (`report.ts`, H3TIER): qwen3:4b 33/35 (0.81-0.98) → 30/35 (0.71-0.94). cogito:8b 20/35 (0.41-0.72) → 21/35 (0.44-0.74). The intervals overlap on both tiers, so no pass-rate claim is possible.

## Attribution histogram (`rax-diagnose attribute --all`)

| reason | qwen v0.18 | qwen dev | cogito v0.18 | cogito dev |
|---|---|---|---|---|
| not-failed | 33 | 30 | 19 | 21 |
| environment:run-aborted | 2 | 5 | 1 | 2 |
| environment:tool-failure | 0 | 0 | 2 | 0 |
| harness:forcing-unused | 0 | 0 | 3 | 3 |
| harness:false-veto | 0 | 0 | 1 | 0 |
| model:had-evidence-wrong-output | 0 | 0 | 7 | 6 |
| model:evidence-not-gathered | 0 | 0 | 2 | 1 |
| unattributed | 0 | 0 | 0 | 2 |

Harness-attributed failures: 4 → 3 (both tiers). The `harness:forcing-unused` count did not change (3 → 3, all cogito h3-todo-heavy / h3-required-tools). This reason predates v0.18.0 and is not a regression.

## Per task (mean billed tokens over all measured cells; timeouts count 0 tokens)

| tier | task | v0.18 solved | dev solved | v0.18 tok / iter | dev tok / iter |
|---|---|---|---|---|---|
| qwen3:4b | ab-trap-4 | 5/5 | 5/5 | 0 / 0 | 0 / 0 |
| qwen3:4b | ab-trap-5 | 5/5 | 5/5 | 3576 / 3 | 3701 / 3 |
| qwen3:4b | h3-continuation | 5/5 | 5/5 | 2570 / 2 | 3243 / 2 |
| qwen3:4b | h3-exact-value | 5/5 | 5/5 | 3300 / 2 | 3983 / 2 |
| qwen3:4b | h3-plan-only | 5/5 | 4/5 | 17218 / 0 | 17337 / 0 |
| qwen3:4b | h3-required-tools | 5/5 | 4/5 | 12780 / 3.4 | 11729 / 3.4 |
| qwen3:4b | h3-todo-heavy | 3/5 | 2/5 | 17870 / 9.4 | 12901 / 8.6 |
| cogito:8b | ab-trap-4 | 5/5 | 5/5 | 0 / 0 | 0 / 0 |
| cogito:8b | ab-trap-5 | 3/5 | 5/5 | 2043 / 3.6 | 1710 / 3.4 |
| cogito:8b | h3-continuation | 5/5 | 4/5 | 1102 / 2 | 892 / 1.8 |
| cogito:8b | h3-exact-value | 5/5 | 5/5 | 2672 / 4 | 2936 / 4 |
| cogito:8b | h3-plan-only | 0/5 | 0/5 | 4571 / 0 | 4438 / 0 |
| cogito:8b | h3-required-tools | 0/5 | 0/5 | 5008 / 6 | 3938 / 4.8 |
| cogito:8b | h3-todo-heavy | 2/5 | 2/5 | 9653 / 8.2 | 9884 / 7.4 |

Completed (non-timeout) runs only: qwen3:4b mean billed 8684 → 8815 (+1.5%), mean iterations 2.75 → 2.5. cogito:8b 3684 → 3606 (-2%), iterations 3.5 → 3.21.

## Findings

1. **No harness regression measured.** All 3 extra qwen3:4b failures on dev are cell timeouts. Each one is a single slow LLM call, and the same pattern occurs in the v0.18.0 arm:
   - `01M7P772359Q10KVP95KAR2Z8K` (dev h3-plan-only run0): one call, 682 output tokens in 152 s (about 4.5 tok/s against a run-wide mean of 93 tok/s). This is a host stall.
   - `01M7P8630DFYK5RDAHJCS97H81` (dev h3-todo-heavy run1): the first think call ran 180 s and was aborted before it returned usage.
   - `01M7PA96C2BM4EGEC3QHQ7QMQH` (dev h3-required-tools run4): the iter-2 think call ran 112 s and was aborted.
   - v0.18.0 counterparts: `01M7P55ZF4SPNVFT5W83MZDDAJ` (a 104 s call) and `01M7P5V9X5A8AH13T7HHBJ0MNZ`. Also, v0.18.0 h3-continuation had a 166 s call for 1443 tokens, which is the same host stall that did not quite time out.
   - Decode throughput is the same in both arms (96.6 vs 93.3 tok/s across 100+ calls each). `maxTokens` is identical per task (4096 plan-only, 7200 elsewhere). The cogito dev timeouts are the same shape: `01M7PBRNMNBE3ER22FGDCK2MG7` made one 180 s call with no output on a task cogito answers in about 80 tokens and 10 s, and `01M7PBZJ72WAXNNVS49AZJ1E0C` returned 15 tokens in 22 s.
2. **Small deterministic input growth.** The system prompt grew 14 to 21 chars, which is about +20 input tokens per call on small tasks. The h3-plan-only first call grew about +430 input tokens (1595 → 2023 qwen, 1584 → 2004 cogito). The likely cause is the plan-posture by-name tool catalog, which is now on by default (`planToolCatalog: true` in `run-started.config`, commit `cc9a6a5db`). Billed tokens on plan-only did not move (output dominates), so this is not a regression. It is a fixed cost to keep in view.
3. **qwen3:4b output on h3-continuation / h3-exact-value is higher on dev** (about +26% / +20% mean tokens, 5/5 solved in both arms). The cost is qwen thinking length, and the per-run spread is wide (984-3403 output tokens on dev continuation, 971-1966 on v0.18). With n=5 unpaired this is not separable from variance. A k=10 rerun of those two cells would settle it (about 10 min).
4. **Instrument gap (harness-warden's own, not a framework defect).** Two dev cogito h3-required-tools runs come out `unattributed`: `01M7PC6KW5TBQGNF856PXP7RV9` and `01M7PCN1Y2KZ0R1C9MYZJFV7H0`. In both, the model emitted `file-read` and `file-write` in the same turn, so it wrote a guessed mean before the read result arrived. The v0.18.0 arm attributed the same model error as `model:evidence-not-gathered` (`01M7PB53GRG4NX2ENB8G7FRJGF`, where the write came before the read across turns). The attribution rule looks for evidence before the divergence turn, so it misses the case where the read and the write happen in the same turn. Owner: harness-warden (`packages/trace/src/attribution.ts`). Not release-blocking.
5. **Pre-existing, not regressions (context for Show HN polish).** On cogito:8b, h3-plan-only and h3-required-tools are 0/5 in both arms (`model:had-evidence-wrong-output`). `harness:forcing-unused` is 3/35 in both arms. qwen3:4b think turns still hit the 7200-token cap at iter 0 in both arms (h3-required-tools, h3-todo-heavy).

## Not run (cost of the full run)

- The `rw-2, rw-3, rw-6, rw-7, rw-9` tasks: 50 cells per arm (25 per tier). At this host's load that is about 70 s per qwen cell and about 30 s per cogito cell, so about 42 min per arm and about 85 min for both. `rw-3` and `rw-6` also need dev's re-frozen graders (`packages/benchmarks/src/tasks/real-world.ts`, commits `418f0fc4d`, `0e2fa2c06`) copied into the v0.18.0 worktree. Without that the suite hash differs and those cells cannot be compared. These are task-data-only edits in a scratch worktree.
- Frontier tier (needs owner approval, not run): a cross-tier check on one cheap frontier model for all 12 tasks, k=5, two arms, is 120 cells at about 15k tokens each, or about 1.8M tokens. Estimated cost: about $1 on gpt-4o-mini, about $5-10 on claude-haiku-4.5.
