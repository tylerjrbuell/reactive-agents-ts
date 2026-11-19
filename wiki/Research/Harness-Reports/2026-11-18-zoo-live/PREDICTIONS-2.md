---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [zoo, live-validation, predictions, root-cause-fix, h3]
---

# Zoo live re-check after root-cause fixes: pre-registered predictions

Written BEFORE any cell of this re-check. First PREDICTIONS.md is unchanged.

Build under test: git SHA c9ab8d29e (HEAD, clean tree); fix commit 917b865b7. `packages/reasoning/dist/index.js` sha256 `0ca8c661899d290d1bd785be79363b904f3eb916a976a076ba74412501fa45e8`, mtime 19:49:17 (built from the working tree one minute before the commit stamp 19:49:59). `git diff 917b865b7 HEAD -- packages/reasoning/src` is empty. Dist verified to contain `failedWithPermanentError` and `namedInputsExtractable`. No rebuild needed.

Runner: `bench:drive` with `src/spikes/h3-extra-tiers.ts` (gemma4:e4b), k=5 per arm, cell timeout 180 s, arms interleaved, `allowContention` dropped (preflight fixed in 92168c940). `ollama ps` empty before the drive. Arms are independent Bernoulli draws (no seeded sampling); discordant counts are over interleaved (run,task) pairs.

## Predictions

| # | Cell | Fix under test | Off (predicted) | On (predicted) | Proximal prediction |
| --- | --- | --- | --- | --- | --- |
| F1 | gemma4:e4b ab-trap-5, actOrAnswer on/off | permanent-error decline settles after 1 call | 5/5 (prior 5/5, other inert arms 14/15) | 4/5 or 5/5 | `act-or-answer:redirect` fires 0 to 1 of 5 (was 5/5); no `dispatcher-early-stop`; tokens/run near off (about 2400, was 4519) |
| F2 | gemma4:e4b h3-exact-value, leanFinalTurn on/off | dot-dir paths extracted, fails closed when nothing extracted | 5/5 | 4/5 or 5/5 | no reply "I still need to read b.json"; lean fires only after both reads, or 0 times; tokens/run at or below off |

Risks I name in advance: (a) F1 on-arm residual: the unresolved B2 lead (decline text in a turn with dropped call ids not converted to `abstained`) is untouched by this fix; if gemma declines after one ENOENT in a turn that also carried call ids, the run may still end `dispatcher-early-stop`. (b) F2: a lean turn after both reads may still produce a partial answer; at most 1 of 5.

## Decision rule (per cell)

- Non-inferior: on solved >= off solved - 1.
- Hurt: on solved <= off solved - 3, or exact McNemar / Fisher two-sided p < .05 with on worse.
- Anything between (on = off - 2): inconclusive, reported as such, not as pass.
- Confirmed root cause also needs the proximal metric to move (redirect count for F1, "still need" replies for F2). A solve-rate null with the proximal metric unmoved is "not confirmed".

## Power statement

k=5 per arm, one task: only a 5-v-0 or 5-v-1 split reaches p < .05. Gaps under about 40pp are noise (SE about 22pp). A non-inferior verdict here means "not catastrophically worse", never "equal". Exact McNemar on interleaved pairs (n=5 pairs) is reported as descriptive; Fisher on arm totals is the independence-correct test.

## Other deliverables (zero-token)

- Regrade of the 15 rw-6 zoo-live traces with scorer v3 (`fabricatedFigures()` / `runEvidenceOf`): solved per arm before vs after. Prediction: the 7 of 15 runs with invented figures flip to unsolved; off 2/5 to about 1/5, aoa 5/5 to about 2/5, qwen default to about 1/5.
- `bench:sim` report header records the git SHA and dirty flag of `packages/reasoning/src`.
