---
type: ablation
status: complete
created: 2026-11-11
tags: [ablation, lift-gate, calibration, llm-provider, tool-result-size, opt-in]
---

# Ablation: calibration v3 priors. Verdict: OPT-IN (no promotion; keep the committed JSON)

Commit `9bf9a2c9c` shipped calibration probes v3 (`packages/llm-provider/src/calibration-scoring.ts`) but held the regenerated JSON, because writing it moves live priors. This note regenerates the JSON, finds which live fields move, and A/B tests committed (v2) against candidate (v3) priors on 2 tiers. Scripts, candidates, receipts: [2026-11-11-calibration-v3-priors/](2026-11-11-calibration-v3-priors/). The decision rule was written before any live cell ran: `PREDICTIONS.md`.

**Verdict line: OPT-IN.** Neither tier lifts. Both tiers sit slightly negative, inside the noise band. Do not replace the committed calibration JSON for the fields that have live readers.

## Gate result

Coded gate (`evaluateLiftGate`, `DEFAULT_LIFT_POLICY`). Ollama tiers token-free (owner ruling 2026-11-06). Ledger entry 44 in `wiki/Research/Harness-Reports/improvement-ledger.json`. Receipt: `gate-receipt.txt`.

```
  tier                 base    cand      lift       tok  verdict
  cogito:8b            79.6    76.6    -3.0pp     +4.2%  BELOW
  qwen3:4b             77.8    76.9    -0.9pp     -0.3%  BELOW
  AGGREGATE  -2.0pp · 1.9% billed tok · tiers=2
  DECISION: OPT-IN · 2 tier(s) · -2.0pp lift · 1.9% billed tok — within the noise floor
```

Per task (lift, candidate minus committed; per-cell 95 % band about ±33 to ±41 pp at n = 3):

| task | fires | cogito:8b | qwen3:4b |
|---|---|---|---|
| rw-2 (2533-char CSV) | size + description | −11.1 | +0.0 (both arms 0.00) |
| rw-3 (2938-char CSV) | size + description (cogito only; see Firing) | +11.1 | +5.6 |
| rw-9 | description only | −18.2 | +0.0 |
| h3-required-tools | description only | +0.0 | −11.1 |
| h3-continuation | description only | +0.0 | +0.0 |
| h3-exact-value | description only | +0.0 | +0.0 |

No tier regresses significantly, so the verdict is not REWORK. No cell clears the 95 % band either. That is the expected outcome at this power: the matrix can only see effects of roughly 30 pp or more per task.

## What the regeneration moves

v3 runner, `--runs 5`, no `--commit`; raw stdout in `raw/`. Candidate = committed file with the probe fields replaced (`build-candidates.ts`; diff in `candidates-diff.txt`). The discrimination gate passes on the 8 measured models: every gated field takes at least 2 values.

| model | steering | attention | toolResultChars |
|---|---|---|---|
| qwen3:4b | hybrid → user-message | **strong → moderate** | **2000 → 8000** |
| cogito:8b | hybrid → system-prompt | **strong → moderate** | **2000 → 8000** |
| gemma4:e4b | hybrid → user-message | | **2000 → 8000** |
| cogito:14b | hybrid → user-message | | **2000 → 1000** |
| qwen2.5-coder:7b | hybrid → user-message | | **2000 → 1000** |
| qwen2.5-coder:14b | hybrid → user-message | | |
| llama3.2:3b, llama3.2:latest | hybrid → user-message | | |
| qwen3:14b | not measured: the runner exceeded 580 s at `--runs 5` and 586 s at `--runs 3` (exit 124, no JSON). Candidate = committed. | | |

parallelCallCapability, observationHandling, toolCallDialect and actOrAnswer do not move for any measured model.

Live readers of the moving fields:
- `optimalToolResultChars` becomes `ContextProfile.toolResultMaxChars` through `selectAdapter` profileOverrides in the kernel runner. This is the tool-result compression budget (`tool-execution.ts:575`).
- `systemPromptAttention` prunes the `final-answer` tool description (`packages/tools/src/skills/final-answer.ts`, via `tool-schemas.ts`). `moderate` keeps one format clause instead of both. The source comment there records an earlier regression on cogito:14b when the description was stripped to one clause.
- `steeringCompliance` has no reader. Its change has no behavioral effect.

## Firing (pre-registered secondary)

Receipt: `results/firing.txt`. The trace `tool-call-end` result is the post-compression content the model saw.
- **Size change fired on 9 of 36 candidate runs.**
  - On cogito:8b rw-2 and rw-3, the committed arm saw the CSVs compressed (max 504 and 554 chars). The candidate arm saw them whole (2533 and 2938).
  - On qwen3:4b it fired on rw-2 only. On rw-3, qwen3:4b reads the data some other way (max 554 chars in both arms), so the size change never applied there.
