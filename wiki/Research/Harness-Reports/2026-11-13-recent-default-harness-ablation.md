---
type: research
status: complete
created: 2026-11-13
tags: [ablation, h3, lift-gate, tool-surface, satisfiability, post-conditions, regression]
---

# Recent default-on harness changes: ablation (2026-11-13)

Headline: mechanism A (`795a51884`, retrieval tools no longer count as a side effect landing) is a confirmed regression and gets REWORK. It flips two pure file-read H3 tasks from success to failure on both tiers while the accuracy-only lift gate stays blind to it. B is behaviorally good on a constructed scenario but not gate-measurable. C and D did not fire in any measured run.

## Pre-registered design and decision rule (written BEFORE any cell ran)

Arms (same H3 frozen suite, same models, same harness variant `ra-default`):
- **BASE** = `cbc9a5414` (parent of `795a51884`), checked out as a detached git worktree outside the repo, own `bun install`, reasoning `dist` rebuilt there. Contains none of A, B, C.
- **HEAD** = `dev` at `59630b4b6`. Contains A (`795a51884`), B (`1521de3f2`), C (`00f927a78`), D (`aa7a01bae`), plus 36 other commits (runtime gateway/chat, tools web-search, core events). HEAD-vs-BASE is a *bundle* test: it can show a regression of the bundle, it cannot attribute lift to one mechanism. No source edits are allowed, so per-mechanism toggles do not exist. (A third arm was added during the run, see "A-only arm": a worktree at `795a51884` isolates A.)
- Tiers: `qwen3:4b` (small), `cogito:8b` (mid). `nimble`/`mimo-v2.6` are not in `STATIC_CAPABILITIES` (they would resolve `source=fallback`, 2048-token ctx, every cell void). No paid tier was used: the H3 runner only supports local tiers and the two local tiers already meet `minTiers: 2`. Spend: USD 0.
- Tasks: all 12 H3 tasks, k=3 per (tier, task, arm) (`minRuns: 3`).

Per-mechanism attribution (zero-token, from traces): count **activations**. A mechanism that fires in 0 runs is INERT on that suite: the result says nothing about it and its verdict is INCONCLUSIVE (not exercised), never PASS.
- C fires when a `tool-surface-resolved` reason contains `within-budget`.
- B fires when a run abstains with `every available tool is read-only and cannot perform it`.
- A fires when `isSideEffectLanded` skips a successful retrieval-category call.
- D (MCP attached tools visible) needs an MCP server; H3 has none.

Decision rule: project lift rule (`evaluateLiftGate`, `DEFAULT_LIFT_POLICY`): default-on needs >=2 tiers, every tier lift >=3pp with |lift| above the 95% band, billed-token overhead <=15%, >=3 runs per cell. Regression = lift<0 beyond the 1sigma band. A null result cannot PASS a safety/bug-fix mechanism for default-on by lift. Noise: Bernoulli cells, 12 tasks x k=3 per tier; per-task gaps under ~26pp and pooled gaps under ~10pp are noise.

Addition made after seeing the H3 traces (labelled, not pre-registered): the lift metric is graded `accuracy`, which does not see run `status`. Run status (`success`/`failure` in `run-completed`) and billed tokens are reported alongside it, because a run that answers correctly and is then ended as `failure` is a user-visible regression the metric cannot register.

## Results 1: H3 frozen suite, HEAD vs BASE (k=3, 2 tiers, 144 cells)

Raw: `2026-11-13-recent-default-harness-ablation/{base,head}.json` (traces local only, `/home/tylerbuell/ablation-traces/{base,head}`).

Lift gate (`rax eval gate`, accuracy metric; converter `h3-to-session.ts` builds a SessionReport from the two H3 files; booked to the ledger with `--activations 0`, so the entry status is `void`):

| tier | base acc | head acc | lift | billed tok | verdict |
|---|---|---|---|---|---|
| qwen3:4b | 86.2 | 86.6 | +0.4pp | +11.4% | INCONCLUSIVE (one base rw-7 cell had an `error` run) |
| cogito:8b | 63.0 | 65.7 | +2.8pp | -4.7% | BELOW |
| aggregate | | | +2.8pp | -4.7% | **UNDERPOWERED** (not evidence of no effect) |

