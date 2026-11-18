---
type: experiment
status: complete
created: 2026-11-18
tags: [ablation, parallel-tool-hint, lean-final-turn, h3, lift-gate, speedups]
---

# Ablation: parallelToolHint and leanFinalTurn vs off

**Verdicts (lift gate, `rax eval gate`, ledger entries 54 and 55):**

| Lever | Gate | Activations | Recommendation |
| --- | --- | --- | --- |
| `parallelToolHint` (`RA_PARALLEL_TOOL_HINT=1`) | **OPT-IN** (−0.9pp, −35.9% billed tok, within noise) | 48/48 runs | Keep opt-in under the lift law. It is a strong efficiency win at equal pass rate (41/48 both arms): turns −37%, billed tokens −33% to −39% on both tiers. The gate has no "non-inferior plus savings" path, so promotion is an owner decision, not a gate result. |
| `leanFinalTurn` (`RA_LEAN_FINAL_TURN=1`) | **REJECT** (gemma4:e4b −24.4pp, significant) | 40/48 runs | REWORK. It fires too early (defect below). Do not default it on. |

Pre-registered predictions: [PREDICTIONS.md](PREDICTIONS.md). Prediction 4 held for pth (opt-in by "within noise"). For lft it was wrong in the direction it flagged as a risk: a reject.

## Setup

- Pinned worktree at `7a48829e2` (auto-shadow judgment opt-in since `2bef8ba3a`), reasoning dist built there, removed after.
- Runner [run-ab.ts](run-ab.ts): H3 `runH3` cells, arms interleaved per (run, task) in one process. Two tiers were added that the H3 table lacks: gemma4:e4b and cogito:14b. Both are in `STATIC_CAPABILITIES`, and both calibrations rate `parallelCallCapability: "reliable"`. One task was added, `golden-moons`: the docs golden-run prompt, web-search plus 2 file-writes, scored by a deterministic hidden check.
- Tasks: h3-todo-heavy, h3-required-tools, h3-continuation, h3-exact-value, ab-trap-5, golden-moons. Cell timeout 180 s.
- k=5 on gemma4:e4b (90 cells) and k=3 on cogito:14b (54 cells). Cogito was cut from 5 because the full matrix estimated over 3 h. 144/144 cells measured, 0 timeouts, 0 errors.
- Host: before every chunk, `lsof -iTCP:11434` and `/api/ps` were checked for foreign clients and models, and the same was sampled every 15 s during chunks. All checks were clean ([results/host.log](results/host.log), [results/foreign.log](results/foreign.log)). The 1-min load average was 4.7 to 10.0 (desktop, IDE and indexer). Wall-time figures carry that noise; turns, tokens and pass counts do not.
- An earlier attempt on 2026-11-17 was void: auto-shadow judgment fired `nimble` calls on every `build()` and contended for the GPU. None of its cells are used here.

## Pooled per tier

| tier | arm | n | solved | mean acc | mean turns | mean billed tok | mean wall s | fired runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cogito:14b | off | 18 | 15/18 | 0.944 | 4.67 | 4925 | 18.6 | - |
| cogito:14b | pth | 18 | 15/18 | 0.944 | 3.06 | 2997 | 17.9 | 18/18 |
| cogito:14b | lft | 18 | 17/18 | 0.981 | 4.83 | 4964 | 19.3 | 15/18 |
| gemma4:e4b | off | 30 | 26/30 | 0.956 | 4.93 | 6342 | 12.6 | - |
| gemma4:e4b | pth | 30 | 26/30 | 0.938 | 3.13 | 4269 | 11.6 | 30/30 |
| gemma4:e4b | lft | 30 | 18/30 | 0.711 | 4.83 | 5791 | 12.0 | 25/30 |

The per tier × task × arm table (turns = kernel think turns, billed tokens, wall s, pass, multi-call turns, fired runs) is in [results/table.md](results/table.md).

## Findings

**parallelToolHint.** Almost all of the saving is on h3-todo-heavy: 13.4 to 3.0 turns on gemma, 13 to 3 on cogito, and billed tokens about 20k to 5k on both. Gemma h3-exact-value also drops from 3 to 2 turns. Golden-moons and the single-read tasks are flat. Cogito already batches there. Wall time barely moves on cogito (todo-heavy 40 s to 38 s): Ollama runs batched calls' generation serially, so fewer turns save prompt re-reads, not decode time. Gemma's todo-heavy wall drops from 23 s to 14 s. Per-task pass deltas are all inside noise (gemma ab-trap-5 4/5 vs 5/5, required-tools 3/5 vs 1/5).

**leanFinalTurn: defect.** The lean turn decides that tool work is settled from the contract, but the contract only knows `tool-coverage: file-read`. On h3-exact-value (read a.json and b.json, add the counts), one `file-read` satisfies that requirement. The next turn ships with no tools, and gemma answers "The count from a.json is 412. I still need the content of b.json..." That answer is accepted as final: 0/5 vs 5/5. A satisfied tool-coverage requirement does not mean the task's tool work is done. The "tools return next turn" fallback never runs, because the incomplete answer terminates the run. Cogito escapes only because it reads both files in one turn. Billed tokens drop 9% on gemma and rise 1% on cogito, so the claimed saving is small even where the lever is safe.

**ab-trap-5 on lft (gemma 3/5 vs 5/5): not attributable.** The lever fired in 0/5 of those runs. One failing output reads as an honest abstention ("I cannot determine the total because the file ./ledger.json could not be found"), yet it scored 0. That is a scorer question for harness-warden, not evidence about lft.

## Recommendations (the parent dispatches; nothing was flipped here)

1. `parallelToolHint`: stays opt-in by the gate. If the owner wants speed for v0.19, this is the candidate: two tiers, equal pass, −35.9% billed tokens. That is an explicit owner call on efficiency evidence, logged as such.
2. `leanFinalTurn`: REWORK (reasoning / kernel-warden). Gate the lean turn on evidence that the task is answerable, not on contract coverage alone. Or do not let a tool-less lean reply terminate the run when it asks for more input. Re-ablate after the rework.

Artifacts: [run-ab.ts](run-ab.ts), [analyze.ts](analyze.ts), [to-session.ts](to-session.ts), [results/](results/) (results JSON per arm × tier, `session.json`, `gate-receipt-{pth,lft}.txt`, `verdict-{pth,lft}.txt`). Traces stay outside the repo in `/home/tylerbuell/ab-speedups-data/main/traces-*`.
