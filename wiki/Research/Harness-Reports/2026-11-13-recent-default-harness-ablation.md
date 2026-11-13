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