Per-task accuracy deltas are all inside the gate's per-task SE (+-32 to +-40pp): cogito rw-6 +66.7pp, rw-2 -22.2pp, rw-3 -11.1pp, rw-7 -11.1pp; qwen rw-7 -11.1pp, h3-plan-only -11.1pp. By the pre-registered noise rule these are noise (n=3 per cell). They are not diagnosed further.

Fully solved runs (accuracy = 1): qwen3:4b base 26/36, head 27/36; cogito:8b base 14/36, head 16/36. No accuracy regression.

**Hidden regression the accuracy metric cannot see.** Run status in `run-completed`:

| task | tier | BASE (status / terminatedBy) | HEAD | tokens/run base -> head |
|---|---|---|---|---|
| h3-continuation | qwen3:4b | 3/3 success, end_turn | 3/3 failure, stall_deliverable | 1.6k -> 4.4k |
| h3-continuation | cogito:8b | 3/3 success, end_turn | 3/3 failure (2 dispatcher-early-stop, 1 stall_deliverable) | 1.1k -> 4.4k |
| h3-exact-value | qwen3:4b | 3/3 success | 3/3 failure, stall_deliverable | 2.5k -> 5.7k |
| h3-exact-value | cogito:8b | 3/3 success (one via dispatcher_early_stop pair across arms, all `success`) | 3/3 failure, stall_deliverable | 3.5k -> 3.8k |

Across the two tasks: 0/12 failure at BASE, 12/12 failure at HEAD. Graded accuracy stays 1.00 in all 12 (the answer is right, the harness ends the run as failed). `rax-diagnose attribute --all` on HEAD: `harness:false-veto` = 12 runs (exactly these cells); BASE: 0.

`rax-diagnose cause` (HEAD, qwen3:4b h3-continuation run0, `01M7AJ43A5M2EVVHQJ4RTT3YZP`):
```
cause=stall-after-work confidence=decisive status=failure authority=unclassified:stall_deliverable
evidence  guard-fired#1313  stall_deliverable: consecutiveStalled 4/4; artifacts=1
attribution harness (harness:false-veto) confidence=decisive target=answer
evidence  eval-graded#1339  eval-graded regex: score=1.000 passed=true
evidence  run-completed#1338  ... outstanding=actually complete the requested action - no successful tool call has made it take effect yet; make the call ...
evidence  verifier-verdict#1337  runtime verifier rejected: action-success
```
Trace shows `exit_gate` deny x4 (iterations 2-5) with that outstanding text, a `loop_resolution:block`, then `stall_deliverable:terminate`. BASE trace for the same cell: one `exit_gate:accept`, `deliverable_decision:pass`, 3 iterations.

### A-only arm (isolates the cause)
`git diff cbc9a5414 795a51884 --stat` touches only `post-conditions.ts`, two test files and a changeset, so `795a51884` is BASE plus A and nothing else. Third worktree at `795a51884`, qwen3:4b, the same two tasks, k=3 (`a-only.json`, traces `/home/tylerbuell/ablation-traces/a-only`): **6/6 `failure`/`stall_deliverable`, 5 exit_gate blocks each, 4.3k-5.8k tokens**. That reproduces the HEAD behavior with only A applied on top of BASE. BASE gave 6/6 success on the same cells. Evidence is n=3 per task, but the mechanism is deterministic (6/6 vs 0/6).

## Results 2: targeted live probes (constructed scenarios; the H3 suite exercises none of A/B/C)

Scripts: `probe-act-vis.ts.txt`, `probe-act4-act5.ts.txt`; per-run records `probe-results/*.jsonl`. n=4 per (scenario, tier, arm), tools are stubs with fixed output, scoring is deterministic (terminatedBy, regex on output). Imports use runtime/tools `src` in both trees.

| scenario | mechanism | BASE | HEAD |
|---|---|---|---|
| act4: task "send an email", only tool is `email` (read-only, `mutatesExternalState:false`, name matches the task so keyword relevance passes) | B | 8/8 run `success`, 8/8 claim "email sent" (false), ~0.6k-1.6k tokens | 8/8 abstained at iteration 0, 0 tokens, 0.2-0.3 s |
| act2 (read-only tool, description mentions email), act (read-only lookup) | B | 8/8 abstained (keyword relevance already abstains) | 8/8 abstained; act2 now says "every available tool is read-only" (B fired 8/8), same outcome |
| act3 (unflagged web-search) | - | 8/8 abstained | 8/8 abstained |
| act5: task "use web-search ... then send an email", unflagged `web-search` | A | 6/8 `success`, 5/8 claim sent; no run called web-search (models used the `recall` meta-tool and said "sent") | 6/8 `success`, 5/8 claim sent; same |
| vis: 3 read-only tools, needed tool's description shares no words with the task | C | 7/8 correct (cogito i=1 missed) | 8/8 correct |

