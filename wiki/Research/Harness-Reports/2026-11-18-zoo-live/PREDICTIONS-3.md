---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [zoo, live-validation, predictions, honest-decline, h3]
---

# ab-trap-5 actOrAnswer re-run after the dropped-call decline fix: pre-registered predictions

Written BEFORE any cell of this re-run. PREDICTIONS.md and PREDICTIONS-2.md are unchanged.

Build under test: HEAD `373a12a70`, which contains fix commit `76957e01e` ("honor an honest decline from a turn whose tool call was dropped"; `callsDropped` in `packages/reasoning/src/kernel/loop/honest-decline-exit.ts`). `packages/reasoning/dist/index.js` sha256 `6a3446356802890844de2dda71dae37def9cae5129bab8d925c361d6ac012e1f`, mtime 2026-11-18 20:11:05, contains `callsDropped` (2 hits). Under `bun run` from cwd `packages/benchmarks`, reasoning resolves to `src` (see addendum 2), so src is what runs.

CONFOUND NAMED IN ADVANCE: the working tree is dirty in `packages/reasoning` (kernel-warden concurrent work, uncommitted): `src/kernel/capabilities/act/guard.ts` diff (hash of `git diff packages/reasoning` = `0b2afcc80eab`) changes `duplicateGuard`'s hint text only, adding "Read <entity> first" / "Not done yet." when a listed input is unread. It does not touch the exit gate or honest-decline path. If a run's trace shows that hint text, I flag the run. A verdict is drawn from the decline path, not from that text.

Runner: `bench:drive`, `src/spikes/h3-extra-tiers.ts`, gemma4:e4b, task `ab-trap-5`, arms `RA_ACT_OR_ANSWER` 0 (off) vs 1 (on), k=5 per arm, cell timeout 180 s, arms interleaved. `ollama ps` checked for foreign models before the drive.

## Prediction

| Cell | Fix under test | Off (predicted) | On (predicted) | Proximal prediction |
| --- | --- | --- | --- | --- |
| F1b | decline written in a turn whose call batch was dropped is read by `honestDeclineOf` | 5/5 (prior 5/5, 5/5) | 4/5 or 5/5 | `dispatcher-early-stop` 0 to 1 of 5 on-arm (was 3/5); no run with output "I cannot determine" scored 0 / status `failure`; forced retry 0/5 |

## Decision rule (same as PREDICTIONS-2)

- Non-inferior: on solved >= off solved - 1.
- Hurt: on solved <= off solved - 3, or exact McNemar / Fisher two-sided p < .05 with on worse.
- on = off - 2: inconclusive, not pass.
- Root cause confirmed only if the proximal metric moves (early-stop count on-arm). Solve-rate null with proximal unmoved = not confirmed.

## If on stays at 3/5 or below

Suspect, in order: (1) the second outstanding item in the exit gate (`proposeExit` outstanding list: "write the final answer" deny-once) denies the decline once, then the next turn's decline-plus-call is dropped again; (2) another path that discards the decline. I will run `rax-diagnose cause` on each failure and state whether the decline text is still lost and where.

## Power

k=5 per arm, one model, one task: only 5-v-0 or 5-v-1 splits reach p < .05; gaps under about 40pp are noise. Single tier: no KEEP/adopt claim possible.
