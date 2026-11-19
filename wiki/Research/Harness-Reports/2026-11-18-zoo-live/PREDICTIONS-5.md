---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [zoo, live-validation, predictions, honest-decline, duplicate-guard, h3]
---

# Decline-over-dead-tool fix + range-expanded refusal: pre-registered predictions (addendum 5)

Written BEFORE any cell. PREDICTIONS.md, -2, -3, -4 unchanged.

Build: HEAD `66531b6427ec` (contains `d15d076d0` decline judged on unfiltered missing-required, `66531b642` deriveListedInputs expands numbered ranges). `git status` clean. `packages/reasoning/dist/index.js` sha256 `44afda35c33bb8ee7762505a91dd37f9cfdd349a76660ae8be41107ee52bc37b`, mtime Nov 18 20:36; contains `no-missing-required` (1) and `expandNumberedRange` (2). Bench resolves reasoning from `src`. `ollama ps` empty before start. One `bench:drive` supervisor at a time. Cell timeout 180 s, runner `src/spikes/h3-extra-tiers.ts`. Scanner `a4-trace-scan.ts` reused.

## Family A: ab-trap-5, gemma4:e4b, `RA_ACT_OR_ANSWER` 0 vs 1, k=10 per arm

Prior (addendum 4, k=5): off 5/5, aoa 4/5; the one loss had `declineCheck.rejectedBy = tool-viable` with `missingTools: []`.

| Arm | Predicted solved | Proximal |
| --- | --- | --- |
| off | 9-10/10 | decline-scored-0: 0-1 of 10 |
| aoa | 9-10/10 | decline-scored-0: 0-1 of 10 |

Rule: confirmed if decline-scored-0 (`honest-decline-mislabeled`) across both arms <= 1 of 20 AND each arm >= 8/10. Refuted if >= 3 of 20 lose that way, or any lost decline still shows `rejectedBy: tool-viable`. Between: underpowered. Any remaining loss: report `declineCheck.rejectedBy`.

## Family B: cogito:8b, default arm

| Cell | k | Baseline | Predicted |
| --- | --- | --- | --- |
| h3-todo-heavy | 10 | 0/10 (addendum 4); 3/15 pooled earlier | solved 1-3/10; refusal fires 4-7 of 10; named input is the first unread file (e.g. notes-2) in >= 80% of fired; model reads it after refusal in >= 4 of fired |
| h3-exact-value | 5 | 5/5 | >= 4/5 |
| h3-required-tools | 5 | no prior in this series | >= 4/5; flag regression if <= 3/5 |

Decision rules (todo-heavy), read from trace text, not labels:
- Confirmed: refusal-fired >= 3 AND >= 1/3 of them solved AND overall solved >= 4/10.
- Refuted: refusal-fired >= 3, names the correct first-unread input in them, and overall <= 1/10 (the hint alone is not enough).
- Underpowered: refusal fires < 3, or solved 2-3/10 mixed.
Scanner's "named input" is checked against the true first unread file (reconstruct from file-read calls before the refusal), not only that a name appears.
Failures classified with `rax-diagnose cause`.

Power: k=10 Bernoulli SE ~13-15pp; one model per family; no KEEP claim. Verdict words: confirmed / refuted / underpowered.

## If todo-heavy stays 0-1/10 (stated now)

Ranked hypotheses, each with a zero-token zoo shape (to be filled in the README after data):
1. Write-before-read: model writes out-N before reading notes-N; a gate refusing `file-write` of an output whose source is unread (ablation-gated) is the candidate.
2. Premature final answer after 2-3 iterations (run1/run7 shape): no refusal ever fires; exit gate coverage of listed inputs.
3. Stall-after-work (run9 shape): all reads/writes done but wrong values; verification of written values vs read values.