Notes: (1) C did not fire anywhere (0 `within-budget` reasons in 72 H3 HEAD traces and in the vis HEAD traces); both arms already show the needed tool, so vis cannot distinguish them. (2) A's intended trigger (a successful retrieval call counted as the action landing) never occurred in act5: no run executed web-search. A is therefore unverified in its intended direction and only observed in its harmful direction (file-read on a read-only task). (3) act5 exposes a separate pre-existing gap present in both arms: only meta-tool calls (`recall`) occurred, the contract requirement `action:send-message` stayed `declared`, `exit_gate` had `outstanding: []`, and the run ended `success` with a fabricated "email sent" (cause=none, decisive). Trace: `01M7APPK2J5GT1HP7WJ8THP43G`. Not caused by A/B/C.

## Verdicts

| mechanism | verdict | basis |
|---|---|---|
| **A** retrieval-tool skip in `isSideEffectLanded` (`795a51884`) | **REWORK** | Isolated regression: 6/6 vs 0/6 failure on h3-continuation + h3-exact-value (qwen3:4b, A-only arm), 12/12 vs 0/12 across both tiers at HEAD; correct answers ended as `failure`, tokens up to 2.8x; attributed `harness:false-veto`. Lift rule: a tier regresses (run outcome), and the benefit it targets was never observed. The accuracy gate said UNDERPOWERED, i.e. the gate is blind to this class; it should also read run status. |
| **B** read-only satisfiability abstention (`1521de3f2`) | **INCONCLUSIVE for the gate; no harm seen; behavior favorable** | 0 activations on H3. On act4 (n=8 per arm, 2 tiers): BASE 8/8 false "email sent" success, HEAD 8/8 honest iteration-0 abstain at 0 tokens. Constructed scenario, so not default-on evidence under the lift rule; B is fail-closed (fires only when every visible domain tool is declared `mutatesExternalState === false`). Recommend keep, and add a frozen H3 task for it (new task id) so the gate can score it. |
| **C** `resolveToolSurface` shows all domain tools within `PRUNE_MIN_TOOLS` (`00f927a78`) | **INCONCLUSIVE (not exercised)** | 0 activations in 72 H3 HEAD runs and 8 vis probe runs. H3 surfaces resolve via `required`/`builtins-floor`; the probe surface is already fully shown at BASE. Needs a lazy-disclosure context (tool set near the 15 boundary, task prose that does not name the tool) to be measurable. Bundle: no regression attributable to it. |
| **D** MCP attached tools visible (`aa7a01bae`) | **INCONCLUSIVE (not exercised)** | No MCP server in H3 or the probes. Bundle shows no regression beyond A. Needs an MCP-attached scenario. |
| bundle HEAD vs `cbc9a5414` | **REWORK** (because of A) | Gate: UNDERPOWERED on accuracy (+0.4/+2.8pp, tokens +11.4%/-4.7%). Run-status regression of 12 cells, all traced to A. |

## Root-cause hypotheses for domain wardens (not edited)

All anchors are `packages/reasoning/src/kernel/capabilities/verify/`:
1. `post-conditions.ts:306` `RETRIEVAL_CATEGORIES` includes `"file-read"`, and `post-conditions.ts:337` `isSideEffectLanded` skips every retrieval-category result. A task whose only tool is `file-read` ("read config.json and tell me ...", "add the two counts") still gets a `SideEffectLanded` condition from prose (`derive-conditions.ts:685` `push(sideEffectLanded())`). `derive-conditions.ts:743` (`seedPostConditions`, defined at :725) drops it only when the surface has no substantive tool at all (`surfaceHasSubstantiveTool`); `file-read` counts as substantive, so the condition is kept and is now unsatisfiable. The exit gate then reports `post-conditions.ts:605` "actually complete the requested action". Suggested boundary fix (owner: kernel-warden): decide satisfiability of `SideEffectLanded` against the surface, i.e. drop it in `seedPostConditions` when every substantive surface tool is retrieval-category (same rule as the meta-only case), or do not derive it for read-shaped prose. Pin: H3 `h3-continuation` / `h3-exact-value` must end `success` again (red on `795a51884`, green on BASE).
2. `h3-continuation` on cogito also shows `dispatcher-early-stop` finishing as `failure` (2 HEAD runs). Same outstanding condition, different exit path.
3. Separate, pre-existing: with only meta-tool calls, `action-required` (`action:send-message`) never becomes outstanding at the exit gate (`exit_gate outstanding: []`, trace `01M7APPK2J5GT1HP7WJ8THP43G` seq 62), and the terminal verifier's `action-success` reads only the last tool's own success (`verifier.ts:324`, the `recall` result `saved:true`). Result: a fabricated "email sent" counted as `success`. Hypothesis only; not isolated.
4. Instrument note: the H3 runner's `cause` label printed `parse-failed` for the BASE arm (the worktree CLI could not label BASE traces during the run). Attribution in this report was recomputed from the main checkout with `rax-diagnose`.

