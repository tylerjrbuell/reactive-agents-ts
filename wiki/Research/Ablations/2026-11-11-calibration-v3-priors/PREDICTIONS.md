---
type: experiment
status: active
created: 2026-11-11
tags: [ablation, calibration, pre-registration]
---

# Calibration v3 priors: decision rule (written before any live cell ran)

## What moves for the gate tiers (from the v3 runner, 5 runs each)

| model | field | committed (v2) | candidate (v3) | live reader |
|---|---|---|---|---|
| qwen3:4b | optimalToolResultChars | 2000 | 8000 | `ContextProfile.toolResultMaxChars` via `selectAdapter` profileOverrides (kernel runner): the tool-result compression budget |
| qwen3:4b | systemPromptAttention | strong | moderate | `final-answer` tool description pruning (`packages/tools/src/skills/final-answer.ts`, via `tool-schemas.ts`) |
| qwen3:4b | steeringCompliance | hybrid | user-message | none |
| cogito:8b | optimalToolResultChars | 2000 | 8000 | as above |
| cogito:8b | systemPromptAttention | strong | moderate | as above |
| cogito:8b | steeringCompliance | hybrid | system-prompt | none |

Unchanged for both: parallelCallCapability, observationHandling, toolCallDialect, actOrAnswer.

## Firing

- `toolResultMaxChars` changes behavior only on a tool result over 2000 chars. In the frozen H3 suite only rw-2 (`sales-data.csv`, 2533 chars) and rw-3 (`employees.csv`, 2938 chars) have such a fixture. On those, the committed arm sees a preview plus a recall key; the candidate arm sees the whole file.
- `systemPromptAttention: moderate` changes the final-answer tool description on every run that ships `final-answer`.
- Offline census (`census-offline.txt`): no recorded qwen3:4b or cogito:8b run had a non-meta tool result over 2000 chars. The size change is a rare-path change outside rw-2/rw-3-style tasks.

## Matrix

- Tiers: qwen3:4b, cogito:8b (H3 static tiers).
- Tasks (frozen H3): rw-2, rw-3 (size change fires), h3-exact-value, h3-continuation, h3-required-tools, rw-9 (only the description change fires).
- k = 3 runs per arm per task per tier, arms alternated per run index. 72 cells.
- Code pinned: `git archive` snapshot at the HEAD in `~/.reactive-agents/ablations/2026-11-11-calibration-v3-priors/HEAD.txt`, served by `arm-plugin.ts`. The arms differ only in `RA_ABL_CAL_DIR`.

## Decision rule

1. Verdict = coded gate (`evaluateLiftGate`, `DEFAULT_LIFT_POLICY`), baseline `committed`, candidate `candidate`. Ollama tiers token-free (owner ruling 2026-11-06); the raw token delta is reported anyway, since a larger budget costs context.
2. `default-on` -> PASS: provider-warden writes the candidate JSON.
3. `opt-in` -> do not replace the committed JSON for the moving fields. Calibration data has no opt-in switch, so OPT-IN here means "no promotion"; the v3 values may ship only for fields with no live reader, or wait for a better-powered run.
4. `reject` -> REWORK of the field that regressed.
5. `underpowered` -> rerun more runs; never read as no effect.
6. Secondary (not gated): on rw-2/rw-3, the candidate arm should show fewer `result-truncated` ledger entries. If it does not, the size change did not fire and the run says nothing about it.

## Prediction

Most likely OPT-IN (no tier clears the 95 % band at n = 3 per cell; per-cell SE is about 25 pp). Direction guess: rw-2/rw-3 up a little on cogito:8b (whole CSV inline), flat elsewhere; raw tokens up on rw-2/rw-3.
