---
type: plan
status: draft
created: 2026-11-19
tags: [h3, suite-v2, headline, with-without, lift, pre-registration, calc-lever, code-execute, plain-loop, cost]
---

# Suite v2 (calculation lever) and the with/without headline measurement

Design only. No task was edited, no live run started, no `packages/**` file touched. Author: harness-warden. Zero model tokens spent; the only computation was a power simulation (`wiki/Research/Harness-Reports/2026-11-19-headline-plan/power-sim.py`, output beside it).

Inputs: top-failures report `wiki/Research/Harness-Reports/2026-11-19-top-failures/README.md` (class 1), gate v2 spec `wiki/Research/Audits-2026-11-18-measurement/04-gate-v2-spec.md`, measurement overhaul `wiki/Planning/Implementation-Plans/2026-11-18-measurement-overhaul.md`, `packages/benchmarks/src/h3/{tasks,freeze,run-h3,paired}.ts`, `src/run-internal.ts`, `src/session.ts`, `src/scorer-version.ts`, v0.19 results in `wiki/Research/Harness-Reports/2026-11-18-h3-v0.19-final/`.

## Summary of recommendations

1. **Suite v2 should be ADDITIVE.** Three new task ids (`rw-2-calc`, `rw-3-calc`, `h3-plan-only-calc`) that are the frozen definitions plus one `{ kind: "available", name: "code-execute" }` entry. The frozen 12 keep their hashes; the committed baselines stay comparable. An in-place cut would stale 3 of 12 task hashes in about 190 committed result files and breaks the "never edit in place" rule in `h3/tasks.ts`.
2. **The honest counterfactual is a plain tool-call loop that does not exist yet.** `.withLeanHarness()` is not minimal: it swaps in a no-op verifier and turns strategy switching off, and the whole kernel (classifier, context assembly, guards, nudges) still runs. The old `manual-react` variant (`{ tools: true }`) used to hit RA's inline direct-LLM loop, but that arm was deleted on 2026-08-23 (`execution-engine.ts:464-476`); today it routes through the kernel too. A plain loop has to be built in `packages/benchmarks` (about 100 lines on the same `LLMService`, same tool implementations, same scorer).
3. **Headline design:** per model, default harness arm vs plain-loop arm, same tasks, interleaved, k=10 per cell, task-stratified risk difference with the gate-v2 Newcombe-Wilson hybrid interval, primary = the 10 answerable ("capability") tasks, honesty traps reported on their own line. Tiers: qwen3:4b, cogito:8b (core), qwen3:14b (recommended third local tier), claude-haiku-5-5 and claude-sonnet-5-5.
4. **Cost.** Core local (qwen3:4b + cogito:8b) about 9 GPU hours at k=10. Frontier is cheap: haiku-5-5 about $2.8 expected, sonnet-5-5 about $8.3 expected (with a 20% pilot allowance; pricing is a proxy, see section B5). Details below.
5. **Honest limit:** at k=10 the interval half-width is about 10pp per tier, and power is 88% for a true 16pp suite-wide gap but only 64% for 12pp and 19% for 6pp. A flat result is likely to be "no measurable difference", not "equivalent". The plan pre-commits to publishing that.

---

# Part A: suite v2

## A1. What changes, exactly

Today `rw-2` and `rw-3` declare no `tools` field. `run-internal.ts` then takes the legacy path: fixtures present, so `builtins = ["file-read", "file-write"]`, grounding set `["file-read"]`. `code-execute` is never offered. `h3-plan-only` declares `[required file-read, required file-write]` and no `code-execute`. `h3-required-tools` and `rw-7` already declare `{ kind: "available", name: "code-execute" }`.

v2 task definitions (derived by a pure function over the frozen task, in a new `h3/tasks-v2.ts`):

| v2 id | derived from | `tools` after |
|---|---|---|
| `rw-2-calc` | `rw-2` | `[required file-read, available code-execute]` |
| `rw-3-calc` | `rw-3` | `[required file-read, available code-execute]` |
| `h3-plan-only-calc` | `h3-plan-only` | existing two required entries plus `available code-execute` |

Why `required file-read` only on the first two: `computeGroundingSet` (`run-internal.ts:97-108`) feeds only `required` names to `.withRequiredTools()`. Required `[file-read]` is exactly today's legacy grounding set (`declared ?? ["file-read"]`), so the terminal gate is unchanged. `file-write` still arrives through the fixtures add-on (`builtins` adds it when fixtures exist). The rw-2 lesson in that file (requiring `file-write` killed qwen3:14b rw-2 on 2026-07-07) is respected. `toolsToExpose` (`core/src/contracts/task-contract.ts:116`) also exposes `available` names, so `code-execute` reaches the builder's `builtins` floor.

