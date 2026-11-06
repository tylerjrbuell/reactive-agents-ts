---
type: ablation
status: complete
created: 2026-11-06
tags: [ablation, lift-gate, progress-aware-exit, loop-progress-aware, plan-9, h3, opt-in]
---

# Ablation: progress-aware exit (`progressAwareExit`) vs progress-aware loop (2f). Verdict OPT-IN for both

**Warden:** ablation-warden
**SHA:** `c76f508f84772f80bcc2d851ae90890fa9923d1d` (local `dev` HEAD; scratch worktree, detached; core, reasoning, runtime and trace dist rebuilt). Every results file records this SHA.
**Previous runs:** [[../2026-11-05-loop-progress-aware/README]] and [[../2026-11-06-loop-progress-aware-rerun/README]], both void (2f never fired).

## Design

| Arm | `--harness` | Meaning |
|---|---|---|
| a0 | (none) | HEAD default path |
| a1 | `loopProgressAware` | 2f: a second loop verdict is redirected when work landed |
| a2 | `progressAwareExit` | exit gate re-denies a soft exit when the ledger shows progress since its last denial (max 3) |
| a3 | `loopProgressAware,progressAwareExit` | both |

- Tiers: `qwen3:4b`, `cogito:8b` (Ollama, local).
- Tasks: `h3-todo-heavy` (frozen H3 suite) and long-horizon suite `--arm a0` tasks `rw-4, rw-7, lh-debug-green, lh-enumerate-audit, lh-pipeline-stages` (`lh-1` excluded: no web-search provider in the worktree, as in 2026-11-05).
- k = 3 per (tier, task, arm). Cell timeout 240 s. Foreground chunks of at most 590 s (`chunk.sh`). The harness moved long chunks to background after 180 s; each was awaited to completion before the next started, so no cells overlapped.
- Two qwen `lh-enumerate-audit` cells timed out (a0 run 2, a2 run 2). They were topped up with separate k=1 files (`*-supp*.json`). The a0 top-up timed out once more, so a second top-up (`supp2`) ran. Every cell now has 3 measured runs. The timed-out runs stay in the report as inconclusive. This is why the gate labels the qwen tier INCONCLUSIVE.
- Gate input: `session-report.json`, built by `to-session.ts`, which pools all results files per arm. Token means use measured runs only.

## Activations (counted first)

Activation means a `guard-fired` event with `guard: progress_aware_exit`, `outcome: block`, `reason: progress_since_last_exit` (2f: `loop_resolution` / `progress_since_last_loop`). Counter: `activations.ts`. Full per-run listing: `activations.txt`.

| Arm | PAE grants | runs with a PAE grant | 2f blocks | runs with a 2f block | runs |
|---|---|---|---|---|---|
| a0 | 0 | 0 | 0 | 0 | 38 |
| a1 | 0 | 0 | 3 | 2 (both cogito) | 36 |
| a2 | 4 | 3 (1 cogito, 2 qwen) | 0 | 0 | 37 |
| a3 | 6 | 3 (all cogito) | 0 | 0 | 36 |

- Every grant (10/10) fired on `lh-debug-green` or `lh-pipeline-stages`. None fired on `h3-todo-heavy`, `rw-4`, `rw-7` or `lh-enumerate-audit`.
- Proposers granted against: `loop_resolution` 3, `low_delta_guard` 3, `stall_deliverable` 4.
- **Every grant's `outstanding` was a final-answer item** ("write the final answer (the last text was narration...)" or "...using the results from file-write"). **No grant named a missing output file.** The target case in the mission brief was runs that end with 1-4 of 6 files missing. This run gives no evidence that the mechanism reaches that case.
- Activation-scoped accuracy for a2: the 3 runs with a grant scored 0.00 (cogito `lh-debug-green` run 2), and 0.33 and 0.33 (qwen `lh-debug-green` runs 1 and 2). The matching a0 cells average 0.00 (cogito) and 0.28 (qwen). The +16.7 pp cogito `lh-debug-green` delta for a2 comes from run 0 (0.50), where no grant fired. That delta is not attributable to the mechanism.
- Soft-guard exits that ended the run (stall guards, gate-aware reader `packages/trace/src/guard-run-end.ts`): a0 7/38, a1 10/36, a2 8/37, a3 6/36.

## Gate verdicts (verbatim; `rax eval gate`, DEFAULT_LIFT_POLICY; ledger not booked per brief)

Full receipts: `gate-vs-a0.txt`, `gate-a2-vs-a1.txt`.

