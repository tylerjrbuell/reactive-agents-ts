---
type: harness-report
status: complete
created: 2026-11-18
tags: [code-execute, retry-guide, call-success, suite-v2, live-validation, addendum-8]
---

# Addendum 8: does the code-execute retry guide raise call success?

Pre-registration: [PREDICTIONS-8.md](PREDICTIONS-8.md) (written 22:46, before the first result file at 22:48). Prior: [arithmetic-lever census](../2026-11-19-arithmetic-lever-census/README.md), [zoo-live addendum 7](../2026-11-18-zoo-live/README.md). Change under test: `3402eb775` (`CODE_RETRY_GUIDE`, `packages/tools/src/skills/code-execution.ts:69`). Specs `*.spec.json`, results `c-rt c-v2 q-v2 g-rw7`, per-run tables `*.scan.txt`, scanner `ce-scan.ts`.

## Run integrity (read first)

- DEVIATION, my fault: I started c-v2, q-v2 and g-rw7 from one loop whose wait timed out, so three supervisors overlapped for a few minutes. I stopped two, deleted all three result dirs, and re-ran each alone. The reported c-v2, q-v2, g-rw7 results are from the sequential re-runs. c-rt (cogito `h3-required-tools` k=10) ran alone, first.
- Contamination, flagged as asked: HEAD moved during the run (other session). Cells carry `gitSha`: c-rt `3402eb775`, c-v2 `8815b8a22`, q-v2 `96d4b5750`, g-rw7 `6df9c621f`. Commits that touched `packages/reasoning/src` while cells ran: `747b05e5f` (23:06, RunEnvelope model facet), `ee18ee5b2` (23:27, reflexion final pass), `02b802193` (23:36, code-action approval). Tree was clean (no uncommitted edits) at start and end; reasoning src last-changed SHA went `a6b0f8844` to `02b802193`. `packages/tools/src` did not change after `3402eb775` (git log for that path ends at it), so the guide text is the same on every cell. None of the reasoning commits is on the react or plan-execute tool-failure path I can identify, but I did not prove that; cells after 23:06 (late c-v2, all of q-v2 and g-rw7) straddle reasoning SHAs. Treat as same-guide, not same-kernel.
- `ollama ps` empty at start. Host load 3 to 5 on 6 CPUs; `allowContention` set. One unrelated dev stack was running earlier in the day, not loaded this time.

## Definitions as pre-registered, plus one I had to add

"Value returned" in the pre-registration is: `executed:true` with non-null `result` or non-empty `output`. Reading the calls, that definition passes calls that are not calculations (a string literal, an inline-sorted list, hard-coded constants). So the table gives both: loose (the pre-registered text, scanner `valuedRuns`) and strict (a call that computes the answer figure from data inlined in the code). Strict is my reading, added after seeing the runs; the verdict states both. Engaged = at least 1 `code-execute` call (`tool-call-start`).

## Results, Part 1 (code-execute offered)

| Tier / task | k | Solved | Engaged runs | Loose value-returned runs | Strict | Calls (failed, never executed) |
| --- | --- | --- | --- | --- | --- | --- |
| cogito:8b h3-required-tools | 10 | 0 | 3 | 0 | 0 | 3 (3, 3) |
| cogito:8b rw-2-calc | 5 | 0 | 0 | 0 | 0 | 0 |
| cogito:8b rw-3-calc | 5 | 0 | 0 | 0 | 0 | 0 |
| cogito:8b h3-plan-only-calc | 5 | 0 | 2 | 2 | 0 | 47 (44, 43) |
| qwen3:4b h3-required-tools | 5 | 5 | 2 | 1 | 1 | 4 (3, 2) |
| qwen3:4b rw-2-calc | 5 | 0 | 0 | 0 | 0 | 0 |
| qwen3:4b rw-3-calc | 5 | 2 | 0 | 0 | 0 | 0 |
| qwen3:4b h3-plan-only-calc | 5 | 4 | 1 | 1 | 1 (figure not used correctly: run solved=false) | 1 (0, 0) |
| Pooled | 55 | cogito 0/25, qwen 11/20 | 8 | 4 | 2 | 55 (50 failed, 48 never executed) |

Per-run engaged/value rows are in `c-rt.scan.txt`, `c-v2.scan.txt`, `q-v2.scan.txt` (one line per run with call classes).

What the engaged runs show:
- cogito `h3-required-tools` (3 engaged of 10): each made exactly one python call, got the new guide text ("JavaScript/TypeScript only ... Retry with ... for example `const xs = [3, 5, 9]; ...`. Data must be inline"), and did not call again. Zero retries. Census baseline for this cell: 22 of 52 engaged, 0 valued. Same pattern, now with the guide visible.
- qwen3:4b `h3-required-tools` (2 engaged): both sent python first, both retried in JS with the data inlined as a template string. Run 0 returned `output:"21.83"`, the true mean. Run 1's retry executed but printed nothing (no `return`/`console.log`), so no value. Census baseline for qwen3:4b here: 12 called, 0 valued of 29. This is the only evidence of the guide working: 1 correct value from 2 engaged runs. It is also the model that was already right without the lever (27 of 29 solved).
- cogito `h3-plan-only-calc` run 1: 45 calls, 43 never executed, 178,400 tokens, aborted. The loop is the pasted-unquoted-data class B (`const data = sku,qty SKU-001,26 ...`), the exact thing the guide says not to do. The 2 "valued" calls in it are `return section` and a hard-coded `totalUnits = 1234; skuCount = 56` (fabricated constants returning a plausible figure): loose-valued, worthless. Run 2: first call a `ReferenceError` (ran, not pre-execution), second a correct inline sort of six SKUs; loose-valued, not arithmetic. So the harm seen in addendum 7 (one 30-call loop) recurred (one 45-call loop, larger), unchanged by the guide, no repeat-failure guard in place.
- v2 calc tasks: engagement 3 of 30 runs (cogito 2, qwen 1), vs 1 of 30 in addendum 7. No evidence engagement changed beyond noise; the guide does not touch it.