Unchanged by construction: prompt, fixtures, hidden check, `successCriteria`, `maxIterations`, scorer version (stays 3), `abstainExpected`. Nothing here is a scorer change, so no comparability break from grading; the only thing that moves is the tool surface, which is the experiment.

The derived tasks get new ids on purpose. Grading never dispatches on `rw-2`/`rw-3` ids (the only id dispatches are `task.id === "rw-9"` in `run-internal.ts:460` for the price server and `FABRICATION_CHECKED_TASKS = {"rw-6"}` in `fabrication-count.ts:17`), so a renamed derived task grades through the same hidden checks.

## A2. What re-hashes and what becomes non-comparable

**Additive (recommended):**
- New entries for three ids in a new manifest `h3v2-manifest.json` (written by `freeze.ts`, which gains a v2 branch). `h3-manifest.json` is not touched; `h3-suite.test.ts` keeps passing unchanged.
- New test pins: the nine unchanged frozen ids equal `h3-manifest.json`; each `-calc` task equals its source modulo `id` and `tools` (a derivation test, so the pair cannot drift apart).
- New suite fingerprint for the 12-task headline set (section B3). The frozen 12-task fingerprint `7e817bb0...` is untouched.
- Nothing committed becomes non-comparable. The v0.19 default-arm numbers on the frozen 12 stay valid. The lever itself becomes a free A/B: `rw-2` vs `rw-2-calc` under the same default harness, same tier, same SHA.

**In-place cut (not recommended), for the record:**
- Per-task hashes of `rw-2`, `rw-3`, `h3-plan-only` change, so the suite fingerprint changes. About 190 committed result files carry `taskHashes` (counted with a recursive search of `wiki/Research` and `packages/benchmarks`): the largest groups are the act-or-answer ablation (25), progress-aware-exit (19), input-coverage (11), the 11-03 and 11-04 H3 baselines, the 11-13 recent-default ablation, the v0.19 final/rerun pair, and the zoo-live runs. Each would have 3 of 12 tasks measured on a different surface than any new run, so every 12-task figure would have to be restated as 9-task.
- `h3-manifest.json` and the freeze test would be rewritten, which is the "deliberate re-freeze" the file header warns against.
- No gate enforces hashes between result files today (`verdict.ts` does not read `taskHashes`; gate v2 task B3 would). So the cut would not be caught mechanically; it would silently mix surfaces. That is the stronger reason to stay additive.

**Recommendation: additive.** Cost of additive: three near-duplicate tasks (same fixtures, same grader) exist beside their originals. They are not independent observations, so the headline set uses the calc version in place of the original (never both; section B3), and cross-suite claims count a lever pair as one cluster.

## A3. Fresh baseline for the v2 tasks

Needed because no default-arm data exists for the three ids.
- Lever pilot: default arm, k=5, cogito:8b and qwen3:4b, three tasks (15 cells per tier: about 6 min on cogito, about 25 min on qwen3:4b from the v0.19 per-cell wall times). Gate: keep the v2 tasks only if the lever visibly engages (a `code-execute` call before the figure write in at least a third of runs, read from `tool-call-start` events) and at least one task leaves the floor. If `rw-2-calc` stays 0/5 with `code-execute` called, the failure is the second step (spotting the stock-out), not arithmetic; the top-failures report already says that second step is unproven. In that case the v2 task stays in the suite but is classified "floor" and does not count toward discriminative power (gate v2 B2).
- Reference-baseline status (gate v2 section 8 asks for at least 15 runs per task from 2 sessions): the headline default arm (k=10) plus the pilot (k=5) is 15 runs from 2 sessions on the same SHA only if no code changes between them. If the SHA moves, they are separate baselines. Prefer to do the pilot after the SHA freeze (section C step 4), or accept the headline as the first reference session and top up later.
- Visibility check before any live cell (zero token, one scripted run per task): print `tool-surface-resolved.visible` for each v2 task and confirm `code-execute` is in it. The tool-surface confound (memory `feedback_tool_surface_confound`) has voided four findings; the classifier or budget path can hide an `available` tool. `code-execute` also carries `requiresApproval: true` (`tools/src/skills/code-execution.ts:291`); `rw-7` and `h3-required-tools` already run it in the bench, so the approval policy is not expected to block, but the zero-token check should confirm.

## A4. The kernel-side lever question (separate from the suite)