## Caveats and what more budget would settle

- n=3 per cell, 12 tasks per tier: accuracy deltas under ~10pp pooled are noise. The A regression is not a small-effect claim: it is 12/12 vs 0/12 on a deterministic mechanism, and 6/6 vs 0/6 with only A applied.
- HEAD-vs-BASE includes 36 unrelated commits. Only the A-only arm isolates one mechanism; B, C, D have no isolated arm (no toggles exist).
- To settle B for default-on: add a frozen read-only-tools action task to H3 (new id, re-freeze) and rerun k=5 on both tiers. To settle C and D: scenarios with a tool set near the 15 boundary and an attached MCP server, plus a frontier tier (haiku-class; roughly USD 1 for 2 tasks x k=5, estimate not measured). A paid tier was not needed to reach REWORK on A.
- Environment: `/tmp` stayed at 2.3 GB used before and after (no growth). Worktrees `/home/tylerbuell/ablation-base-wt` and `/home/tylerbuell/ablation-a-wt` were removed after the run; probe scripts remain in `.repo-logs/ablation-probe/` (gitignored).

Erratum: in the Results 1 status table, the BASE cell for h3-exact-value / cogito:8b should read "3/3 success" (the parenthetical there is garbled). BASE h3-exact-value across both tiers was 6/6 `success` (4 end_turn, 2 controller_early_stop:dispatcher_early_stop).

## Re-measurement after 5abfa34e3

Headline: the fix does NOT clear the regression. At HEAD `fc0136042` (includes fix `5abfa34e3`), h3-continuation and h3-exact-value still end `failure` in 12/12 live runs, identical to the pre-fix HEAD (12/12) and A-only (6/6), versus 0/12 at BASE. The new status gate rejects the original regression and also rejects the fixed HEAD on the target slice. Verdict on the fix: REWORK (incomplete).

Setup: dev HEAD `fc0136042`, reasoning `dist` rebuilt via turbo (cache hit; `dist/index.js` contains `surfaceCanLandSideEffect` and `OUTWARD_EFFECT_VERB`, so the fix was live). Same runner (`h3/run-h3.ts`), same 12 tasks, k=3, qwen3:4b and cogito:8b, 72 cells, USD 0. Raw: `2026-11-13-recent-default-harness-ablation/fix-head.json` (new cells carry `endStatus`; traces local, `/home/tylerbuell/ablation-traces/fix`). For the old arms (`base.json`, `a-only.json`, `head.json`, recorded before `endStatus` existed) the converter `h3-to-session-v2.ts` reads `run-completed.status` from the trace files; combined session in `session-v2.json`, target slice in `session-v2-targets.json`. `/tmp` stayed at 2.3 GB used before and after.

### Target tasks, k=3 per cell, run status (non-success / n)

| task | tier | BASE | A-only (`795a51884`) | HEAD pre-fix (`59630b4b6`) | HEAD+fix (`fc0136042`) | tokens/run BASE -> HEAD+fix |
|---|---|---|---|---|---|---|
| h3-continuation | qwen3:4b | 0/3 | 3/3 | 3/3 | **3/3** | 1.6k -> 4.5k |
| h3-exact-value | qwen3:4b | 0/3 | 3/3 | 3/3 | **3/3** | 2.5k -> 5.8k |
| h3-continuation | cogito:8b | 0/3 | - | 3/3 | **3/3** | 1.1k -> 4.7k |
| h3-exact-value | cogito:8b | 0/3 | - | 3/3 | **3/3** | 3.5k -> 5.6k |