**a2 vs a0, `--activations 3`**
```
  cogito:8b            19.1    21.9    +2.8pp     +6.7%  BELOW
  qwen3:4b             47.8    40.3    -7.5pp     -3.2%  INCONCLUSIVE
  AGGREGATE  2.8pp · 6.7% billed tok · tiers=2 · PARTIAL
  DECISION: OPT-IN — OPT-IN · 2 tier(s) · 2.8pp lift · 6.7% billed tok — inconclusive tier blocks promotion
```

**a1 vs a0, `--activations 2`**
```
  cogito:8b            19.1    10.6    -8.5pp     +8.7%  BELOW
  qwen3:4b             47.8    36.5   -11.3pp    -16.6%  INCONCLUSIVE
  AGGREGATE  -8.5pp · 8.7% billed tok · tiers=2 · PARTIAL
  DECISION: OPT-IN — OPT-IN · 2 tier(s) · -8.5pp lift · 8.7% billed tok — inconclusive tier blocks promotion
```

**a3 vs a0, `--activations 3`**
```
  cogito:8b            19.1    15.3    -3.9pp     +9.0%  BELOW
  qwen3:4b             47.8    45.0    -2.8pp    -18.6%  INCONCLUSIVE
  AGGREGATE  -3.9pp · 9.0% billed tok · tiers=2 · PARTIAL
  DECISION: OPT-IN — OPT-IN · 2 tier(s) · -3.9pp lift · 9.0% billed tok — inconclusive tier blocks promotion
```

**a2 vs a1, `--activations 3`** (2f-removal criterion)
```
  cogito:8b            10.6    21.9   +11.2pp     -1.9%  BELOW
  qwen3:4b             36.5    40.3    +3.8pp    +16.1%  INCONCLUSIVE
  AGGREGATE  11.2pp · -1.9% billed tok · tiers=2 · PARTIAL
  DECISION: OPT-IN — OPT-IN · 2 tier(s) · 11.2pp lift · -1.9% billed tok — inconclusive tier blocks promotion
```

No arm regressed beyond the 1σ band (no `reject`). Billed-token overhead is within 15 % in every comparison except qwen a2 vs a1 (+16.1 %), which is not a promotion comparison.

## Reading

1. **Mechanism-attributable lift is not measurable at this power.** Per-task 95 % bands are ±33-44 pp at n=3. The largest single delta (qwen `rw-4` −60 pp) appears in a1 and a2 alike, and neither mechanism fired on `rw-4` in any run. That −60 pp is base-arm noise: a0 scored 1.0/1.0/0.8 on that cell. Grants touched 3 of 37 a2 runs, so they can move a tier mean by only a few pp at most.
2. **progressAwareExit fires; 2f barely does.** a2 fired in 3/37 runs on both tiers. a1 fired in 2/36 runs, cogito only. In a3, PAE pre-empts 2f: 0 2f blocks, because the gate grant denies the exit before a second loop verdict reaches 2f.
3. **It fires on the wrong outstanding item for the stated hypothesis.** All grants answer "write the final answer", not missing deliverable files. Runs that ended with files missing were not rescued by any grant in this sample.

## Recommendation

- `progressAwareExit`: **OPT-IN-ONLY.** Keep it opt-in. Do not default it on. To earn a default, it needs a task set where grants fire on missing-artifact outstanding items, and k ≥ 8 per cell, so the gate can resolve a ≥ 3 pp lift.
- 2f (`loopProgressAware`): **remove (recommended), with a caveat.** The brief's rule is to remove 2f only if a2 ≥ a1. a2 ≥ a1 holds on both tiers in point estimate: cogito 21.9 vs 10.6, qwen 40.3 vs 36.5. The gate verdict for a2 vs a1 is OPT-IN, not a significant win. Other points support removal. 2f fired in 2/36 runs. In a3 it is fully pre-empted by PAE. Its point estimate is the worst arm on both tiers. The removal argument is subsumption plus simplicity, not a proven lift of a2 over a1. The removal must go to the reasoning domain warden as a `packages/**/src/**` edit. ablation-warden does not edit src.

## Reproduce

```
chunk.sh <h3|lh> <tier> <a0|a1|a2|a3> <tasks> [k]
bun to-session.ts session-report.json results-*.json
bun run rax -- eval gate --report session-report.json --baseline a0 --candidate a2 --activations 3
bun activations.ts results-*-<arm>.json
```
Traces: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/pae/traces-*` (scratch, not in the repo).
