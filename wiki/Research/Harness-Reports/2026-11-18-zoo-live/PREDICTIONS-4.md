---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [zoo, live-validation, predictions, honest-decline, duplicate-guard, h3]
---

# Live gate + refusal fixes: pre-registered predictions (addendum 4)

Written BEFORE any cell. PREDICTIONS.md, -2, -3 unchanged.

Build: HEAD `dd307bab7` (contains `76957e01e` dropped-call decline, `f08652b1a` refusal names unread input, `dd307bab7` heuristic outstanding non-blocking + `exit_gate.declineCheck`). `git status` shows no uncommitted change under `packages/reasoning` (only apps/docs and wiki files). `packages/reasoning/dist/index.js` sha256 `e574369b3d3204561a5adcbd8181cf341bcde52f9c54bdd01ec6ac1bde44d4a0`, mtime Nov 18 20:25; contains `blocking-outstanding` (1) and `listed input you have not read yet` (1). Bench runs resolve reasoning from `src` (same strings present in src: `honest-decline-exit.ts`, `act/guard.ts`). `ollama ps` empty before start. One `bench:drive` supervisor at a time. Cell timeout 180 s, runner `src/spikes/h3-extra-tiers.ts`.

## Family A: ab-trap-5, gemma4:e4b, `RA_ACT_OR_ANSWER` 0 vs 1, k=5 per arm

Prior (addendum 3): off 4/5, on 4/5; one `dispatcher-early-stop` decline scored 0 per arm. Both failures: gate 1 `deny-once` with heuristic `CALL_NARRATION` item, then gate 2 `handoff`.

| Arm | Predicted solved | Proximal prediction |
| --- | --- | --- |
| off | 5/5 (4/5 acceptable) | decline-scored-0 runs: 0 of 5 |
| on | 5/5 (4/5 acceptable) | decline-scored-0 runs: 0 of 5 |

Rule: fix confirmed if total decline-scored-0 / `dispatcher-early-stop` failures across both arms <= 1 of 10 (was 2 of 10) AND each arm >= 4/5. Refuted if >= 2 of 10 still lose with `rax-diagnose` label `honest-decline-mislabeled`. Between: underpowered (k=5 cannot separate 2/10 from 1/10; only 0/10 is a strong signal). Any remaining decline loss: read `exit_gate.declineCheck.rejectedBy` from the trace and report it.

## Family B: cogito:8b, default arm

| Cell | k | Baseline | Predicted |
| --- | --- | --- | --- |
| h3-todo-heavy | 10 | 3/15 pooled final+rerun (20%); 1/10 and 0/5 in rescore/reg-cogito; 0/8 when `duplicateGuard` refusal fired, 3/7 without | solved 3-5/10; refusal fired in 4-7 of 10 runs; >= 80% of fired refusals name an unread input; solved among refusal-fired runs >= 1 |
| h3-exact-value | 5 | 9/10 rescored base, 5/5 reg-cogito | >= 4/5 (no regression) |

Decision rules (todo-heavy):
- Confirmed: refusal-fired runs >= 3 AND >= 1/3 of them solved (baseline 0/8) AND overall solved >= 4/10.
- Refuted: refusal-fired runs >= 3, refusal names an unread input in them, and 0 of them solved (the text lands but the model still skips the read), or overall <= 1/10.
- Underpowered: refusal fires in < 3 runs (cannot test), or solved 2-3/10 with mixed signal. Selection caveat stands: refusals occur in already-looping runs.
- Refusal-fired and "names an unread input" are read from the trace text (`Already done - do NOT repeat` plus `Read <file> first`), not from labels.
- exact-value regression: solved <= 3/5 = regression flag.

tokens/solved reported for todo-heavy; no pre-registered token threshold (cell is mostly unsolved at baseline, so the ratio is undefined there).

## Power

todo-heavy k=10 Bernoulli SE about 13-15pp; gaps under about 30pp are noise. One model, one task each: no KEEP claim. Verdict words are limited to confirmed / refuted / underpowered.

## Next-fix hypotheses (stated now, to avoid post-hoc choice)

- If the decline loss remains: the `declineCheck.rejectedBy` value names the clause; fix that clause.
- If the refusal names an input but the model still writes without reading: the refusal text is guidance only; the next candidate is the exit gate refusing writes to an output whose source is unread (extends the inputCoverage idea, ablation-gated).