`status=success` count at HEAD+fix on the two tasks: **0/12** (BASE 12/12). Accuracy stays 1.00 in all 12 (answer right, run ended failure). `rax-diagnose attribute --all` on the 72 fix cells: `harness:false-veto` = 12, exactly these 12 cells (expected 0). Terminal paths: qwen `stall_deliverable` 6/6; cogito `dispatcher-early-stop` 3, `stall_deliverable` 2, `loop_resolution` 1 (all `failure`).

### Gate receipts (`rax eval gate`, billed tokens, run-status guard; ledger entries appended, status `void` because `--activations 0`)

Target slice (`session-v2-targets.json`, base vs candidate):

| candidate | verdict | detail |
|---|---|---|
| A-only `795a51884` (qwen3:4b only) | **REJECT** | status non-success 0/6 -> 6/6, billed x2.44 |
| HEAD pre-fix | **REJECT** | qwen 0/6 -> 6/6 (x2.44), cogito 0/6 -> 6/6 (x1.76), aggregate +110% billed |
| HEAD+fix | **REJECT** | qwen 0/6 -> 6/6 (x2.48), cogito 0/6 -> 6/6 (x2.22), aggregate +135% billed |

So the guard catches the original regression (A-only is REJECTED) and it correctly refuses the fixed HEAD.

Full 12-task suite (`session-v2.json`, base vs candidate):

| candidate | qwen3:4b | cogito:8b | decision |
|---|---|---|---|
| A-only (2 tasks) | REGRESS (0/6 -> 6/6) | - | REJECT |
| HEAD pre-fix | +0.4pp acc, +11.4% billed, status 12/35 -> 17/36, INCONCLUSIVE | +2.8pp, -4.7%, status 13/36 -> 21/36, BELOW | UNDERPOWERED (guard did NOT fire) |
| HEAD+fix | +0.9pp, +26.2% billed, status 12/35 -> 15/36, INCONCLUSIVE | +5.6pp, +25.7%, status 13/36 -> 20/36, BELOW | UNDERPOWERED (guard did NOT fire) |

Caveat on the new gate (a finding for harness-warden/benchmarks owner): the guard pools every task in a tier, and `DEFAULT_STATUS_REGRESSION_PP = 25` (`gate/types.ts:147`). The 12 bad cells are 12 of 72 runs. On the whole suite the tier-level delta is +13pp/+22pp (pre-fix) and +8pp/+19pp (fixed), under 25pp, and the qwen tier is INCONCLUSIVE (`statusRegresses` requires `!inconclusive`). So on the full frozen suite the guard would NOT have caught the original regression; it catches it only on a slice that contains the affected tasks (or per-task). A per-task read (a task whose non-success rate goes 0/k -> k/k) would catch it at suite level. Also note the baseline itself is 36% non-success, mostly `ab-trap-*` abstention tasks (non-success is the correct outcome there), so a pooled non-success rate is a noisy denominator.

### No-harm sweep (full suite, non-success / n per cell, BASE | pre-fix | fixed)

Cells differing between BASE and HEAD+fix outside the two target tasks, all inside the noise rule (per-task SE +-32 to +-40pp at n=3), so none is claimed: qwen rw-2 3/3 -> 2/3, rw-6 3/3 -> 1/3, rw-7 1/3 -> 0/3 (better); cogito rw-2 0/3 -> 1/3, rw-6 3/3 -> 2/3, rw-7 2/3 -> 3/3, rw-9 1/3 -> 0/3, h3-required-tools 1/3 -> 2/3 (worse). Accuracy: qwen 86.2 -> 87.1, cogito 63.0 -> 68.5 (+5.6pp, BELOW 3pp-with-95%-band). Billed tokens +26% on both tiers, driven by the 12 target cells (2.2x to 2.5x); excluding them the suite is not heavier. No new regression class found, but the suite is too small to show one below ~26pp per task. Remaining non-success runs outside the targets (`cause`): qwen rw-2 x2 `stall-after-work` (`runtime-success-veto:outstanding-criteria`, attribution `harness:stall-after-work` probable, same veto family, not diagnosed further); rw-6/rw-2 `verifier-reject/tool-evidence-present` (model:fabrication-vetoed, correct); cogito rw-7 `required_tool_quota` / h3-required-tools `tool_call_unresolved` (`harness:forcing-unused`, present at BASE too, 1/3 base -> 2/3 now, n=3); cogito rw-7 r1 `wrong-tool-arg`.

