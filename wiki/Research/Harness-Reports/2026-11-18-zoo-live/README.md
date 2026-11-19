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

## Addendum 2 (2026-11-19): live re-check after the root-cause fixes

Pre-registration: [PREDICTIONS-2.md](PREDICTIONS-2.md) (mtime before every result file). Build: kernel fix commit `917b865b7`, git SHA `c9ab8d29e` at start (tree clean); reasoning dist sha256 `0ca8c661…` contains `failedWithPermanentError` and `namedInputsExtractable`; no rebuild needed. Under `bun run` with cwd `packages/benchmarks`, `@reactive-agents/reasoning` resolves to `packages/reasoning/src/index.ts` (verified with `import.meta.resolve`), which is at the fix commit, so src and dist agree. 20 cells (2 tasks x 2 arms x k=5), gemma4:e4b, 180 s cell timeout, 0 failed units, 0 timeouts. `allowContention` dropped; `ollama ps` was empty before each drive and showed only gemma4:e4b (our own) afterwards. Tables: [recheck-f1-table.txt](recheck-f1-table.txt), [recheck-f2-table.txt](recheck-f2-table.txt); results in `recheck-f1/`, `recheck-f2/`.

Driver note: running two `bench:drive` supervisors at once makes each pause on the other's connection (correct preflight behavior; I started both by mistake and stopped one). The preflight also still counted the supervisor's own socket: `countOllamaClients` compared the IPv4 client row (`0100007F:port`, /proc/net/tcp) to the server row in /proc/net/tcp6 (v4-mapped `0000000000000000FFFF00000100007F:port`), so 92168c940 never matched on a dual-stack Ollama. Fixed in `packages/benchmarks/src/preflight-provenance.ts` (normalize the mapped form) with a test using the real /proc rows; the run resumed and completed.

### Prediction vs observation (gemma4:e4b, k=5 per arm)

| # | Cell | Predicted off / on | Observed off / on | Proximal predicted | Proximal observed | Agree |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | ab-trap-5, actOrAnswer | 5/5 / 4-5/5 | 5/5 / **2/5** | forced retry 0-1 of 5; no `dispatcher-early-stop` | forced retry **0/5** (was 5/5); `dispatcher-early-stop` in **3/5** on-arm runs | proximal yes, outcome NO |
| F2 | h3-exact-value, leanFinalTurn | 5/5 / 4-5/5 | 5/5 / **5/5** | no "still need" reply; fires only after both reads or never | fired 5/5 at iteration 2, after both reads (`only-answer-outstanding`); 0 "still need" replies | YES |

| Cell | Solved off > on | b,c (off-only, on-only) | McNemar exact p | Fisher p | tok/run off > on | tok/solved off > on | turns off > on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | 5 > 2 | 3,0 | 0.25 | 0.17 | 2616 > 3457 | 2616 > 8644 | 3.6 > 3.8 |
| F2 | 5 > 5 | 0,0 | 1.0 | 1.0 | 2440 > 2262 (-7%) | 2440 > 2262 | 3.0 > 3.0 |

