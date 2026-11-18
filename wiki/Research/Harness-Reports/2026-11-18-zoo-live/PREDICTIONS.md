---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [zoo, live-validation, predictions, h3]
---

# Zoo live validation: pre-registered predictions

Written BEFORE any non-smoke live cell. Build: reasoning dist contains a93c6dd46 + 4b3c33c64 (verified by string grep of `unreadProseInputs`, `declineSettlesOutstanding`, "projection beyond the measured" in `packages/reasoning/dist/index.js`; dist mtime 16:17:19 precedes the commit stamp 16:19:14, built from the working tree, content verified). Runner: `bench:drive` with `src/spikes/h3-extra-tiers.ts` (registers gemma4:e4b). Arms interleaved, cell timeout 180 s, flags via `RA_*` env per arm (off arm sets `=0` explicitly). Paired seeds are NOT available: Ollama sampling is not seeded per cell, so arms are independent Bernoulli draws; discordant counts b,c are over (run,task) pairs run back to back, not paired replays.

Zoo (bench:sim, naive scripted model, compliance 1) predictions are from `bench:sim -- --mechanism all` on the same commit.

| # | Family | Arms | Zoo prediction | Expected live direction | Proximal metric |
| --- | --- | --- | --- | --- | --- |
| 1 | gemma4:e4b ab-trap-5, k=5 | actOrAnswer on/off | honest-decline shape: INERT (fix: honest decline no longer re-forced). Pre-fix: HURTS | neutral to slight negative; accuracy delta within +-20pp (not resolvable) | rate of forced-call retries after an honest decline (trace); abstained-vs-failure label |
| 2 | gemma4:e4b h3-exact-value, k=5 | leanFinalTurn on/off | unread-input-prose/filename: NEUTRAL (one read, hold lean turn until all read). Pre-fix 3/5 vs 5/5 | neutral on solve rate; but I predict the model-specific failure survives in some runs (free generation after both reads is fine; risk is a partial answer when the second read was a no-op). Honest guess: on 4-5/5 vs off 5/5. | lean turn fire count; tool-less reply quoting a partial figure |
| 3 | gemma4:e4b h3-todo-heavy, k=5 | parallelToolHint on/off | iteration-cap-sequential: HELPS (turns 10 to 3, tokens -68%) | HELPS efficiency: turns about 13 to 3, billed tokens about -70%; solve rate equal (prior ablation: 5/5 both) | turns, multi-call turns, tokens per run |
| 4a | cogito:8b rw-6, k=5 | actOrAnswer on/off | no-call-stall: HELPS (0 to 1) | weak: cogito rarely stalls without a call; expect INERT to small plus | no-call turns, forced retries |
| 4b | cogito:8b rw-7, k=5 | actOrAnswer on/off | no-call-stall: HELPS | same; rw-7 low base rate so unresolvable | no-call turns, forced retries |
| 5 | cogito:8b + qwen3:4b rw-6, default arm, k=5 | one arm (default) | fabrication-veto: projection downgrade is advisory only | some failed-to-done label flips; each flipped final answer must be read for invented figures | outcome-label flips and invented figures in the final answer |
| R | cogito:8b full 12-task H3, k=5 | default arm | n/a (regression) | no regression vs the prior baseline, compared at scorerVersion 2 | per-task solve rate, tokens per solved run |

## Power statement (pre-registered)

k=5 per arm on one task: a 5/5 vs 3/5 gap is p about 0.14 (Fisher two-sided). Only a full 5-vs-0 or 5-vs-1 split is detectable at p<0.05 on one task. On a Bernoulli cell the SE is about 22pp at p=0.5, so any gap under about 40pp on a single task is noise. Efficiency metrics (turns, tokens) are near-deterministic on todo-heavy so family 3 is well powered; families 1, 2, 4, 5 are powered only for catastrophic effects, as the prior ablation's 0/5 vs 5/5 on exact-value was. A null here is "not harmful beyond about 40pp", never "equal".