### Why the fix misses (root cause, verified zero-token)

`rax-diagnose cause` (HEAD+fix, qwen3:4b h3-continuation run0, `01M7AR77DRVNMBGVT71F2T6BWZ`):
```
cause=stall-after-work confidence=decisive status=failure authority=unclassified:stall_deliverable
evidence  guard-fired#116  stall_deliverable: consecutiveStalled 4/4; artifacts=1
attribution harness (harness:false-veto) confidence=decisive
```
Trace: `exit_gate` deny x4 with `outstanding: ["actually complete the requested action - no successful tool call has made it take effect yet ..."]`, i.e. `SideEffectLanded` is still seeded.

1. The tool surface in these runs is `["file-read","file-write"]` (`tool-surface-resolved`: file-read `visible: required`, file-write `visible: builtins-floor`). `surfaceCanLandSideEffect` (`verify/post-conditions.ts`, added by `5abfa34e3`) returns true when ANY substantive non-retrieval tool is present, and the builtins-floor `file-write` is such a tool. The unit test for the fix uses a retrieval-only surface (file-read alone), which is not the surface the bench or most real agents get (builtins floor adds a write tool). Reproduced zero-token: `seedPostConditions(deriveConditions(task,["file-read"],["file-write"]), surface, {task})` gives `[ToolCalled]` for surface `file-read` but `[ToolCalled, SideEffectLanded]` for `file-read + file-write`.
2. Why `SideEffectLanded` is derived at all for "Read X and tell me the value ... Reply with that value" and "Add the two counts together and reply with the sum": `derive-conditions.ts:54` `MUTATION_VERB` matches `reply`/`add` and `derive-conditions.ts:687` pairs it with `EXTERNAL_RESOURCE_NOUN`, which matches `task` in the bench preamble "Working directory for this task: ..." (`packages/benchmarks/src/run-internal.ts:336`). Zero-token check with `deriveConditions`: both prompts give `[ToolCalled]` WITHOUT the preamble and `[ToolCalled, SideEffectLanded]` WITH it. So the trigger is the bare prose heuristic (verb "reply"/"add" + noun "task" anywhere in the text), not any intent to mutate an external resource.
3. At BASE the condition existed too but was satisfied by the `file-read` result (retrieval credited). `795a51884` made reads not count, which exposed the over-derived condition. The fix patched one surface shape; the boundary is the derivation.
Boundary-level recommendation for kernel-warden (not edited): make `SideEffectLanded` derivation intent-based, at one place. Options in order of preference: (a) tighten `derive-conditions.ts:687` so answer-shaped verbs (`reply`, `add`, `set`) never seed it and the noun scan ignores harness preambles (derive from `extractCurrentTurn` body that excludes the bench/workspace preamble); (b) in `seedPostConditions`, decide on whether the task names an OUTWARD verb (`OUTWARD_EFFECT_VERB`) regardless of which write tools exist on the surface, instead of keying on `surfaceCanLandSideEffect`. Pin: H3 `h3-continuation` and `h3-exact-value` end `success` on both tiers with the real bench surface (file-read + file-write floor), red today. The zero-token scenario that passed 5abfa34e3 used the wrong surface; use `tool-surface-resolved` from the live trace as the fixture.

### Finding 2 re-isolated (meta-only calls leave the action requirement outstanding)

Probe: `.repo-logs/ablation-probe/probe-act4-act5.ts act5 qwen3:4b 4` at HEAD (live, 4 runs, traces `/home/tylerbuell/ablation-traces/probe3/qwen`). Result: 3/4 `abstained`, 1/4 `end_turn` + `success` with output "The email has been successfully sent ..." (fabricated; no email tool exists). Run `01M7ATH6Q442GEZDMMVY01B251`.

Instrument caveat first: in all 4 runs the surface was empty of domain tools (`tool-surface-resolved visible: []`, `run-started.config.tools = {metaTools:[recall, staticBriefInfo]}`, only `recall` ever invoked). The probe's custom `web-search` tool never reached the surface (likely shadowed by the same-named built-in; not verified). So act5 as written is a "no domain tool" scenario and says nothing about the retrieval-skip in its intended direction. The earlier REWORK of A does not depend on act5.