## Part 2: no-regression (gemma4:e4b, rw-7, k=5)

4 of 5 solved; 31,938 tokens/run; 6 `code-execute` calls over 4 engaged runs (3 never executed: the model sent `language:"typescript"` imports of a test module and bash-style input; 3 ran and failed on `Cannot find module './test.js'`). The failure texts in these runs carry the longer guidance. Run 4 (not solved, 0.67) did not engage at all (`stall-after-work`). NO BASELINE: this task and tier has no earlier same-SHA run in the corpus I could find (`default.json` search of the harness reports returned only this run), so "solved unchanged" and a token delta cannot be computed from data. What can be said: solved is 4/5 (the criterion I pre-stated for the no-baseline case was not below 4/5: met); added guide text is about 60 tokens per failed call, 6 calls, about 0.4k of 31.9k per run, under 2%, an estimate not a measurement. Regression: not shown, not excluded. An actual before/after A/B on rw-7 would need the pre-`3402eb775` tools text, which I did not run.

## Verdict against the pre-registered rule

- Branch 1 (value-returned among engaged runs >= 25%): loose 4 of 8 = 50% (met); strict 2 of 8 = 25% (exactly at the bar); cogito, the model the lever is for, got 0 real values in 5 engaged runs; its 2 loose values are trivial or fabricated.
- Branch 2 (never-executed share of failed calls <= 50%): 48 of 50 = 96% (not met); 5 of 7 = 71% excluding the single loop run, which is about the 73% baseline (not met).
- Pre-registered verdict word: CONFIRMED on branch 1 by the loose definition, but UNDERPOWERED (8 engaged runs, below the 10 I fixed; the interval on 4/8 spans roughly 16% to 84%) and the confirmation is carried by qwen3:4b, a model that did not need the calculator. Branch 2 refuted. By my own stricter reading the result is at the bar with n=8. Honest summary: the guide helped one small model recover after a rejection (2 of 2 retried correctly in form, 1 value), did not change cogito's behaviour at all (gives up after one rejection), and did not shorten or prevent the pathological loop.
- Solved counts (secondary): cogito 0/25, qwen3:4b 11/20, gemma4:e4b rw-7 4/5. No movement on cogito `h3-required-tools` (0/10 vs 0/52 baseline).
- Predictions check: engagement flat (predicted: yes, held); value-returned 15% point guess vs 50% loose / 25% strict (higher than guessed, from small n); never-executed share predicted 60%, observed 96% (71% ex-loop); gemma no-regression 4/5 held, no baseline.

## What this means for L3 (write-time nudge)

The rule's L3 clause: "if engagement is still low but call success rose, L3 is now justified to spike". Engagement is still low (3 of 10 on cogito `h3-required-tools`, 3 of 30 on v2 tasks). Call success rose only on qwen3:4b and cogito did not move. I would not call L3 justified yet: the census showed a nudge raises engagement, but here cogito's engaged runs stop after the first rejection, so more engagement on cogito just produces more single failed calls. Evidence-supported order instead:

1. The cogito give-up-after-one-rejection and the 45-call loop are the two live failure shapes; neither responds to guide text. The loop needs the repeat-failure guard the census put at L2 (the converging-retry carve-out at `packages/reasoning/src/kernel/capabilities/act/guard.ts` around line 532), kernel-warden, ablation-gated. This run adds a second loop run (178k tokens) to the census's one in 141.
2. The class B loop pastes raw CSV as an unquoted literal; the failure text could be made specific to that case (it says the data must be a quoted string; the model did not comply). A tools-warden item, or the Python option (owner decision) if models keep sending Python first: 5 of the 8 engaged runs here opened with a python call.
3. Spike L3 on cogito only after (1) or after a re-measure with a larger engaged n; with n=8 here, a cogito engaged-and-valued rate can be 0 to 40%.

Caveats: one SHA moved under the run; k is small; one weak-model family; qwen plan-only strict value is not verified correct (the run failed its check). No frontier model.

## Instrument notes

- Traces: `code-execute` result is in the `error` field of `tool-call-end` on failure and `result` on success; the scanner classes (`valued`, `never-executed`, `ran-failed`, `repeat-guard`) are re-derived from text, regexes in `ce-scan.ts`. Loose and strict are reconciled by reading each engaged run's calls.
- The scanner's first pass counted a `result:null, output:"(no output)"` call as valued; fixed (escaped-quote bug) and re-run before any number here was taken.
- Wall times: v2 cells up to 300 s; run c-v2 and q-v2 took about 20 minutes each. No driver bug seen other than that the driver has no cross-spec lock: two specs in two outDirs can run two supervisors at once (this is how my overlap happened). Report only, `packages/benchmarks/src/driver/**` untouched.
