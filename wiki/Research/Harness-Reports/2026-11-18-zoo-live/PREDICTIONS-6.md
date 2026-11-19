---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [zoo, live-validation, predictions, duplicate-guard, pending-write, h3]
---

# Duplicate refusal leads with the pending write: pre-registered predictions (addendum 6)

Written BEFORE any live cell. PREDICTIONS.md through -5 unchanged.

Build: HEAD `132ae5515d85` (contains `132ae5515` refusal leads with the pending write). Working tree has only the new sim shape `pending-write` (benchmarks) uncommitted; no `packages/reasoning` change. `packages/reasoning/dist/index.js` sha256 `31327ebf965c8cef416ac5bf6cd6814ee7110fddb793a5955182643e51e02767`, mtime Nov 18 20:49, contains `do not re-read it` (1). The sim and the bench runner resolve `@reactive-agents/reasoning` to `packages/reasoning/src/index.ts` (sim header: "kernel source: packages/reasoning/src last changed at 132ae5515 (HEAD 132ae5515), clean"). `ollama ps` empty before start. One `bench:drive` supervisor at a time; cell timeout 180 s; runner `src/spikes/h3-extra-tiers.ts`; env `RA_ACT_OR_ANSWER=0 RA_LEAN_FINAL_TURN=0 RA_PARALLEL_TOOL_HINT=0`, default arm.

Zero-token precursor: shape `pending-write` (`packages/benchmarks/src/sim/shapes/pending-write.ts`, test `tests/sim/shape-pending-write.test.ts`) passes: the refusal reads "Write .../out-2.txt now from the value you just read in .../notes-2.txt: do not re-read it. Then read notes-3", the scripted policy that writes next completes all six pairs exact. It pins the text, not the live model.

## Family B: cogito:8b, default arm

Baseline (addendum 5, `66531b642`): h3-todo-heavy 0/10; cause A in 6 of 10 runs; refusal fired 7/10.

| Cell | k | Baseline | Predicted |
| --- | --- | --- | --- |
| h3-todo-heavy | 10 | 0/10 | solved 2-4/10; cause A runs <= 2 of 10; refusal still fires 4-7 of 10 |
| h3-exact-value | 5 | 5/5 | >= 4/5 |
| h3-todo-heavy, gemma4:e4b | 5 | 5/5 (zoo row 3, parallelToolHint arms) | >= 4/5 |

Cause classification (same as addendum 5, read from `file-read`/`file-write` order and write contents, not from labels): A = read N, no write out-N, re-read refused, outputs shift by one; B = placeholder content (`doubled_value`); C = write before read; D = arithmetic on derived output. A run is cause A when out-N holds the double of notes-(N+1) after a refused re-read of notes-N.

## Decision rule (todo-heavy, cogito)

- Confirmed: solved >= 2/10 AND cause A runs <= 2 of 10.
- Refuted: otherwise (solved <= 1/10, or cause A runs >= 3).
- If cause A drops to <= 2 but solved stays <= 1/10, the fix is "mechanically confirmed, not sufficient": the remaining causes (B, C, D) are ranked with zero-token shapes in the README.

No-regression: exact-value >= 4/5 and gemma todo-heavy >= 4/5; below that is flagged, with the failing runs read before any attribution.

Power: k=10 Bernoulli, SE ~13-15pp; k=5 SE ~20pp; one model per family. No KEEP claim; verdict words confirmed / refuted / underpowered.