What it does show, reproduced: `contract-compiled` has `action:send-message` (kind `action-required`) and the ledger keeps it `declared` to the end; `exit_gate` is `accept` with `outstanding: []` (no post-condition seeded: `seedPostConditions(..., surface=[])` returns `[]`, verified zero-token; with `web-search` on the surface it returns `[SideEffectLanded]`). The terminal verifier then passes `action-success` because the last tool result, `recall` (called with `content`, a save), succeeded. In the three abstaining runs the same verifier flagged `final-answer returned success=false` because the last `recall` was a plain query that returned nothing. So the verdict flips on whether the model's last meta-tool call happened to succeed (1/4 vs 3/4), not on whether the requested action took place.
Boundary hypothesis (kernel-warden, not edited): two terminal authorities disagree about "did the action happen". (a) `verifier.ts:324` `action-success` reads the last tool result of any kind; it should read the last SUBSTANTIVE (non-meta) result, the rule `isSideEffectLanded` already uses (`post-conditions.ts` ledger scan skips non-substantive tools). (b) An `action-required` contract requirement still `declared` at termination should reach the exit gate as outstanding (the gate reads post-conditions only), or the requirement should be derived from the same single function that seeds `SideEffectLanded`, so the surface-empty case yields an honest non-success. Fix at the shared finalize/verify boundary, not per strategy (AGENTS.md pitfall 12).

### Verdict update

| item | verdict | basis |
|---|---|---|
| fix `5abfa34e3` | **REWORK** | does not clear the regression: 0/12 `success` on the two target tasks at HEAD+fix (BASE 12/12), billed tokens x2.2 to x2.5, `harness:false-veto` x12; gate REJECT on the target slice. Real-surface (file-read + file-write floor) not covered by its unit test. |
| status guard `fc0136042` | **WORKS on the slice, MISSES at suite level** | rejects A-only (0/6 -> 6/6) and HEAD on the target slice; does not fire on the 12-task suite (tier-pooled delta under the 25pp threshold, INCONCLUSIVE qwen tier). Recommend a per-task non-success read (a task going 0/k -> k/k). Owner: benchmarks/harness-warden. |
| bundle HEAD vs `cbc9a5414` | **REWORK** (unchanged) | open until the two target tasks end `success` at HEAD |

Ledger: 6 entries appended by `rax eval gate --ledger` (3 full-suite, 3 target-slice; all `void`, 0 activations). They duplicate each other in intent; read the target-slice rows for the status regression.

## Re-measurement after the clause fix

Headline: the kernel fix `d1eb475e9` (clause-scoped `SideEffectLanded` derivation + unlanded-action exit-gate requirement) clears the regression. h3-continuation and h3-exact-value end `status=success` in **12/12** dedicated live runs (BASE 12/12, HEAD+`fc0136042` 0/12). No new regression class found. Verdict on the fix: PASS as a regression repair (not a lift claim; there is no lift to claim, the goal is parity with BASE).

Setup: dev HEAD `d1eb475e9`, reasoning `dist` rebuilt (turbo cache hit; `dist/index.js` contains `namesMutationOfResource`). Same runner `h3/run-h3.ts`, k=3, qwen3:4b and cogito:8b, USD 0. Raw: `fix2-head.json` (full suite, 72 cells), session `session-v3.json` / `session-v3-targets.json` (BASE = `base.json` from the earlier run, traces read for `endStatus`). Targets-only runs (12 cells, `/home/tylerbuell/ablation-traces/fix2-targets-*.json`) were run first. `/tmp` 2.3 GB used before and after.

### Target tasks (dedicated run, 12 cells)

| task | tier | success / n | tokens/run BASE -> HEAD+clause fix (HEAD+`fc0136042`) |
|---|---|---|---|
| h3-continuation | qwen3:4b | 3/3 | 1.6k -> 1.7k (4.5k) |
| h3-exact-value | qwen3:4b | 3/3 | 2.5k -> 2.6k (5.8k) |
| h3-continuation | cogito:8b | 3/3 | 1.1k -> 1.4k (4.7k) |
| h3-exact-value | cogito:8b | 3/3 | 3.5k -> 2.1k (5.6k) |

Count `status=success` on the two target tasks: **12/12** (acc 1.00 in all 12). Tokens are back at BASE, not 2.5x.