Abstract failure mode: **a figure is derived by arithmetic or aggregation in the model's head when a calculation tool is available.** Evidence (top-failures class 1): cogito `h3-required-tools` writes `20.45` for a true mean of `21.83` in 13 of 15 runs with `code-execute` visible and never called; `h3-plan-only` `totalUnits` wrong in 14 of 14 (no lever offered); qwen3:4b `rw-2` 0/10 (no lever offered). About 43% of small-model loss. The 2026-11-15 compute-offload spike reached the same family (35% of accepted runs on figure-checking tasks wrong) and recommended a surface-plus-guidance mechanism behind an ablation; neither landed.

**Should the harness nudge it? Yes, as guidance and not as a gate, spike first.** Proposed shape:
- Trigger, deterministic and computable from data (Golden Rule 5): the task text asks for an aggregate (mean, average, sum, total, count, median, per-group comparison) OR the model's pending write carries a numeric figure absent from the task text and from every tool result so far; AND `code-execute` is in the visible surface; AND it has not been called this run.
- Effect: one entry in `state.pendingGuidance` (Pitfall 9: guidance section of the system prompt, never a stray USER message) naming `code-execute` and the data to feed it. One shot per run. Not a refusal, so it cannot create a false veto (the `harness:false-veto` class cost 12 runs on 2026-11-13).
- Reuse: `fabrication-count.ts` already computes "figure not in the task text or run evidence" (`fabricatedFigures` over `runEvidenceOf(trace)`). The trigger's second arm is the same predicate used pre-write instead of post-hoc. Prefer extending that module to a second consumer rather than writing a new detector.
- Do not fire on trivial arithmetic: `h3-exact-value` (412 + 931) and `h3-todo-heavy` (doubling six integers) must not be nudged into a tool call that costs more than the in-head step. Pre-register an operand-count floor (for example, at least 5 numeric operands in evidence, or an aggregation verb over a file).
- Owner: kernel-warden (trigger and `pendingGuidance` in `packages/reasoning/src/kernel/capabilities/act/` and the reason/think guidance render), tools-warden (confirm the `code-execute` description and surface visibility; the description already says "Best for: math, aggregation", so the lever is the guidance path, not the description). Ablation-warden runs the bar (at least 2 tiers, 3pp, at most 15% token overhead) before any default-on. Reasoning exports `dist`: rebuild before any live cell.

**Spike steps (zero token first, per the 2026-11-06 owner rule on spikes):**
1. Trigger census over saved traces: how often the predicate fires on the v0.19, zoo-live and ablation traces, split by task. Expectation: fires on `h3-required-tools` (all 15 cogito runs), `rw-2`, `h3-plan-only`; must not fire on `h3-exact-value`, `h3-continuation`, `h3-todo-heavy`.
2. Phase Z shape `head-arithmetic` (policy model in `packages/benchmarks/src/sim/`): scripted model reads a CSV and writes a hand-computed wrong mean, with a compliant branch that calls `code-execute` once guidance is present. Assert: guidance emitted once; with it the scripted run reaches a `code-execute` call before `file-write`; mechanism verdict on `h3-exact-value` and `h3-todo-heavy` shapes is `neutral`, not `hurts`.
3. One live cell only after 1 and 2: cogito `h3-required-tools` k=10 (the only cell where the lever is already offered and unused; 0/15 today, qwen3:4b solves it 5/5 so the ceiling exists), with `h3-exact-value` and `h3-continuation` as no-regression cells. Pre-register per gate v2 section 7: proximal metric = share of runs with `code-execute` before the figure write; harm guard = iterations and billed tokens on `h3-exact-value`; predicted solved 0/15 to 6-12/15.

Dependency on the headline: the nudge is a harness mechanism. If it lands before the headline SHA freeze it is part of "the harness"; if it lands after, it is the next pre-registered run. It must not land mid-run.

---

# Part B: the with/without headline

## B1. The counterfactual

What "without the harness" can mean, and what each really disables:

| Candidate | What actually changes | Verdict |
|---|---|---|
| `.withLeanHarness()` | `_leanHarness = true`, memory off, skill persistence off (`builder/withers/memory.ts:60`); `runtime.ts:347,374`: strategy switching off, terminal verifier replaced by `leanModeVerifier`. Kernel loop, tool-surface resolution, classifier, context assembly, duplicate and stall guards, guidance, required-tools gate all still run. | A one-gate ablation, not a counterfactual. Keep as an optional third arm. |
| `HarnessProfile.lean()` (`.withProfile`) | Also turns reactive intelligence off. Still the kernel. | Same objection. |
| `manual-react` variant (`{ tools: true }`) | Was RA's inline direct-LLM loop (system prompt a 33-character constant; July autopsy `2026-07-07-a1-manual-react-autopsy.md`). The inline arm was deleted 2026-08-23 (`execution-engine.ts:464`); `createRuntime()` always provides `ReasoningService`. Not verified live; verify with a zero-token run that a `{tools:true}` cell emits `llm-exchange` events. | Today most likely the kernel with default reasoning options. Not a baseline. The July "manual-react beats ra-full" numbers are not reproducible. |
| Vercel AI SDK / LangChain competitor runners | Independent loops, but expose only `file_read`/`file_write`, own prompts, `temperature: 0`, `usage.totalTokens` not billed tokens. | Different tools and accounting: fails "same tools". Useful later as external context, not as this baseline. |
| **Plain tool-call loop (new)** | `LLMService.complete()` with native function calling; the task's declared tools through the same tool implementations and file root; the task prompt as the user turn; minimal fixed system prompt; stop on a turn with no tool call; cap at `task.maxIterations`; same cell timeout. No classifier, no kernel guards, no guidance, no verifier, no required-tools gate, no context compression, no meta-tools. | **Recommended primary counterfactual.** |

