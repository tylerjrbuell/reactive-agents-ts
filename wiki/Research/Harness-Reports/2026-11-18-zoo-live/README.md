---
type: harness-report
status: complete
created: 2026-11-18
tags: [zoo, live-validation, root-cause, leanFinalTurn, actOrAnswer, parallelToolHint, regression, h3]
---

# Zoo live validation and root causes

Pre-registration: [PREDICTIONS.md](PREDICTIONS.md) (written before any non-smoke cell). Build: reasoning dist hash `86c61c75…` (contains a93c6dd46 + 4b3c33c64, verified by string grep; recorded in every results file's provenance), gitSha 4b3c33c64. Driver: `bench:drive` + `src/spikes/h3-extra-tiers.ts` (adds gemma4:e4b). 145 cells, 0 failed units, 0 timeouts, no SIGKILL. Paired seeds are NOT available (Ollama sampling is unseeded): arms are interleaved back to back per (run, task) and b/c are discordant counts over that pairing, not replays. Foreign model `mimo-v2.6` was never loaded (`ollama ps` empty before every drive); `--allow-contention` was needed only because of a driver bug (below).

## A. Prediction vs observation

Tables: [f123-gemma-table.txt](f123-gemma-table.txt), [f45-cogito-table.txt](f45-cogito-table.txt), [regression-table.txt](regression-table.txt). b = off solved, arm failed; c = arm solved, off failed.

| # | Cell | Zoo | Live (k=5/arm) | b,c | tok/run (off>arm) | tok/solved | turns | Agree |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | gemma ab-trap-5, actOrAnswer | INERT (honest-decline fix) | 5/5 vs 2/5; `act-or-answer:redirect` fired 5/5, 3/5 ended `dispatcher-early-stop` (scored 0, text was an honest decline) | 3,0 | 2418>4519 | 2418>11298 | 3.4>4.0 | NO |
| 2 | gemma h3-exact-value, leanFinalTurn | NEUTRAL | 5/5 vs 1/5 (p=0.048); lean fired 5/5; 4 runs ended "I still need to read b.json" | 4,0 | 2425>1543 | 2425>7715 | 3.0>2.4 | NO |
| 3 | gemma h3-todo-heavy, parallelToolHint | HELPS (turns 10>3, -68% tok) | 5/5 vs 5/5; turns 13.0>3.0; multi-call turns 0>10 | 0,0 | 21362>6403 (-70%) | same | 13>3 | YES |
| 4a | cogito rw-6, actOrAnswer | HELPS | 3/5 vs 5/5 (p=0.44); never-engaged 2>0; redirect 5/5 | 0,2 | 7098>6551 | 11830>6551 | 5.6>3.2 | yes (direction, proximal) |
| 4b | cogito rw-7, actOrAnswer | HELPS | 0/5 vs 0/5; acc 0.27>0.40; redirect 5/5 | 0,0 | 18500>19284 | n/a | 10.4>8.6 | undecidable (floor) |
| 5 | cogito+qwen rw-6 default, D2 | advisory only | D2 projection verdicts: 0 in 15 runs; no label changed because of D2 | n/a | n/a | n/a | n/a | inert |

Other arms as free controls: pth and lft never touched ab-trap-5 (lean 0/5 fired, multi-call 0), yet scored 4/5 and 4/5, so off 5/5 there is at the lucky end; pooled inert arms are 14/15 vs aoa 2/5 (post hoc p about 0.03). Family 3 side effect: pth also cut exact-value turns 3>2 and tokens 2425>1950 at 5/5.

### Family 5: every rw-6 run whose label changed or carried figures (read in full)

cogito off: r2 "22% reduction in execution time, 7.7% reduction in memory" (invented, no code-execute ran) labelled success-with-warning; r1 "1234ms / 256MB" rejected by the verifier but the hidden check still scored passed=true. aoa: r1 (34%, 65%, 28%), r3 (table of 18.3-18.5%), r4 (15-16%) all invented, all success-with-warning, all solved. qwen: r2 "57% reduction", r3 "90% less memory", r4 "69-71% faster" invented, success-with-warning, solved; r1 "2.3s ... 0.8s" rejected. So 7 of 15 runs ended success with invented benchmark figures. Cause is pre-existing and not D2: `evidence-grounding.ts:306` makes a bare percent never `hard` (warn only), and the rw-6 hidden check grades the file artifact only (task comment `real-world.ts:1054-1059`: the behavioral half "remains with the judge rubrics", which H3 strips). The "+40pp" for aoa on rw-6 is therefore partly grader blindness: clean honest runs are 1/5 off (r0) vs 2/5 aoa.

### Power

Single task k=5: only a 5-v-0/5-v-1 split reaches p<0.05 (family 2 did, p=0.048). Gaps under about 40pp on one task are noise (SE about 22pp). Family 3 is well powered because turns/tokens are near-deterministic. Families 1, 4 are not powered for outcome; their evidence is the mechanism visible in traces. A null is "not harmful beyond about 40pp", never "equal". No paired seeds, so common-random-number variance reduction was impossible.

### Regression (cogito:8b, 12 tasks, k=5, default path, 60 cells)

27/60 solved, accuracy 0.725 vs baseline 57/120 solved, 0.743 (final+rerun pooled, scorer v2 via rescore.json rows; raw old scores not compared). Tokens/run 5623 vs 6180 (-9%). 0 non-pass cells. Per-task moves inside noise: rw-9 4/5 vs 10/10 (r0 fabricated prices wrong-answer, r2 output empty, a model-side miss, no new guard fired), h3-todo-heavy 0/5 vs 1/10, rw-7 acc 0.07 vs 0.27 (floor task). ab-trap-5 5/5 abstained as before. MDE at this size about 11pp accuracy (audit 03): no regression detectable. qwen3:4b not run (time; qwen rw-6 was used for family 5).

## B. Root causes

### B1. leanFinalTurn (fails after the 4b3c33c64 gate fix)

1. Intent and assumption: once the run contract's tool work is settled and every named input was touched, a tool-less, no-thinking turn writes the answer cheaper. Assumption: contract coverage plus "all named inputs read" implies the model has all it needs, so removing tools costs nothing.
2. Observed shape: run `01M7R8TYD6SDJ4HJJEC9R4541P` (smoke) and f123 lft r1, r2, r3, r4 (`traces/lft/gemma4_e4b/ra-default/h3-exact-value/run{1..4}`): file-read a.json, `lean_final_turn:redirect` at actions=1 with `toolsShipped: []`, reply "The count from a.json is 412. I still need to read b.json", exit gate accepts (`end_turn`), run ends success, scored wrong-answer. r3 replied just "412".
3. Why the fix did not work (instrument-adjacent but real): `unreadNamedInputs` returned `[]` on the run's task text. The bench (and any user) passes absolute paths; the work dir is `.../.bench-run-<pid>-<hash>/a.json`. `FILE_TOKEN` (`lean-final-turn.ts:70`) allows `[/.][\w-]+` segments, so a dot-leading directory (`/.bench-run-…`, also `~/.config`, `./.env.local`) kills every match: zero tokens extracted, `unread.length === 0` read as "all inputs read". Verified zero-token: old regex on the real task text gives `[]`, `[/.]\.?[\w-]+` gives both paths. Two defects: the regex, and the fail-open reading of "nothing extracted". The zoo used plain `a.json` text, so it could not see it. Second assumption failure for small local models: a tool-less turn is a terminal commitment (the exit gate accepts any non-empty reply) while the model knows it is incomplete ("I still need…"); the lever removed the only escape hatch.
4. Ranked hypotheses:
   - H-L1 (fix the extractor, fail closed). Allow dot-segments and `~`; when the task has a tool-coverage requirement and zero inputs were extracted, do not take the lean turn unless the contract itself enumerates inputs. Zoo shape to add first: `unread-input-abspath` (same two-file task, workdir path with a dot-directory, plus a `~/.cfg/a.json` variant); disproves/proves before any live cell. Predicted: lean arm returns to the off solve rate (5/5), lean fires 0 times on 1-read states, tokens about -9% on gemma at best (prior ablation). Cheapest live test: gemma h3-exact-value lft vs off k=5, 10 cells, about 2 minutes.
   - H-L2 (make the lean turn a verified commit). A tool-less reply may terminate only if it does not name an unread input or an unmet-need phrase; otherwise restore tools for one turn. Deterministic check: reply mentions a task-named file never touched. Complements H-L1 for extraction misses of any kind. Zoo shape: `lean-reply-names-unread` (policy replies "I still need b.json" on the lean turn). Predicted: recovers the 4 failures at +1 turn. Note 62cf0c857 reverted a `detectContinuationIntent` variant for 0 firings and missing the observed text; keying on unread-input names is a different, data-bound signal.
   - H-L3 (change what is removed). Keep tools on the wire, drop only thinking and the thinking budget (`RA_LEAN_THINKING`-style). Escape hatch preserved; saving is the thinking share only. Zoo shape: reuse `unread-input-abspath`; expected outcome neutral by construction, savings need the live arm. Cheapest test: the same 10 cells with lean-thinking vs off.
   Ranking: H-L1 first (root, cheap, deterministic), H-L2 second (defense in depth), H-L3 only if the token saving of H-L1 is too small to matter.

### B2. actOrAnswer after an honest decline (live disagrees with the zoo)

1. Intent: one forced `toolChoice: required` retry after a no-call turn while tool work is outstanding (zoo HELPS on no-call-stall). Assumption: a no-call turn with outstanding tool work is a stall. The fix (`declineSettlesOutstanding`) carves out "decline after an always-failing required tool".
2. Observed: gemma ab-trap-5 aoa r0, r3, r4 (`traces/aoa/gemma4_e4b/ra-default/ab-trap-5/run{0,3,4}`). Sequence: file-read fails once (ENOENT) at i0; i1 text "I cannot determine the total…"; `act-or-answer:redirect result=called` forces a second read; two failures; nudge ignored; `dispatcher_early_stop` terminates `status=failure`, scored 0. Redirect fired 5/5; off arm ends `abstained` 5/5 with 1927-3048 tokens.
3. Why: `honest-decline-exit.ts:33` `MIN_FAILED_CALLS = 2`. The model declines after ONE failure, so `declineSettlesOutstanding` is false and the retry fires. An ENOENT is a permanent error class; two calls are not needed to know. The zoo shape (`honest-decline.ts`) declines after 3 failures (`failures < 3`), so it never produced the one-failure decline. Second, unresolved: in r0, r3, r4 the later `honestDeclineOf` did not convert the dispatcher stop into `abstained` although the tool had failed twice and the model's last text was a decline; in lft r4 and others the same exit did convert. Lead: the decline text sits in a turn that also carries (now dropped, `pending_batch:dropped`) call ids, and `latestTextAfterEvidence` skips thoughts with `callIds.length > 0` (`honest-decline-exit.ts:45`). Not confirmed; needs a state-level replay.
4. Hypotheses:
   - H-A1 classify errors: permanent (ENOENT, "no such file", 404, "not found", permission denied) settle after 1 failed call. Zoo: parameterize `honest-decline` with `declineAfter` and error text; add `honest-decline-after-1`. Predicted: aoa arm 2/5 to about 5/5, tokens back to off. Live test: gemma ab-trap-5 aoa vs off k=5, about 4 minutes.
   - H-A2 skip the forced call when the previous turn was a decline AND a failed attempt exists for each outstanding tool, regardless of count; the model's text is evidence. Same shape. Predicted same, slightly wider.
   - H-A3 repair the post-dispatcher resolution: honor a decline text from a turn whose call batch was dropped. Zoo shape `decline-after-ignored-nudge` (decline, forced read, nudge, decline, early stop). Predicted: dispatcher-early-stop with honest text becomes `abstained` in the 3 observed runs. Cheapest test: trace-state replay (zero token) of aoa r0, r3, r4 before any live cell.

### B3. rw-6 fabricated benchmark figures (not D2)

D2 never fired (0/15). The live problem: invented percent benchmarks pass. Hypothesis H-F1: a percent claim in a comparative sentence ("reduction in execution time", "faster") is `hard` when no measurement-capable tool (code-execute, shell) ran in the whole run; condition is deterministic on the executed tool set. Zoo shape: `fabrication-veto-percent` (fixture-read plus file-write only, answer "34% faster"). Predicted: 7/15 runs become verifier-reject; rw-6 solved falls to the honest rate (about 1-2/5), a real score change that must be re-baselined. H-F2: add the behavioral half to the H3 rw-6 grader from the trace (executed tools ∩ measurement tools = ∅ and figure present), so "solved" stops counting fabrication. Cheapest test: zero-token regrade of the 15 traces here.

## C. Missing raw measurements (to steer mechanisms automatically)

1. Shadow fire: evaluate each mechanism's trigger (`decideLeanFinalTurn`, act-or-answer eligibility) on every turn of the OFF arm and emit `would-fire` with its inputs. Gives a free, truly paired counterfactual (did the off-arm model need another tool after the would-fire point?) and a trigger census with no live arm. Highest value.
2. Trigger decision inputs in the guard record: `inputsExtracted`, `inputsUnread`, `failedCalls`, `declineTextSeen`, `settledBy`. Every failing lean run would have shown `inputsExtracted: 0`; every failing aoa run `failedCalls: 1 < 2`.
3. Outcome of a tool-less turn: whether the run terminated on that reply, reply length, whether it names an unread input. Today the lean record has no outcome.
4. Extraction fail-open sentinel: any deterministic extractor returning empty on a task with tool requirements should emit a warn event.
5. Behavioral fabrication count from the trace in the scorer (invented figures with no measurement tool): H3 "solved" currently hides it.
6. Per-cell `preflight` should record the foreign-client PID set so the driver's own socket is not a finding.
7. Seeded sampling per cell (not available in Ollama path today).

## D. Driver bugs (report only; `packages/benchmarks/src/driver/**` untouched)

1. Supervisor self-contention. `checkContention` counts ESTABLISHED sockets on :11434 from `/proc/net/tcp` (`preflight-provenance.ts:98`); the supervisor's own keep-alive fetch from its previous preflight is counted, and the run-h3 child preflight sees it too. lsof showed the only client was the supervisor pid. The first smoke paused forever (`pauses: 1`). Worked around with `allowContention: true` in every spec, so real foreign-client detection was off during the drive; I checked `ollama ps` and `lsof` manually before each drive. Every cell's provenance carries `preflight ok:false allowed:true` noise. Fix: exclude own pid (ss -p / lsof) or close the socket (`Connection: close`).
2. Tier set is closed: gemma4:e4b needed a wrapper via `runnerCmd` (`src/spikes/h3-extra-tiers.ts`). The `H3_TIERS` comment claiming gemma4:e4b resolves "fallback" is stale (trace shows `numCtxSource: profile`, 32768).
3. Otherwise end-to-end clean: 5 drives, resume-safe state file, interleaved arms, no SIGKILL, per-arm `RA_*` env recorded in provenance `raEnv`. `eta` printed `unknown` until the first unit completed.

## E. Did the measurement harness give real improvement signal?

- Agreed, veto/lift-grade: parallelToolHint (zoo turns 10>3 / -68% tok; live 13>3 / -70%, 5/5 both). Zoo no-call-stall HELPS agreed on the proximal metric (never-engaged 2>0, fired 5/5) but outcome is undecidable at this power.
- Disagreed (calibration data for the simulator): (a) leanFinalTurn on unread-input shapes: zoo NEUTRAL, live HURTS; parameter: shape task text must carry an absolute path with a dot-directory (bench-realistic), plus a lean reply that "asks for more". (b) actOrAnswer on honest-decline: zoo INERT, live 5/5 forced and 3/5 early-stop; parameter: `declineAfter` 3 in the shape, 1 in gemma4:e4b (observed 5/5), plus ignored-nudge continuation. Both disagreements were shape-fidelity faults, found because live ran the real bench prompt. The zoo is veto-grade only for what its shapes copy from the real prompt; each shape needs its prompt text copied verbatim from the bench task after path rewriting.
- Neither could decide: rw-7 (0/5 floor on both), aoa on rw-6 outcome (p=0.44 and the grader cannot see fabrication), lean token saving where it is safe (the lever never fires on todo-heavy, 0/5).
- Net: the first live cell after the "fix" found two root causes in minutes (smoke trace, 1 cell). Zero-token verification of both is already possible (regex check above). Next step is the shape fixes, then re-run families 1 and 2 (10 cells each).

Artifacts: `f123-gemma/`, `f45-cogito/`, `f5-qwen/`, `reg-cogito/` (results JSON per arm, traces, driver state), spec files, `regression-compare.ts`, ledger entries appended (6, `improvement-ledger.json`), analysis helpers `packages/benchmarks/src/spikes/zoo-live-analyze.ts` and `h3-extra-tiers.ts`.