- **Description change fired on 36 of 36 candidate runs**: every candidate trace ships `final-answer`.
- Showing the whole file did not help qwen3:4b on rw-2. Both arms score 0.00 there, with `stall-after-work` in every run. Visibility of the data is not what fails there.

## Setup

- **Arms without editing `packages/*/src`.** The preload plugin `arm-plugin.ts` serves every `packages/<pkg>/src/**/*.ts` from a `git archive` snapshot at HEAD `786a3aff9`. The snapshot lives in `~/.reactive-agents/ablations/2026-11-11-calibration-v3-priors/`.
  - Another warden had uncommitted `packages/reasoning` edits in the working tree. The snapshot excludes them from both arms.
  - The plugin patches one line in `llm-provider/src/calibration.ts`: it puts `RA_ABL_CAL_DIR/<id>.json` first among the loader's candidate paths, in both arms.
  - `committed/` is `git show HEAD:` of `src/calibrations/`. `candidates/` holds the v3 set.
  - `check-arm.ts` (`arm-check.txt`) proves, with zero tokens, that the arms resolve different `toolResultMaxChars` and attention values.
- **Tiers**: qwen3:4b and cogito:8b (H3 static tiers).
- **Tasks**: the frozen H3 tasks rw-2, rw-3, rw-9, h3-required-tools, h3-continuation and h3-exact-value. rw-2 and rw-3 are the only H3 fixtures over 2000 chars.
- **Runs**: k = 3 per arm × task × tier, 72 measured cells. Arms alternate per slice.
  - Each slice ran foreground under `timeout 590`.
  - The tool host moved slices that ran past 180 s into the background. Every slice still completed normally.
- **Voided**: 1 cell, cogito:8b candidate rw-9 run 1, `execution-timeout` at 200 s. It was rerun and scored 1.00. The voided record is in `results/voided-cells.json`.
- **Contention**: a cortex-warden QA pass may have shared Ollama. Cell times stayed in a steady range (cogito 4 to 33 s, qwen3:4b 6 to 104 s), and the one timeout was rerun. Timing noise does not enter accuracy.
- **Shared state**: local observations (`~/.reactive-agents/observations`) merge into the resolved prior the same way in both arms. They do not touch the two moving fields.
- **HEAD moved during the run** (results files record `c0c628ccb`, `375874e66`). The arms are pinned by the snapshot, and the session carries the snapshot SHA (`ABL_SNAPSHOT_SHA`).

## Offline census (before the matrix)

`census.ts` (`census-offline.txt`): in the recorded traces, no qwen3:4b or cogito:8b run had a non-meta tool result over 2000 chars. So the size change is a rare-path change. Its real-world effect is its firing rate times its per-fire effect, and this matrix shows no per-fire effect.

## Recommendation (for provider-warden; I do not edit src)

1. **Do not write the v3 JSON** for qwen3:4b or cogito:8b. Their two live fields (`optimalToolResultChars`, `systemPromptAttention`) show no lift.
2. **The other moving models were not ablated**: cogito:14b and qwen2.5-coder:7b (2000 → 1000) and gemma4:e4b (2000 → 8000). Keep their committed values until an ablation covers them.
   - cogito:14b is in `STATIC_CAPABILITIES`, so it can be an H3 tier.
   - gemma4:e4b and qwen2.5-coder are not, so the H3 bench voids their cells as fallback context.
3. `steeringCompliance` has no reader. The lift rule allows writing v3 values for it alone, since they change no behavior. Until a reader exists that is churn; my advice is to hold it.
4. **Defect, fix before any regeneration**: `calibration-runner.ts --commit` writes only what `runProbes` returns.
   - That drops `actOrAnswer`, `classifierReliability` and the alias maps from the committed file.
   - On qwen3:4b (`retry`) and cogito:8b (`proactive`) it would silently remove the act-or-answer prior, which has its own A/B evidence.
   - `build-candidates.ts` shows the merge the runner should do.
5. **Defect**: on qwen3:14b the runner does not finish 3 runs in 586 s. The likely cause, not measured per probe, is the thinking model on the 10-turn attention probe and the 8000-char ladder. Its prior cannot be regenerated inside a 590 s foreground limit. A per-probe timeout or per-probe progress output would fix this.
6. Re-gate only with more power. To see a 10 pp effect on rw-2/rw-3-style tasks, use n ≥ 8 per cell. Also use a task set where results over 2000 chars are common, not 2 tasks of 6.

## Not proven

- The size change never fired without the description change, so their effects cannot be separated. The description change alone (rw-9, h3-required-tools, h3-continuation, h3-exact-value) shows no lift.
- Only 2 of 9 models were measured on the bench. Nothing here speaks to the 1000-char values.
- n = 3 per cell: "no measurable effect" is not evidence of equivalence.
