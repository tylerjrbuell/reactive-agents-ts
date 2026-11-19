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