Decision rule (pre-registered): non-inferior = on >= off-1; hurt = on <= off-3 or p<.05 worse. F2: non-inferior. F1: on = off-3, so the **hurt rule is met**, with weak statistics (p 0.17 / 0.25; the rule's solved-count clause fires, its p clause does not).

### Root cause verdict per fix

- **leanFinalTurn (dot-dir extraction, fail closed): CONFIRMED.** Pre-fix 1/5 vs 5/5 (p=0.048) with 4 runs ending "I still need to read b.json"; post-fix 5/5 vs 5/5, the lean turn fires after both reads and the tool-less reply carries the right sum in all 5. Proximal and outcome both moved. Savings are small (-7% tokens on this task). Default-on status unchanged.
- **actOrAnswer (permanent-error decline settles after 1 call): PARTIALLY CONFIRMED, outcome not fixed.** The defect the fix targeted is gone (forced retry after the one-failure decline: 5/5 > 0/5). The 2/5 solve rate is unchanged because a second mechanism ends the run: in on-arm runs 1, 2, 4 the model, after the "repeated-identical-failure" redirect nudge, emitted its honest decline text together with a third `file-read` call; the exit gate terminated `dispatcher-early-stop`, the pending batch was dropped (`pending_batch:dropped`), run status `failure`, output text "I cannot determine the total…", scored 0. `rax-diagnose cause` on all three: `tool-failure/repeated-identical-call`, attribution `harness:honest-decline-mislabeled` (decisive). The off arm had the identical sequence up to iteration 3 in runs 1, 2, 4 but the model declined without a call there and ended `abstained`.
  - Lead (not state-replayed): `latestTextAfterEvidence` in `packages/reasoning/src/kernel/loop/honest-decline-exit.ts` skips any thought whose assistant turn carries call ids (`callIds.length > 0`), so a decline written in the same turn as a dropped call is never read by `honestDeclineOf` (`exit-gate.ts:721`). This is H-A3 from section B2, now backed by 3 more traces and the diagnose label, still unverified at state level.
  - Open question I cannot answer from this data: why the on-arm hit this path in 3/5 and 3/5 (twice) while the off arm hit it 0/5 and 0/5, when no act-or-answer event fired in either on-arm re-check run. Sampling is not excluded (Fisher p=0.17 on this re-check; the earlier f123 run gave the same 2/5 vs 5/5, and the inert arms there scored 4/5, 4/5, so some of the same failure exists without the flag). Do not claim the flag causes it.

### Scorer v3 regrade of the 15 rw-6 zoo-live traces (zero tokens)

Full per-run list: [rw6-regrade-v3.txt](rw6-regrade-v3.txt) (`src/spikes/zoo-live-rw6-regrade.ts`: v2 solved AND no `fabricatedFigures` over `runEvidenceOf`). `regradeCell` cannot be used here: live-graded traces already hold an `eval-graded` event, so it returns `already-graded`.

| Arm | solved at v2 | solved at v3 | runs flipped (invented figures) |
| --- | --- | --- | --- |
| cogito:8b actOrAnswer off | 3/5 | 2/5 | r2 (22%, 7.7%) |
| cogito:8b actOrAnswer on | 5/5 | 2/5 | r1 (34,12,65,28), r3 (18.3-18.5), r4 (15,16) |
| qwen3:4b default | 3/5 | 0/5 | r2 (57), r3 (90), r4 (69,71) |

Seven of 15 v2 solves were fabricated. The actOrAnswer rw-6 "+40pp" (3/5 > 5/5 at v2) is entirely grader blindness: at v3 it is 2/5 vs 2/5. Prediction in PREDICTIONS-2 (off about 1/5, on about 2/5, qwen about 1/5) was off by one in the off and qwen arms: off kept r1 (its "1234ms/256MB" are not percent figures, so v3 does not flag them) and qwen ended at 0/5. Residual blind spot: non-percent invented measurements (ms, MB) pass v3.

### Sim provenance

`bench:sim` now prints a header line before the matrix: `kernel source: packages/reasoning/src last changed at <sha> (HEAD <sha>), clean|DIRTY|dirty=unknown; resolves to <module url>` (`tests/sim/provenance.ts`, tests in `provenance.test.ts` and `cli.test.ts`). Resolution is unchanged. The header exposed that a plain relative pathspec matches nothing from cwd `packages/benchmarks`; it uses a repo-root pathspec.

### What k=5 can and cannot decide

F2 5/5 vs 5/5 means "not catastrophically worse than off" (the pre-fix failure was a 4-run collapse, which this would have caught), not equal; the confirmation rests on the traces (fires after both reads, correct sums), not on the solve count. F1 2/5 vs 5/5 is p=0.17 on this re-check; the verdict "hurt" comes from the pre-registered solved-count rule and the failure's mechanism is visible in 3 traces, but whether the flag raises the rate of the dropped-batch mislabel needs either the kernel-warden fix (then the question disappears) or n >= 20 per arm. Arms are independent Bernoulli draws (no seeded sampling), so b,c are descriptive. One model (gemma4:e4b), one task per family: cross-tier verification is NOT done; KEEP/adopt claims remain out of reach by the harness-warden's own rule.

### Next (kernel-warden, not done here)

1. `honest-decline-exit.ts` `latestTextAfterEvidence`: read the decline text of a turn whose call batch was dropped when the run ends by a guard (H-A3). Zero-token proof first: replay the three traces `recheck-f1/traces/aoa/gemma4_e4b/ra-default/ab-trap-5/run{1,2,4}` to check `honestDeclineOf` returns undefined for them, then add a zoo shape `decline-after-ignored-nudge` (decline plus call in one turn after a redirect nudge).
2. Then re-run F1 (10 cells, about 2 minutes) before reading any actOrAnswer verdict again.

## Addendum 3 (2026-11-19): ab-trap-5 actOrAnswer re-run after the dropped-call decline fix

Pre-registration: [PREDICTIONS-3.md](PREDICTIONS-3.md) (written before the first cell). Build: HEAD `373a12a70` (contains `76957e01e`), reasoning dist sha256 `6a344635…` (20:11:05, contains `callsDropped`); bench resolves reasoning from `src`. Confound: uncommitted kernel-warden diff in `packages/reasoning/src/kernel/capabilities/act/guard.ts` (`duplicateGuard` hint text; `git diff packages/reasoning` hash `0b2afcc80eab`); it never touches the exit gate. gemma4:e4b, k=5 per arm, 180 s cell timeout, 10 cells, 0 failed units; `ollama ps` empty before. Table: [recheck-f1b-table.txt](recheck-f1b-table.txt); results `recheck-f1b/`.

| Cell | Predicted off / on | Observed off / on | tok/run off > on | b,c | Proximal (early-stop on-arm) | Agree |
| --- | --- | --- | --- | --- | --- | --- |
| F1b | 5/5 / 4-5/5 | 4/5 / 4/5 | 2951 > 2681 (-9%) | 1,1 | 1/5 (was 3/5); also 1/5 in the OFF arm | outcome yes (on non-inferior), off predicted 5/5 missed by one |

Decision rule: on 4 >= off 4 - 1, non-inferior; not hurt. The earlier "on = 2/5" is not reproduced (2/5 > 4/5, same on-arm 3/5 > 1/5 early-stops). Verdict: the dropped-call fix is directionally confirmed on the on-arm, but the failure it targeted is NOT gone: it occurs once per arm, including with the flag OFF (off run1), so it is a gate defect independent of actOrAnswer, and the earlier "flag raises the rate" lead is withdrawn (n too small either way). One model, one task, k=5: not a KEEP.

### What the 2 remaining failures are (off run1, aoa run0; `rax-diagnose cause`: `tool-failure/repeated-identical-call`, `harness:honest-decline-mislabeled`, output = the true decline, scored 0)

The shape differs from addendum 2's "decline + call in one turn". Both runs: iter 1 tool-free decline; iter 2 and iter 3 pure `file-read` calls with empty content (after the redirect nudge); then:
- Gate 1 (iter 3, `dispatcher_early_stop`): `deny-once`, outstanding `["call the file-read tool", "write the final answer (the last text was narration around a tool call, not an answer)"]` (`exit-gate.ts:250` `CALL_NARRATION`).
- The model then writes a tool-free decline ("I cannot determine the total because ..."), 0 calls.
- Gate 2 (iter 4, `dispatcher_early_stop`): `handoff`, outstanding `["call the file-read tool"]`, run `failure`; `pending_batch` drops the stale iter-3 call.

Zero-token repro (probe test built from the trace shape, since deleted; steps: call/action/failed-read/decline/call/action/failed-read/pure call; `honestDeclineOf` called directly):
- Gate 1 outstanding (2 items): returns `undefined`. With only the tool item: returns the decline. So `honestDeclineOf` (`honest-decline-exit.ts:78`, `outstanding.every(...)`) rejects because of the heuristic `CALL_NARRATION` item, even though a valid tool-free decline exists from iter 1. This is a confirmed defect at gate level, but it only causes one deny-once (the model may recover next turn).
- Gate 2 shape (plus a final tool-free decline, stale pending batch): returns the decline, yet the real run did NOT abstain. NOT explained: the real state at gate 2 differs from my reconstruction in a way I cannot see from the trace (the trace has no step-level `assistantTurn` and the exit_gate event does not record what `honestDeclineOf` saw).

### For kernel-warden (minimal next fix, hypothesis only)

1. Make the exit gate record the inputs of the decline check in the `exit_gate` guard event when proposal is a guard and a required tool never succeeded: `missing`, the `latestTextAfterEvidence` text (or `none`), and which clause rejected. One traced run then shows why gate 2 handed off. This is the instrument the question needs.
2. Treat `CALL_NARRATION` (and other heuristic-basis items, `outstandingBasis: "heuristic"`) as non-blocking in `honestDeclineOf`'s `every` check; zero-token pin: gate 1 shape above must abstain.
3. Candidate for gate 2 to check first: whether the dispatcher early-stop is evaluated against `state.steps` that already include the final decline thought (observer at iter 4 ran 3 ms after the stream returned), and whether the stale iter-3 `pendingNativeToolCalls` (still listed by `pending_batch dropped`) changes `callsDropped`/`latestTextAfterEvidence` for the earlier call thought.
Then re-run F1b (10 cells, about 2 minutes). Ledger entry appended.

### runner.ts shrink (same mission)

`runner.ts` 974 > 963 LOC (ceiling): per-task sandbox (temp dir, fixtures, `withFileRoot`, grading, cleanup) moved into `packages/benchmarks/src/quick-grade.ts` as `openQuickSandbox(task)`. Behavior unchanged; quick-grade tests 4/4, `repo verify packages/benchmarks` green, `check-file-size` green.

## Addendum 4 (2026-11-19): live gate fix (`dd307bab7`) and refusal fix (`f08652b1a`)

Pre-registration: [PREDICTIONS-4.md](PREDICTIONS-4.md), written before the first cell. Build: HEAD `dd307bab7`, clean `packages/reasoning`; dist sha256 `e574369b…` contains `blocking-outstanding` and `listed input you have not read yet`; bench resolves reasoning from `src`. `ollama ps` clean before each drive; one supervisor at a time; 180 s cells. Specs `a4-A/B/B2.spec.json`, results `a4-A/`, `a4-B/`, `a4-B2/`, scanner `a4-trace-scan.ts` (refusal and named input read from `llm-exchange` message text, not labels). 25 cells, 0 failed units.

### Family A: ab-trap-5, gemma4:e4b, k=5 per arm

| Metric | Predicted | Observed |
| --- | --- | --- |
| off solved | 5/5 (4/5 ok) | 5/5 |
| on (actOrAnswer) solved | 5/5 (4/5 ok) | 4/5 |
| decline-scored-0 across both arms | <= 1 of 10 | 1 of 10 (aoa run4; was 2 of 10) |
| tokens/run off > on | n/a | 3165 > 2865 |

Verdict: underpowered, weakly confirmed. Both arms meet the >= 4/5 bar and the loss count met the "confirmed" threshold (<= 1 of 10), but 1 vs 2 of 10 is inside noise and the failure still occurs. Not a KEEP (one tier).

The remaining loss (aoa run4, `rax-diagnose cause`: `tool-failure/repeated-identical-call`, `harness:honest-decline-mislabeled`, status failure, the model's output is the true decline) is explained by the new `exit_gate.declineCheck`. Both gates record `missingTools: []` and `rejectedBy: "tool-viable"`: gate 1 (iter 3, deny-once, outstanding `call the file-read tool` [declared] + `write the final answer ...` [heuristic]) and gate 2 (iter 4, handoff, outstanding `call the file-read tool` [declared], text = "I cannot determine the total because the file `./ledger.json` could not be found or read."). The heuristic item (`dd307bab7`) is no longer what blocks it; the first clause, `missing === undefined`, rejects, and it also holds when the missing list is EMPTY. The text is a valid decline and file-read failed twice with ENOENT.

Hypothesis (code-read, NOT reproduced zero-token): `inspectDecline` calls `neverSucceededRequired` -> `missingRequiredToolsForInput` -> `effectiveMissingRequired` (`requirement-state.ts:141`), which filters out tools in `evidence.permanentlyFailed` (attempted, 0 successes; `requirement-state.ts:94`). A failed required tool is thus dropped from `missing`, `neverSucceededAmong` returns undefined on `missing.length === 0`, and the decline is rejected as "tool-viable" precisely when the tool is dead. The outstanding list (from `outstandingItems`, unfiltered) still says "call the file-read tool". Anchors: `packages/reasoning/src/kernel/loop/honest-decline-exit.ts` (`inspectDecline`, `neverSucceededAmong`), `packages/reasoning/src/kernel/capabilities/verify/requirement-state.ts:141`. Next fix (kernel-warden): compute the decline's `missing` from unfiltered `missingRequired` over `input.requiredTools`, keep the "every call failed" test on outcomes; pin with a zero-token test whose evidence has `permanentlyFailed: ["file-read"]`. Also give the empty case its own `rejectedBy` value; `tool-viable` is misleading there.

### Family B: cogito:8b, default arm

| Cell | Baseline | Predicted | Observed |
| --- | --- | --- | --- |
| h3-todo-heavy k=10 solved | 1/10 rescored, 3/15 pooled, 0/8 refusal runs | 3-5/10 | 0/10 (acc mean 0.35 vs 0.38) |
| refusal fired | 8 of 15 pooled | 4-7 of 10 | 7 of 10 |
| refusal names an unread input | n/a | >= 80% of fired | 6 of 7 (85%); always `notes-6.txt` |
| solved among refusal runs | 0/8 | >= 1 | 0/7 |
| model read the named input after the refusal | n/a | n/a | 3 of 6 |
| tokens/run, tokens/solved | 11492 | n/a | 14155, undefined (0 solved) |
| h3-exact-value k=5 solved | 9/10 (5/5 reg) | >= 4/5 | 5/5, 2195 tok/run, refusal fired 1 (no hint), solved |

Verdict todo-heavy: REFUTED per the pre-registered rule (refusal fired >= 3, named an input, 0 solved; overall <= 1/10). The mechanism misfires on this task: the prompt says "notes-1.txt through notes-6.txt", so `deriveListedInputs` yields two entities (notes-1, notes-6). After notes-1 is read the hint always says "Read notes-6.txt first" while notes-2..5 are the ones skipped. Run0: model read notes-6, wrote out-3..6 all as `108` (54 x 2) from one read. Run4: read notes-6, wrote out-3/out-4 as 126 (notes-4's value) and out-5 as 84 (notes-2's). Where the model followed the hint outputs were still wrong (3 of 6 followed), so a correct range expansion may not suffice. Verdict exact-value: no regression (non-inferior; k=5, one tier).

Selection caveat still applies: refusals occur in already-looping runs. 3 of 10 runs had no refusal (run1, run7: 2-3 iterations then wrong answer; run9: stall-after-work), so the cell fails from several independent causes and the refusal text touches one.

### Next-fix hypotheses (kernel-warden; one fix per cycle)

1. Decline gate: stop dropping permanently-failed required tools from the `missing` set `inspectDecline` judges (above). Zero-token pin first, then ab-trap-5 k=5 per arm; proximal metric = `declineCheck.rejectedBy` becomes `none`, loss count 0 of 10.
2. todo-heavy: (a) expand "X-1 through X-N" ranges in `deriveListedInputs` (`verify/derive-inputs.ts:66`) so the named input is a truly unread one; (b) since following the hint still gave wrong values in 3 of 6 runs, the stronger candidate is a gate refusing `file-write` of `out-N` while its source is unread (the inputCoverage/writeCoverage family, ablation-gated). Measure (a) at k=10 first; if solved stays <= 2/10 go to (b) as an ablation.
3. Instrument note (no edit made): the scanner infers "followed the hint" from the first `Already done` text in `llm-exchange`; a trace event carrying the refusal hint would make this exact. Candidate for kernel-warden when touching `guard.ts`.

No `packages/**` file changed in this mission, so `repo verify packages/benchmarks` was not re-run. Ledger: two entries appended to `improvement-ledger.json`.

## Addendum 5 (2026-11-18): decline over a dead tool (`d15d076d0`) and range-expanded refusal (`66531b642`)

Pre-registration: [PREDICTIONS-5.md](PREDICTIONS-5.md), written before the first cell. Build: HEAD `66531b6427ec`, tree clean; reasoning dist sha256 `44afda35…` (contains `no-missing-required` x1, `expandNumberedRange` x2); bench resolves reasoning from `src`. `ollama ps` clean before the first drive; one supervisor at a time; 180 s cells. Specs `a5-A/B/B2.spec.json`, results `a5-A/`, `a5-B/`, `a5-B2/`; scanner `a4-trace-scan.ts` plus two scratch readers (write contents, read/write order). 40 cells, 0 failed units.

### Family A: ab-trap-5, gemma4:e4b, k=10 per arm

| Metric | Predicted | Observed |
| --- | --- | --- |
| off solved | 9-10/10 | 10/10 |
| aoa solved | 9-10/10 | 10/10 |
| decline-scored-0 across both arms | <= 1 of 20 | 0 of 20 |
| any lost decline with `rejectedBy: tool-viable` | none | none (no losses) |
| tokens/run off vs aoa | n/a | 3075 vs 2718 (-12%) |

Verdict: CONFIRMED (rule: <= 1 of 20 losses, each arm >= 8/10). Was 1 of 10 at k=5, 2 of 10 before that. One model, one task: not a KEEP.

### Family B: cogito:8b, default arm

| Cell | Baseline | Predicted | Observed |
| --- | --- | --- | --- |
| h3-todo-heavy k=10 solved | 0/10 | 1-3/10 | 0/10 (acc per run 0.17 0 0.17 0 0.17 0.83 0.5 0.67 0.17 0.17) |
| refusal fired | 7/10 | 4-7 | 7/10 |
| refusal names the first unread input | 6/7 named, wrong (notes-6) | >= 80% | 7/7 correct (notes-3 x6, notes-4 x1; checked against the reads before the refusal) |
| model read the named input after | 3/6 | >= 4 | 6/7 |
| solved among refusal runs | 0/7 | >= 1 | 0/7 |
| tokens/run | 14155 | n/a | 15858, 0 solved |
| h3-exact-value k=5 | 5/5 | >= 4/5 | 5/5, 2766 tok/run |
| h3-required-tools k=5 | none | >= 4/5 | 0/5 (3682 tok/run) |

Verdict todo-heavy: REFUTED per rule (refusal fired >= 3, correct input named, overall 0/10). The range fix works as designed and the model follows it (6 of 7), yet nothing solves. Verdict exact-value: no regression. Verdict required-tools: flagged by the rule (<= 3/5) but NOT a regression: the same task scored 0/5 on cogito in `reg-cogito` at `0335f07c`, before these fixes. Failure is a wrong mean (score 0.667, 20-row arithmetic), `model:had-evidence-wrong-output`.

### Why todo-heavy still fails (10 runs, from `file-read`/`file-write` order and write contents)

| Cause | Runs | Shape |
| --- | --- | --- |
| A. Refusal hint steers to the next READ while the pending step is a WRITE; off-by-one lag | 0, 2, 8, 9 (0.17); 5, 7 recover partly (0.83, 0.67) | model reads notes-2 (42), does NOT write out-2, re-reads notes-2; the duplicate read is refused with "Read notes-3 first"; model reads notes-3 and writes out-2=16 (notes-3's double); every later out-N is the next file's value; out-6 unwritten at the 14-iteration cap |
| B. Placeholder content | 1, 3 | read/write in perfect order but every `file-write` content is the literal string `doubled_value`; run3 loops the whole cycle 3 times |
| C. Write-before-read | 4 | one read (notes-1), then six writes all `34` |
| D. Arithmetic on derived output | 6 | out-4/5/6 = 56/112/224 (doubling the previous output) after the refusal |

Cause A is the one the pre-registered change touches and it is the largest (6 of 10). The hint text (`Already done - do NOT repeat. Still outstanding: write the file ./out-2.txt; ...  Do the next item now. Read <notes-3> first: it is a listed input you have not read yet.`) lists writes as outstanding but the explicit imperative is the read. Trace evidence (run0 seq 116): the tool result of the refused re-read carries the hint; the model's very next call is `file-read notes-3`. The model's real stall happened one step earlier (it read notes-2 and did not write out-2), which the hint does not address: the missing step there is "write out-2 from the value already read". Instrument faults seen on the way: `rax-diagnose cause` labels runs 0 and 9 `wrong-tool-arg` because the dedup-refused read (`tool-call-end ok:false`, seq 105) counts as a tool failure; runs 5 and 7 are `terminal-mislabel` (`terminal_decision.status=failed`, `run-completed.status=success`) at the iteration cap. Neither changes the grade.

### Ranked hypotheses for the next cycle (one fix, kernel-warden; ablation-gated)

1. Refusal names the pending WRITE first: when a listed input is already read and its output (`out-N`, outstanding artifact whose source is read-but-unwritten) is not, the hint should say "Write ./out-2.txt now from the value you read" instead of "Read notes-3 first". Zoo shape (zero-token): trace steps read notes-1, write out-1, read notes-2, read notes-2 (refused); assert the hint's first imperative is write out-2, not read notes-3. Predicted effect: removes cause A (6 of 10); solved 2-4/10 expected, since causes B-D remain (4 runs).
2. Write-before-read gate (ablation-gated): refuse `file-write` of an output whose source input is unread, or whose content equals a value not derived from a read of that source. Shape: one read then six writes (run4) and run0-style lag (out-2=16 after notes-3). Predicted effect: catches C and part of A; also needs a content-vs-evidence check for lag, so it overlaps hypothesis 1. Do 1 first; add 2 only if solved <= 2/10.
3. Literal placeholder detection (cause B, 2 of 10): reject write content matching a value that appears in no prior tool result and is not computable from one (`doubled_value`) when the prompt asked for digits only. Predicted effect: 0-2 runs. Lowest priority: closer to a model-capability issue and not a general failure class on its own.

Not examined: cause D (run6) beyond the write contents. Power: k=10, one tier; nothing here is a KEEP.

No `packages/**` file changed in this mission, so `repo verify packages/benchmarks` was not re-run. Ledger: two entries appended to `wiki/Research/Harness-Reports/improvement-ledger.json`.

## Addendum 6 (2026-11-18): duplicate refusal leads with the pending write (`132ae5515`)

Pre-registration: [PREDICTIONS-6.md](PREDICTIONS-6.md), mtime 20:51:22, before the first result file (a6-B/default.json 20:54:06). Build: HEAD `132ae5515d85`, tree clean apart from the new sim shape; reasoning dist sha256 `31327ebf…` contains `do not re-read it` (x1); bench and sim resolve reasoning from `src` (sim header: "kernel source: packages/reasoning/src last changed at 132ae5515 (HEAD 132ae5515), clean"). `ollama ps` empty before the first drive; one supervisor at a time; 180 s cells. Specs `a6-B/B2/C.spec.json`, results `a6-B/`, `a6-B2/`, `a6-C/`. 20 cells, 0 failed units.

### Zero-token shape (run first)

`packages/benchmarks/src/sim/shapes/pending-write.ts` (registered in `SHAPES`), test `packages/benchmarks/tests/sim/shape-pending-write.test.ts`. Sequence: read notes-1, write out-1, read notes-2, re-read notes-2 (refused). Asserts: the refusal reads "Write .../out-2.txt now from the value you just read in .../notes-2.txt: do not re-read it. Then read notes-3" (Write precedes Read), and a scripted policy that writes next completes all six pairs with exact values. Reverting `132ae5515` would fail it (the policy then takes the lag path); I did not re-run it on the old commit. Two more shapes, `pending-write-stubborn-cap14` and `-cap16`, model a stubborn re-reader against the live 14-iteration cap (cause E below).

### Prediction vs observation (cogito:8b, default arm)

| Cell | Baseline | Predicted | Observed |
| --- | --- | --- | --- |
| h3-todo-heavy k=10 solved | 0/10 | 2-4/10 | 1/10 (acc per run 0 0.17 1.0 0.17 0.83 0 0.83 0.67 0.67 0.50); 16803 tok/run |
| cause A runs | 6/10 | <= 2 | 2 (runs 1, 3) |
| refusal fired | 7/10 | 4-7 | 8/10; all 8 lead with Write (text checked) |
| h3-exact-value k=5 | 5/5 | >= 4/5 | 5/5, 2189 tok/run |
| h3-todo-heavy gemma4:e4b k=5 | 5/5 | >= 4/5 | 5/5, 21488 tok/run, 0 refusals |

Verdict todo-heavy: REFUTED on the pre-registered rule (solved 1 < 2). The rule's third case applies: cause A dropped 6 to 2, so the change is mechanically confirmed and not sufficient. Of 8 refusal runs, 6 then wrote the correct out-2 (84); 2 followed the trailing "Then read notes-3" and re-created the lag. No regression on exact-value or gemma todo-heavy. k=10, one model for the target: no KEEP claim.

### Causes now (10 runs, from `file-read`/`file-write` order, write contents, calls per iteration)

| Cause | Runs | Evidence |
| --- | --- | --- |
| solved | 2 (14 iterations, barely) | all six correct |
| A. lag (read notes-3, then write out-2) | 1, 3 | first refusal leads with Write; next calls `R:notes-3, W:out-2=16` |
| E. iteration budget | 4, 6, 8 | every written value correct (0.83, 0.83, 0.67). 5 of 8 refusal runs re-read notes-2 a second time before writing (two refused re-reads, three iterations on one item). Run4: iteration 13 extracted a call, `ri-early-stop` blocked, `pending_batch ... dropped`, `exit_gate terminate max_iterations` at iter 13 of 14: out-6 never written |
| B. dependent calls in one parallel batch | 0, 5 | 12 calls in 2-3 iterations (run0 `{0:2, 1:10}`, run5 `{0:2,1:2,2:8}`): writes issued in the same batch as the reads they need, so content is `double_value` / `2 * integer_fr...` |
| C/D. write without reading; doubling the previous output | 7, 9 | one call per iteration; out-4=16 (notes-3's double, notes-4 unread); run9 out-5=32, out-6=64 |

Addendum 5 filed B as "placeholder content" and a model-capability issue. The trace says it is a batching defect: a dependent call cannot see the result of a sibling in its batch. That is a general failure class, not a model quirk.

### Ranked next fixes (one per cycle, kernel-warden; ablation-gated)

1. E, iteration budget wasted on refused re-reads (3 of 10). Candidates: (a) a refused duplicate does not consume an iteration; (b) the refusal drops "Then read X" when a pending write exists (also targets A: runs 1, 3 followed it). Zero-token shapes: `pending-write-stubborn-cap14` pins the lost last pair, `pending-write` pins the hint. The sim does not reproduce the live waste exactly (there one of two repeated re-reads executes; live both were refused), so the stubborn shape uses 3 re-reads to match the live cost: a cost model, not a replay. Predicted: (a) runs 4, 6 solve, run 8 maybe, +2-3/10 (solved 3-4/10); (b) alone +0-2.
2. B, dependent write batched with its read (2 of 10; both end in 3-4 iterations with placeholder output). Candidate: run a write after the read of its paired input when both are in one batch (substrate; applies to any read-then-write plan). Predicted +0-2. No zero-token shape yet (needs a batch-capable policy).
3. C/D (2 of 10). Write-before-read gate: not warranted now. It would reuse `pairedOutputForInput`/`isInputRead`, but every gate refusal burns an iteration in a budget-bound task (cause E), so it can lose runs it saves. Predicted gain <= 1/10. Hand to ablation-warden only if, after E is fixed, solved is still <= 3/10 with C/D runs present.

Instrument notes: `rax-diagnose cause` labels the refused re-reads `wrong-tool-arg`/`tool-failure` (runs 1, 3, 4, 6, 8) and run 2 `terminal-mislabel`; no grade changed. Per-iteration call counts came from `tool-call-start` `iter` (scratch readers, not committed).

`bun run repo verify packages/benchmarks`: green (tests, typecheck, check-cross-cutting). Ledger: one entry appended to `improvement-ledger.json`. Power: k=10 SE ~13-15pp; nothing here is a KEEP.