### Full 12-task suite, k=3, both tiers (72 cells), gate vs BASE (billed tokens, per-task status read)

| tier | acc BASE -> fix | billed | status non-success | tier verdict |
|---|---|---|---|---|
| qwen3:4b | 86.2 -> 81.2 (-5.1pp) | +22.4% | 12/35 -> 11/36 | INCONCLUSIVE |
| cogito:8b | 63.0 -> 69.9 (+6.9pp) | +13.8% | 13/36 -> 11/36 | BELOW (+6.9pp, not above 95% band) |

Decision: **UNDERPOWERED** (6.9pp aggregate, 13.8% billed; at k=3 and ~33pp per-task SE it cannot resolve 3pp; not evidence of no effect). Target slice (`session-v3-targets.json`, 8 cells from the full run): OPT-IN, status non-success 0/6 -> 0/6 qwen, 0/6 -> 1/6 cogito. The status gate (`082d3420d` per-task read) did not fire; no task went 0/k -> k/k non-success. Ledger: 2 entries appended (`void`, 0 activations).

Per-task non-success, BASE -> fix (n=3 each; all under the noise rule, none claimed): qwen rw-6 3->1, rw-7 1->0, h3-todo-heavy 0->1; cogito rw-6 3->2, rw-7 2->1, rw-9 1->0, h3-required-tools 1->0, h3-exact-value 0->1, h3-todo-heavy 0->1.
Explained outliers: qwen rw-7 accuracy -66.7pp is a BASE artifact (BASE run 0 was a 0-token `error` scored 0; BASE runs 1-2 scored 1.0, fix runs 0.67/0.33/0; token cost 5.4k -> 22.5k/run, 3 cells, not resolvable). Billed excess (+22%/+14%) comes from qwen rw-7, qwen h3-todo-heavy (11k -> 19k) and cogito h3-plan-only (9.5k -> 15.5k); none is on the SideEffectLanded path.

### The two non-success cells that touch the target area or the old signature

1. cogito h3-exact-value run1 (full suite): `failure`, accuracy 0, 5.2k tokens. `rax-diagnose cause`: `dispatcher-early-stop`, attribution `harness:premature-stop` decisive. This is a wrong answer plus a premature stop, not the old false-veto (the exit gate there was not holding a correct answer). The same cell was 3/3 success in the dedicated run, so 1/6 across the two sets; n too small to call a rate. Watch item.
2. `rax-diagnose attribute --all` on the 72 cells: `harness:false-veto` = 1 (was 12 at `fc0136042`): cogito h3-todo-heavy run1, `max_iterations` 14/14, exit gate `accept`, `outstanding: []`, verifier terminal-outcome. A cap cutoff on a 6-file task, different mechanism from SideEffectLanded.

### act5 probe (qwen3:4b, 8 runs, `probe-act4-act5.ts`, traces `/home/tylerbuell/ablation-traces/probe4`)

Result: 8/8 `abstained`, `success=false`, `claimsSent=false`. Fabricated success **0/8** (earlier at `fc0136042`: 1/4, run `01M7ATH6Q442GEZDMMVY01B251`). Consistent with the unlanded-action requirement now holding the exit open. Caveats: the instrument fault from before persists (all 8 runs `tools = {metaTools:[recall, staticBriefInfo]}`, the custom `web-search` never reached the surface), so this is still the meta-only/no-domain-tool shape; 0/8 vs 1/4 is not a significant difference (p ~0.3). The 3/4 earlier abstentions were already honest. The `verifier.ts:324` `action-success` last-result-of-any-kind path was not exercised here; if fabrication reappears, check that path (it reads `recall`'s own success).

### Verdict update

| item | verdict | basis |
|---|---|---|
| clause fix `d1eb475e9` | **PASS (regression repaired)** | 12/12 target success (BASE 12/12), tokens at BASE, false-veto 12 -> 1 (unrelated cap case), suite UNDERPOWERED with no per-task status regression |
| status gate `082d3420d` | works | would have rejected target slice at `fc0136042`; silent here as it should be |
| bundle HEAD vs `cbc9a5414` | REWORK closed for mechanism A; B stays INCONCLUSIVE, C/D not exercised | unchanged from earlier |
| open | k=3 suite cannot resolve <~26pp per task; cogito h3-exact-value premature stop 1/6 and qwen rw-7 token growth are watch items | |