**Build it** (harness-warden, `packages/benchmarks`): a variant `plain-loop` run by a new `plain-loop.ts`, selected by `run-h3.ts --arm plain`. Parity requirements, each with a test:
- Same provider layer and model resolution (so Ollama `num_ctx`, `think` handling, temperature, capability profile are identical; this is why it should reuse `LLMService`, not a second SDK).
- Same tool implementations and file root; the visible tool set equals the default arm's declared set per task (print `vis` for both arms in the receipt; the default arm additionally gets kernel meta-tools by design, listed in the report, not hidden).
- Same hidden-fixture scorer (`scoreTask`), same scorer version 3, same `isSolved`.
- Billed-token accounting that counts every LLM call in both arms (the default arm's classifier and structured-output side calls are billed; the 2026-07-07 harness-tax report found trace attribution misses them, so use the billed counters, and assert in a scripted test that billed equals the sum of per-call usage for both arms).
- Same trace writing so `rax-diagnose` can label plain-loop losses.
- A timed-out cell keeps its tokens and counts as unsolved in both arms (audit 03 D6).

Disclosures that go in the report unchanged:
1. The default arm receives the task contract's `required` tools through `.withRequiredTools()` (`run-internal.ts:178-206`), which a user must declare themselves. The honesty traps (`ab-trap-4`, `ab-trap-5`) depend on it. Hence the separate honesty line in B3.
2. "Default harness" means `H3_VARIANT` (`tools: true, reasoning: true`, strategy taken from the task: `plan-execute` for `rw-3` and `h3-plan-only`), the arm of every existing baseline. It is not necessarily what a user gets from a bare builder.
3. Systematic difference in prompting: the default arm re-embeds the task as `Goal:` in a system prompt of about 930 characters (July autopsy); the plain loop does not. That is part of what is being measured.

**Optional decomposition arm (owner approval):** `ra-lean` (`.withProfile(HarnessProfile.lean())`) on the two core local tiers only. It tells whether any gap lives in the kernel at all or in the gates. Cost: about +50% of the default-arm local hours. Not needed for the headline claim.

## B2. Tiers

| Tier | Why | Notes |
|---|---|---|
| qwen3:4b (4B local) | The small-model tier; its h3 data is the richest (v0.19 final plus rerun, 0.93 mean accuracy on the frozen set). | In `H3_TIERS` already. Slowest local tier (about 13 min per 12-task pass). |
| cogito:8b (8B local) | Standing baseline model; 0.74 mean accuracy, floor on four tasks; the biggest room for harness effects. | In `H3_TIERS`. |
| qwen3:14b (14B local) | The owner asked for 8-14B; a second mid point guards against a cogito-specific result. | `ollama/qwen3:14b` and `cogito:14b` both have static capability entries (`llm-provider/src/capability.ts:533,553`), so no `fallback` 2048-context void. Not in `H3_TIERS`; add it. Both pulled locally (16 GB GPU fits 9 GB models). Recommend it as the third tier, owner-optional. |
| claude-haiku-5-5 | Frontier-class cheap model. Static entry `anthropic/claude-haiku-5-5` (`capability-anthropic.ts:64`), `rejectsTemperature: true`, no thinking. | Add a frontier tier to `H3_TIERS` (the runner only knows local tiers today; the 11-13 ablation used no paid tier for this reason). Provider `anthropic`, needs `ANTHROPIC_API_KEY` from `.env`. |
| claude-sonnet-5-5 | Frontier-class stronger model, 1M context, adaptive thinking. | Same addition. |

The claim is made per tier ("on N of M tested models"), never pooled across tiers, and each tier needs its own interleaved A/B in one session.

## B3. Tasks and statistics

**Headline set (12 tasks):** the 9 frozen tasks that are unchanged (`rw-6`, `rw-7`, `rw-9`, `ab-trap-4`, `ab-trap-5`, `h3-todo-heavy`, `h3-required-tools`, `h3-continuation`, `h3-exact-value`) plus the three `-calc` tasks, which replace `rw-2`, `rw-3`, `h3-plan-only`. Reason: with no lever offered both arms must do arithmetic in their head and both land on the floor, which carries zero information and wastes the slowest cells (rw-2 is 83 s per cell on qwen3:4b). The calc tasks give both arms the same lever.

Pre-registered classes, fixed now and not revisited after data:
- **Capability set C (10 tasks):** `rw-2-calc`, `rw-3-calc`, `rw-6`, `rw-7`, `rw-9`, `h3-plan-only-calc`, `h3-todo-heavy`, `h3-required-tools`, `h3-continuation`, `h3-exact-value`.
- **Honesty set H (2 tasks):** `ab-trap-4`, `ab-trap-5`. A plain loop is not built to decline; the default arm declines through harness machinery that depends on the declared `required` tool. They answer a different question ("does it admit it cannot do this") and are reported as their own line, not folded into C.

**How many are discriminative.** Gate v2 says discriminative means reference pass rate in [0.1, 0.9). From the v0.19 final plus rerun files (10 runs per task, default arm, v2 scoring): qwen3:4b has 2 discriminative tasks (`rw-3` 2/10, `rw-6` 7/9) and cogito:8b has 3 (`rw-3` 4/10, `rw-6` 6/10, `h3-todo-heavy` 1/10). Floor (below 0.1): qwen `rw-2`, `rw-7`; cogito `rw-2`, `rw-7`, `h3-plan-only`, `h3-required-tools`. Canary (0.9 and above): the rest, including both traps. So about 2 to 3 per tier, consistent with the gate spec. This is the central power limit: most of the 12 strata add no signal when both arms sit at 0 or 1. The headline is a paired difference over a fixed suite, not a promotion test, so we keep all 10 capability strata (dropping tasks after seeing data would be gaming), but we size it knowing the information lives in about 3-5 of them plus whatever the plain loop moves off the floor or ceiling. The calc tasks are expected to add one or two discriminative strata for cogito; unproven (A3).

**Estimator** (gate v2 section 3, fixed-suite weighting): per tier, strata are tasks with equal weight; `RD = mean_t (p_harness,t - p_plain,t)`; interval = stratified Newcombe-Wilson hybrid at two-sided 95% (z = 1.96). The hybrid is conservative when many strata sit at 0/n or n/n (Wilson widths do not collapse), which is the honest direction. Reuse `gate-v2-acceptance/rule.ts` and `h3/paired.ts`/`gate/exact.ts` (`pairedLift`, `fisherExactP`, `holmAdjust`); a thin `h3/headline.ts` report is the only new analysis code, and it is committed before any live cell.

Per-task: exact Fisher p and Holm across tasks (existing `paired.ts`), a table of all 12 with solved counts, plus the harness-hurt list (any task with a difference of -20pp or worse in either direction of concern is listed with its `rax-diagnose cause` and a trace id).

Secondary metrics (reported with the same prominence, none can rescue a failed primary):
- Billed tokens per run and per solved run, ratio default/plain with the gate v2 stratified permutation test (section 4 of the spec). Tokens per solved run is the figure that guards against a cheap-because-it-gives-up arm.
- Wall time per cell, turns, termination cause mix.
- Mean graded accuracy (partial credit) alongside solved rate.
- `pass^k` per task (tau-bench estimator) for reliability.
- Fraction of the default arm's losses that carry a `harness:` attribution label, from `rax-diagnose attribute --all` (sets expectations: the audit showed only 6% do).

**Sample size and CI** (`power-sim.py`, zero token, 800-1500 replicates each, true rates taken from the v0.19 pooled per-task counts):

| k per cell | mean CI half-width (C-set RD) | power if the true RD is 16pp (harness +40pp on 4 mid tasks) | 12pp | 6pp |
|---|---|---|---|---|
| 5 | 14pp | 57% | 34% | 10% |
| **10** | **10pp** | **88%** | **64%** | **19%** |
| 15 | 8pp | 99% | 81% | 23% |

Whole-suite half-width on the 12-task frozen rates at k=10 is 8.4pp (qwen) and 8.6pp (cogito); at k=15, 6.4 and 6.7. The simulation assumed independent runs within a cell (no seed pairing; Ollama seed behaviour is unverified per the overhaul plan) and a plain arm differing from the harness on only a few tasks; a plain loop that collapses broadly would be far easier to detect.

Recommendation: **k=10 per (arm, task, tier)** as the base, **k=15 if the owner wants a clear read between 8 and 14pp**. Local arms are the expensive ones; frontier k is cheap and uses the same k for symmetry.

Interleaving: the runner visits cells run-major (`run-h3.ts`); the plan inner loop must alternate arms per (run, task) so host drift hits both arms equally (gate v2 section 9 voids non-interleaved arms). Single results file per tier holding both arms (cell ids already carry the variant).

## B4. Pre-registered decision rule

Committed to `wiki/Research/Ablations/<date>-headline/prereg.json` (schema from gate v2 section 7.1) with the analysis script, the task list and class assignment, the SHA, the reasoning `dist` hash, scorer version 3 and the model digests, BEFORE the first measured cell. Pilots (sanity, lever, plain-loop smoke) run before registration and are not pooled into the headline.

Per tier, on the capability set C, solved rate (`isSolved`, accuracy 1 at scorer v3, not inconclusive):

| Outcome | Condition | Allowed statement |
|---|---|---|
| HELPS | lower bound of the 95% CI on RD(C) is above 0, and the point estimate is at least +5pp | "On `<model>` the default harness solved X of N capability runs vs Y of N for a plain tool-call loop (RD +a pp, 95% CI [lo, hi]), at R times the billed tokens per solved run." |
| FLAT | CI includes 0 | "No measurable solve-rate difference at this sample (RD a pp, CI [lo, hi]). This does not show equivalence." Report tokens and the failure-case table; do not claim a quality advantage. |
| HURTS | upper bound below 0 | Publish as measured, with the harm list and the failures filed to wardens. Do not rerun and replace. |

Cross-tier: a sentence may say the harness helped on k of M tested models; it may not pool tiers into one number. Equivalence or non-inferiority is NOT claimable from this design (half-width about 10pp exceeds a 5pp margin); say so in the report.

Honesty line (set H): report solved counts and CI for both arms per tier as a separate sentence. If the plain loop passes the traps as often as the default arm, say so.

Efficiency: tokens per solved run ratio with permutation CI. If the harness costs more tokens and is not better, that is a result and gets stated first.

Failure cases: every task where the plain arm solves more than the default arm by at least 20pp at k=10, plus the three worst default-arm cells by token cost relative to plain, with `rax-diagnose cause` output and trace ids. These are reported even when the headline is positive.

**What we publish if flat or negative.** The same document, same prominence, within a week of the last cell, no framing as a "partial result". Flat: the numbers, the token overhead, and the failure analysis, with the explicit sentence that this suite at this n cannot tell the arms apart. Negative: the harm list with trace ids, the warden fixes that follow, and a fresh pre-registered rerun after the fixes; the original number stays in the record. Neither outcome changes what marketing copy may claim: the claim follows the number.

No-gaming commitments: no task or tier dropped after data; no post-hoc reclassification (the C/H split is fixed above); a cell may be rerun only if it is inconclusive by the preflight (infrastructure void), never because it is unfavourable; no change to the scorer, tasks, prompts or kernel between the first and last cell; the plain loop is built and its parity tests pass before the default arm's data is looked at.

## B5. Cost, for owner approval

### Local (GPU hours; single GPU, one model resident, runs are sequential)

Per-pass wall time for one 12-task pass of the default arm comes from the v0.19 final cell durations (qwen3:4b about 800 s dominated by `rw-2`, `rw-3`, `rw-6`, `h3-plan-only`, `h3-todo-heavy`, `rw-7`; cogito:8b about 234 s); the v2 headline set is assumed about 20% longer because the calc tasks add `code-execute` iterations. The plain arm is assumed 0.8 times the default arm (unmeasured; a plain loop may spin to the cell timeout on weak models, which is why the plan carries a pilot). qwen3:14b is an unmeasured guess of 2.5 times cogito:8b (range 2-4 times). Add 15% for model loads, preflight and resumes.

| Tier | per pass, both arms | k=10 | k=15 | pilot (k=2 smoke + lever pilot) |
|---|---|---|---|---|
| qwen3:4b | 29 min | 4.8 h | 7.2 h | 1.4 h |
| cogito:8b | 8.5 min | 1.4 h | 2.1 h | 0.4 h |
| qwen3:14b (optional) | about 21 min (guess) | about 3.5 h | about 5.3 h | about 1.0 h |

Totals with 15% overhead: **core local (qwen3:4b + cogito:8b), k=10: about 9.2 h; k=15: about 12.8 h. Adding qwen3:14b, k=10: about 14.3 h.** Contention rule: no other Ollama client on the host during runs (the runner refuses on contention unless `--allow-contention`).

### Frontier (tokens and dollars)

No frontier H3 token data exists. Assumptions, stated so the pilot can falsify them: harness arm mean 8k billed tokens per cell (local H3 means are 3.5-33k; frontier models take fewer turns but rw-7 and rw-9 are heavy), plain arm 4k, input to output ratio 85:15, no caching credit (upper bound), 12 tasks, k=10, both arms: 240 cells, 1.44M tokens (1.224M in, 0.216M out). Sensitivity: low 0.5 times, high 2.5 times (thinking tokens on sonnet, retries).

Prices for claude-haiku-5-5 and claude-sonnet-5-5 are **not recorded anywhere in the repo** (`capability-anthropic.ts` has context windows only; the cost router lists haiku-4-5 at $1/$5 and sonnet-4-6 at $3/$15 per million input/output tokens). The table uses those figures as a proxy. **Owner: confirm the 5.5 prices before approving**; the cost scales linearly.

| Model (proxy price per M in/out) | expected | low | high | with 20% pilot allowance (expected) |
|---|---|---|---|---|
| claude-haiku-5-5 ($1 / $5) | $2.30 | $1.15 | $5.75 | $2.76 |
| claude-sonnet-5-5 ($3 / $15) | $6.91 | $3.45 | $17.30 | $8.29 |

Both together, expected about $11, worst case about $28. Wall time per model about 1.7 h at 25 s per cell; frontier cells do not load the GPU but should still run apart from local runs for timing hygiene. Guard: a per-model hard stop at $25 spent, checked from billed tokens after each cell (the harness arm token explosion is the failure to watch).

Optional hard-task add-on for frontier only (owner approval): the long-horizon set (`h3/long-horizon-tasks.ts`: `lh-debug-green`, `lh-enumerate-audit`, `lh-pipeline-stages`; `lh-1` needs a search key) because frontier will saturate the 12. Rough cost, unmeasured: 3 tasks x k=5 x 2 arms = 30 cells at about 100k tokens, so $10 (haiku) to $30 (sonnet) proxy; also needs the plain loop to run in a workspace (`LH_A0_VARIANT` sets `workspace`).

---

# Part C: sequence and go/no-go

## What must land first

Already in: scorer v3 (`scorer-version.ts`), quick-mode grading fix (`ede2db3e3`), provenance recording (RunProvenance: dist hash, RA flags, digests, contention), paired-by-task verdict (`h3/paired.ts`), the duplicate-refusal fixes and the dead-tool honest-decline fixes (commits `f08652b1a`, `66531b642`, `132ae5515`, `d15d076d0`, `dd307bab7`).

Still in flight (kernel-warden): the todo-heavy line. The latest research commit (`cea5d53d6`) reports cause A down from 6 to 2 and solved 1/10 on cogito `h3-todo-heavy`, with the iteration budget now binding. Decision for the owner: freeze the SHA now and report todo-heavy as is, or wait for that line to close. Either way the SHA is frozen before the first headline cell and not changed during it.

Not required for the headline: gate v2 (B1-B8 build) and the lift-gate ratification. The headline uses `paired.ts` plus the gate-v2 interval from `rule.ts`, not a promotion verdict.

## Order of work

1. **Owner approvals** (list below). Zero cost.
2. **Zero-token build** (harness-warden, `packages/benchmarks`; each step `bun run repo verify packages/benchmarks`):
   a. `h3/tasks-v2.ts`, `h3v2-manifest.json`, `freeze.ts` v2 branch, derivation test, headline-set fingerprint.
   b. `plain-loop.ts` and `--arm plain` in `run-h3.ts`; arms interleaved per (run, task); frontier and qwen3:14b entries in `H3_TIERS`; per-model dollar stop.
   c. `h3/headline.ts` (RD with hybrid interval, Fisher/Holm table, tokens per solved with permutation CI, harm list, `pass^k`) plus tests on scripted cells and on the saved v0.19 files.
   d. Parity tests: tool surface `vis` equal across arms per task; scorer identical; billed accounting equal to per-call usage in both arms; a `{tools:true}` cell emits kernel `llm-exchange` events (the `manual-react` check).
3. **Zero-token checks**: visibility of `code-execute` on the three `-calc` tasks; kernel-side trigger census (A4 step 1) and Phase Z `head-arithmetic` shape (A4 step 2), owner kernel-warden.
4. **Pilots** (not pooled): lever pilot (A3) and plain-loop smoke (k=2 on cogito:8b, all 12 tasks, both arms) to measure real cell times and billed tokens; one frontier smoke cell per model to measure tokens and replace the 8k/4k assumptions in the cost table. Re-quote cost; owner re-approves if the frontier estimate moves by more than 2 times.
5. **Freeze**: land kernel fixes, rebuild `packages/reasoning` dist, record dist hash, tag-candidate SHA, write `prereg.json` and commit it with the analysis script. Then no changes.
6. **Runs**, one tier per session, each in foreground chunks under a 590 s timeout (never background, per the long-run rule), resumable: cogito:8b first (fastest, validates the pipeline), then qwen3:4b, then qwen3:14b if approved, then haiku-5-5, then sonnet-5-5.
7. **Analysis**: `h3/headline.ts`, `rax-diagnose attribute --all` and `cause` on the harm list, ledger entry (status baseline, decision recorded as measured, not a promotion), report under `wiki/Research/Harness-Reports/<date>-headline/`.
8. **A4 lever spike live cell** runs only after step 7 so the headline SHA is not disturbed; its result is the next pre-registered run.

## Go/no-go checklist (all must be true before step 6)

- [ ] Owner approvals below given.
- [ ] `bun run repo verify packages/benchmarks` green; `bun run repo check --all` green.
- [ ] Frozen 12-task manifest test untouched and passing; v2 manifest committed.
- [ ] Plain-loop parity tests pass; `vis` equal across arms printed for every headline task.
- [ ] Zero-token check: `code-execute` visible on all three `-calc` tasks, approval does not block.
- [ ] Lever pilot: `code-execute` engaged on at least a third of runs on at least one calc task, else the calc tasks are kept but labelled floor and the cost table is re-quoted.
- [ ] Plain-loop smoke: the arm completes cells inside the cell timeout on cogito:8b (no systematic timeout), billed tokens recorded.
- [ ] Frontier smoke tokens within 2 times the assumption, or cost re-approved.
- [ ] SHA frozen, dist hash recorded, working tree clean, no other Ollama client, preflight contention ok.
- [ ] `prereg.json` and the analysis script committed before the first measured cell.

No-go examples: a parity test fails (the plain arm exposes a different tool set or counts tokens differently), the plain loop times out on most cells (it is then measuring the loop, not the model), or the SHA changes mid-run.

## Owner approvals needed

1. **[OWNER] Additive suite v2** (three `-calc` task ids, new manifest) instead of an in-place edit of the frozen tasks. Recommended: additive.
2. **[OWNER] Counterfactual = plain tool-call loop**, built in `packages/benchmarks`, with the three disclosures in B1. Optional third arm `ra-lean` on the two core local tiers (about +50% local hours).
3. **[OWNER] Tiers.** Core: qwen3:4b, cogito:8b, claude-haiku-5-5. Recommended additions: qwen3:14b, claude-sonnet-5-5.
4. **[OWNER] Sample size:** k=10 (about 9.2 GPU hours core local) or k=15 (about 12.8 hours).
5. **[OWNER] Paid spend and prices:** confirm the 5.5 prices (proxies used); approve a frontier budget (about $11 expected, about $28 worst case, $25 per model stop) and use of the `.env` `ANTHROPIC_API_KEY`.
6. **[OWNER] Pre-registered classes and rule** (C/H split, HELPS/FLAT/HURTS thresholds, the publish-if-flat commitment, no equivalence claim).
7. **[OWNER] SHA-freeze timing** relative to the in-flight todo-heavy work.
8. **[OWNER, optional] Frontier long-horizon add-on** (about $10 to $30 proxy).
9. **[kernel-warden / tools-warden via parent] The A4 nudge** spike (census, Phase Z shape, one live cell). The kernel mechanism itself is not approved or scheduled by this plan; it follows the ablation-warden bar before any default-on.

## Risks and honest caveats

- The headline can come out FLAT with a 10pp half-width; that is a likely outcome on frontier (ceiling) and possible on 4B (many tasks at floor for both arms).
- A plain loop may do badly on small models for reasons unrelated to the harness mechanisms (for example Ollama tool-call formatting that the harness heals); that is a legitimate part of "with vs without" but should be named in the report when `rax-diagnose` shows it.
- The default arm's use of task-declared `required` tools is a harness feature a user must opt into; the report states it.
- The simulation is a precision estimate, not a prediction of effect; the effect sizes in B3 are scenarios, not forecasts.
- Spike-level numbers (cost, frontier tokens, plain-arm wall time, qwen3:14b time) are assumptions until the pilots measure them.
