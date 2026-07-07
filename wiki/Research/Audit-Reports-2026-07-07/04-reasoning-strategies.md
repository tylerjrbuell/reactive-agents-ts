# Architecture Sweep 2026-07-07 — 04-reasoning-strategies

Evidence complete. Writing the audit.

## Findings (ranked by leverage)

**F1 — The entropy/RI-dispatch block is copy-pasted, not shared.** `plan-execute.ts:872-1021` (~150 LOC) and `tree-of-thought.ts:558-645` (~90 LOC) are near-identical: build `syntheticState`, `entropySensor.score(...)`, `reactiveController.evaluate(...)`, `dispatcher.dispatch(...)`, accumulate `perStrategyRiBudget`, scan `appliedPatches` for `early-stop`. Same literal calibration `{highEntropyThreshold:0.8, convergenceThreshold:0.4,...}`. reactive gets this for free inside the kernel (`reactive-observer`); reflexion/blueprint/adaptive/direct/code-action have NONE. Highest-leverage extraction: one `runOuterLoopController(...)` primitive would delete ~240 LOC and give the 3 dark strategies RI control.

**F2 — blueprint/worker.ts is a hand-copy of plan-execute/step-executor.ts.** worker.ts's own comments admit it: "mirrors step-executor.ts:151-165" (worker.ts:189), "mirrors step-executor.ts:199-204" (:237), "prompt/format is identical" (:272). The tool_call preprocess/heal/sanitize hooks and the analysis `llm.complete({maxTokens:4096, temperature:0.5})` (worker.ts:313) duplicate step-executor.ts:168-231 and :268-282. blueprint should import `executeStep`; instead it re-implements both branches and, in doing so, drops budgetLimits/calibration/requiredTools (worker.ts only forwards `harnessPipeline`, :245).

**F3 — Synthesis prompt is triplicated with drift.** The verbatim "EVIDENCE RULE … COMPLETION CHECK" synthesis block appears at plan-execute.ts:445 (single-analysis short-circuit) and plan-execute.ts:1083 (main synth). blueprint.ts:510 has a *shorter* variant (no EVIDENCE RULE). reflexion, by contrast, routes synthesis through the shared `buildSynthesisPrompt`/`enforceQualityGate` (finalize.ts). So the "DATA→FORMAT" gate is half-migrated: reflexion + plan-execute call `enforceQualityGate`; blueprint + ToT + code-action reinvent or omit it.

**F4 — Token/cost accounting is per-strategy and inconsistent.** Every non-kernel strategy hand-rolls `totalTokens += …`. plan-execute (plan-execute.ts:246-249) and plan-mutation.ts:116-119 *estimate* planner tokens as `raw.length/4 + prompt.length/4` — a different unit than the real `usage.totalTokens` used elsewhere in the same file (:468, :1104). Kernel strategies (reactive/direct) get normalized accounting via `runPass`/`state`.

**F5 — Invariant enforcement diverges sharply** (see table). plan-execute is the only outer-loop strategy with grounded-terminal + abstention; reflexion is the only one with a PostCondition artifact spine; blueprint/ToT/code-action ship success with no terminal grounding gate.

**F6 — The plumbing is already 60-70% extracted; the remaining duplication is concentrated in 3 spots** (F1/F2/F3). Shared already: service resolution (`resolveStrategyServices`), logging (`makeStrategyEmitLog`/`emitPhaseEnd`), event publish (`publishReasoningStep`), step/result build (`makeStep`/`buildStrategyResult`), kernel-input assembly (`buildKernelInput`), pass harvest (`runPass`), critique (`runCritiquePass`), quality gate (`enforceQualityGate`).

## Strategy × concern duplication matrix

Legend: OWN = private copy · SHARE = shared service · KERNEL = inherited from reactKernel · — = absent

| Concern | reactive | direct | plan-exec | reflexion | ToT | blueprint | adaptive | code-action |
|---|---|---|---|---|---|---|---|---|
| LLM call w/ params | KERNEL | KERNEL | OWN ×2 (+step-exec, +mutation ×2) | OWN ×1 (+SHARE) | OWN ×3 | OWN ×1 (+worker ×1) | OWN ×1 | OWN ×2 |
| Synthesis prompt | — | — | **OWN ×2** | SHARE (finalize) | — | **OWN** | — | — |
| Reflection/critique | — | — | SHARE (critique.ts) | SHARE (critique.ts) | OWN (batch-score) | — | — | OWN (verifier) |
| Retry loop | KERNEL | KERNEL | OWN (stepRetries+patch) | OWN (iterateUntil) | OWN (score-fallback) | OWN (patch-once) | — | OWN (verifier retry) |
| Required-tools gate | KERNEL | — | OWN (synth-step inject :315-363 + grounded) | OWN (getMissingRequired+PostCond) | KERNEL | OWN (verifyPlan) | — | — |
| Quality gate (`enforceQualityGate`) | KERNEL | — | SHARE ×2 | SHARE | — | — | — | — |
| Token/cost accounting | SHARE (runPass) | OWN (state) | OWN (+/4 est) | OWN | OWN | OWN | OWN (sums sub) | OWN |
| Event publishing | SHARE helper, OWN payloads | (few) | SHARE helper, OWN payloads ×12 | SHARE helper, OWN ×6 | SHARE helper, OWN ×5 | SHARE helper, OWN ×7 | SHARE helper, OWN ×5 | — (emitToCompose) |
| Step construction | SHARE | SHARE | SHARE | SHARE | SHARE | SHARE | SHARE | SHARE |
| Entropy/RI dispatch | KERNEL | — | **OWN :872-1021** | — | **OWN :558-645** | — | — | — |

## LLM call inventory (site → params)

reactive.ts:250 `runPass(reactKernel)` — temp `contextProfile.temperature ?? config.reactive.temperature`, maxIter min(profile, config).
direct.ts:164 `runKernel(reactKernel)` — temp `input.temperature ?? profile ?? config`, maxIter clamp(1..3, default 1).

plan-execute.ts:
- :224 `extractStructuredOutput(LLMPlanOutputSchema)` — maxRetries 2, **temp 0.5, maxTokens 4096** (plan gen)
- :276 `extractStructuredOutput` — maxRetries 1, **temp 0.3, maxTokens 4096** (rationale strict-retry, audit-gated)
- :440 `llm.complete` — **maxTokens 4096, temp 0.5** (single-analysis short-circuit)
- :852 `runCritiquePass` — temp 0.3 (shared), maxTokens `depth==="deep"?2500:THINKING_SAFE_MIN` (reflect)
- :896 `entropySensor.score` / :974 `dispatcher.dispatch`
- :1078 `llm.complete` — **maxTokens 4096, temp 0.3** (synthesis)
- :478 & :1211 `enforceQualityGate` → internal `complete` **maxTokens THINKING_SAFE_MIN, temp 0.2**
- step-executor.ts:268 analysis `complete` — **maxTokens 4096, temp 0.5**; :325 `executeReActKernel` — temp 0.5, maxIter `stepKernelMaxIterations??3`, exitOnAllToolsCalled true
- plan-mutation.ts:93 (patch) & :166 (augment) `extractStructuredOutput` — maxRetries 1, **temp 0.3, maxTokens 4096**

reflexion.ts:
- :184 `runPass(reactKernel)` generate — **temp 0.7**, maxIter `kernelMaxIterations??3`
- :232 `llm.complete` empty-generate backfill — **temp 0.7** (no maxTokens literal → provider default)
- :342 `runCritiquePass` — temp 0.3
- :477 `runPass(reactKernel)` improve — **temp 0.6**, maxIter `??3`, +blockedTools, initialMessages=runningMessages
- :536 `enforceQualityGate` — temp 0.2

tree-of-thought.ts:
- :223 `runKernel(reactKernel)` skip-bfs — temp 0.7, maxIter tierLimit.maxPhase2
- :347 expansion `complete` — **maxTokens max(800×breadth, THINKING_SAFE_MIN), temp 0.8**
- :418 batch-score `complete` — **maxTokens THINKING_SAFE_MIN+512×N, temp 0.2**
- :453 single-score fallback `complete` — **maxTokens THINKING_SAFE_MIN, temp 0.2**
- :585 `score` / :635 `dispatch`
- :681 `runKernel(reactKernel)` Phase2 — temp 0.7, priorContext=best-path string

blueprint.ts:
- :211 `extractStructuredOutput` plan — maxRetries 2, **temp 0.4, maxTokens 4096**
- :505 `llm.complete` solve — **maxTokens 4096, temp 0.3**
- worker.ts:313 analysis `complete` — **maxTokens 4096, temp 0.5** (dup of step-executor)
- plan-verify.ts — 0 LLM (deterministic)

adaptive.ts:185 classify `complete` — **maxTokens THINKING_SAFE_MIN, temp 0.2** (skipped on heuristic hit / local-tier).
code-action.ts:121 plan `complete` — **temp 0** ; :246 retry `complete` — **temp 0.1×iteration** (no maxTokens literals).

## Invariant divergence table

| Invariant | reactive | direct | plan-execute | reflexion | ToT | blueprint | code-action | adaptive |
|---|---|---|---|---|---|---|---|---|
| Grounded-terminal (required tools actually ran before success) | KERNEL (verifier/grounding fwd :245) | — | **YES** `evaluateGroundedSatisfaction` :1030-1048,1264 | PARTIAL — `getMissingRequiredToolsFromSteps` forces improve (:405,438) but no abstain | KERNEL (Phase2 only; BFS ungated) | NO (verifyPlan is pre-exec structural; SOLVE ungated) | NO | inherits sub |
| Abstention (honest non-success) | KERNEL `meta.abstention` (:343) | — | **YES** `groundedAbstained`→status partial + `rawTerminatedBy:"abstained"` :1044,1239 | — | — | — | — | inherits sub |
| Requirement/artifact coverage (PostConditions) | — | — | NO (tool-name only) | **YES** `deriveConditions`+`verify` PostCondition spine :414-436 | — | NO | — | — |
| Quality gate (format/completeness synth) | KERNEL | — | YES ×2 | YES | NO | NO | NO | — |
| Structural plan validity | n/a | n/a | partial (synthetic-step inject) | n/a | n/a | **YES** `verifyPlan`→degrade-to-reactive | n/a | — |

**Q3 verify — current state of the P3/FM#4 plan-execute fix: IMPLEMENTED and wired.** `evaluateGroundedSatisfaction` (plan-execute.ts:1264-1278) is a pure function: SATISFIED reflection with unexecuted required tools → `redirect` on first occurrence (feeds augment machinery, `groundedRedirects++`, forces `satisfied=false`, :1040-1043), → `abstain` on repeat (`groundedAbstained=true`, honest partial output, `break`, :1044-1048). Terminal result carries `status:"partial"` + `rawTerminatedBy:"abstained"` (:1235,1245) and skips the quality gate (:1204). Comment dates it 2026-07-07 (:190). This closes the gap the F1 react-loop invariant left open for all-analysis plans — but it is NOT shared: reflexion/blueprint have no equivalent.

## Sub-kernel usage

**plan-execute** — composite steps spawn `executeReActKernel` (step-executor.ts:325, maxIter `stepKernelMaxIterations??3`); analysis steps are direct `llm.complete` (no kernel); tool_call steps 0-LLM via `executeToolAndObserve`. Sub-kernel INHERITS (via `StepExecutorInput`): harnessPipeline, budgetLimits, calibration, requiredTools, relevantTools, synthesisConfig, resultCompression, agentId/sessionId, modelId, auditRationale. LOSES: contextProfile, metaTools, briefResolvedSkills, grounding/fabricationGuard/stallPolicy, and **conversation continuity** — each step kernel is fresh (`initialMessages` never threaded; step prompt rebuilt from `priorResults` text). Budget: each sub-kernel has independent maxIterations; no shared token budget across steps (outer `perStrategyRiBudget` tracks only RI interventions, not step tokens).

**tree-of-thought** — branch expansion/scoring are direct `llm.complete`, NOT sub-kernels. Exactly ONE real sub-kernel: Phase2 `runKernel` (:681) or skip-bfs `runKernel` (:223), both via `buildKernelInput(crossCutting,…)` so they inherit the full FM-I cross-cutting bundle. Best BFS path passed as `priorContext` string only (:688) — conversation/tool-state from exploration is lost (exploration made no tool calls anyway). LOSES contextProfile (not in CrossCuttingInput).

**reflexion** — generate + each improve spawn `runPass(reactKernel)` via `buildKernelInput(crossCutting,…)`. UNIQUE: improve passes thread `initialMessages: s.runningMessages` (:483) — the only strategy that carries the running conversation thread across sub-kernels — plus per-pass `blockedTools` (side-effect dedup, :489). Full crossCutting inherited; `verifier` intentionally omitted per-pass (its critique loop IS verification).

**blueprint** — worker composite steps → `executeReActKernel`; analysis → worker's own `llm.complete` (worker.ts:313). `workerCtx` (blueprint.ts:335) forwards only systemPrompt, availableToolSchemas(full), resultCompression, harnessPipeline, agentId/sessionId. **LOSES budgetLimits, calibration, requiredTools, relevantTools, modelId** into composite sub-kernels/analysis — an FM-I gap that plan-execute closed but blueprint's hand-copied worker did not.

## Unique-policy vs plumbing split (per strategy, LOC estimates)

Estimates = file(s) total → genuinely-unique policy after plumbing extraction.

- **reactive** 351 → **~15**. Unique = maxIter `Math.min` reconciliation (:164-168) + terminatedBy mapping. Rest = KernelInput field mapping (~200 LOC interface+assembly) + metadata forwarding, all mechanical.
- **direct** 202 → **~8**. Unique = iteration clamp 1..3 (:110-111). Rest = same KernelInput plumbing.
- **plan-execute** 1301+372+195 = 1868 → **~250**. Unique = wave-schedule/retry orchestration, grounded gate, patch-vs-augment refinement policy, single-analysis short-circuit. Plumbing to remove: RI block (~150, F1), synthesis prompt ×2 (~40, F3), event-payload construction (~200), token estimation.
- **reflexion** 910 → **~230**. Unique = generate→critique→improve cadence, empty-generate backfill, side-effect blocking, PostCondition spine wiring, actionable-fix extraction. The ~320 LOC of prompt-builder helpers are reflexion-specific but boilerplate-shaped.
- **tree-of-thought** 897 → **~200**. Unique = BFS expand/score/prune/select/stagnation/adaptive-prune, tier limits, skip-bfs gate. Plumbing: RI block (~90, F1, dup of plan-execute), score-parsing helpers (~100).
- **blueprint** 584+500+358 = 1442 → **~180**. Unique = verify-then-degrade, concurrency tier branch (`resolveWorkerConcurrency`), DAG worker scheduling, patch-once-retry. Plumbing: worker's step-executor dup (~150, F2), solve synthesis prompt (~30, F3).
- **adaptive** 571 → **~180**. Unique = `heuristicClassify` + `costAwareAdjustment` + LLM classify + partial-fallback. Rest = `{...input}` forwarding.
- **code-action** 290 + submodules → **~120**. Unique = plan→sandbox→verify→retry with verifier feedback; genuinely distinct (Worker sandbox execution). Least reducible.

Rough total: ~6800 LOC of strategy code → ~1180 LOC genuine policy (~17%). The other ~83% is plumbing already partly shared, plus the 3 concentrated dup sites (F1/F2/F3 ≈ 460 LOC removable immediately).

## Better shape: policy hooks for plan-execute

plan-execute, blueprint, and reflexion are the SAME loop — `plan → schedule → execute-step → verify → refine → synthesize` — differing only in policy. A single `runPlanLoop(policy)` parameterized by these hooks would absorb all three:

1. **`plan(goal, tools, tier, memory) → Plan`** — plan-execute: linear/`extractStructuredOutput`; blueprint: `dag`; reflexion: identity (1 analysis step).
2. **`schedule(plan, completedIds) → Wave[]`** — plan-execute/blueprint: `computeWaves` (dependency); reflexion: single step.
3. **`stepPolicy` → StepExecResult** — already shared (`executeStep`); param: `{maxKernelIter, tools-scoping, verifier:off}`. (blueprint must adopt this instead of worker dup.)
4. **`concurrency(plan, calibration) → number`** — plan-execute: 4/1; blueprint: `resolveWorkerConcurrency`; reflexion: 1.
5. **`onStepFailure(plan, idx) → "retry" | Patch | "fail"`** — plan-execute: retry then `patchPlan`; blueprint: `patchPlan` once; reflexion: n/a.
6. **`verifyVerdict(plan, stepResults, groundedState) → "accept" | "redirect" | "abstain" | {refine}`** — plan-execute: `runCritiquePass`+`evaluateGroundedSatisfaction`; blueprint: structural pre-exec (no post-verdict); reflexion: `runCritiquePass`+PostCondition spine+missing-required. **This is the hook that would let blueprint/reflexion opt into grounded-terminal+abstention uniformly.**
7. **`refine(plan, verdict) → Plan`** — plan-execute: patch(failed) or augment(gap); reflexion: improve-pass with critique; blueprint: none (single-pass).
8. **`synthesize(stepResults, budget) → output`** — one shared implementation (currently triplicated, F3): short-circuit rules + `enforceQualityGate`. Param: `{shortCircuitOn: single-analysis|single-substantive, evidenceRule:bool}`.
9. **`outerController(state, history) → {earlyStop}`** — the F1 RI block, shared; currently OWN in plan-execute+ToT, absent elsewhere.

reflexion collapses to `{plan:identity, verify:critique+postcond, refine:improve, synth:gate}`; blueprint to `{plan:dag, schedule:waves, verify:structural, refine:patch-once, synth:solve}`. The residual truly-unique code is hooks 1/6/7 bodies — ~200 LOC across all three vs ~4000 today.

## Signals worth exploiting

- **Comments are honest confessions of dup.** worker.ts literally cites the step-executor line numbers it copies (:189,:237,:272); service-utils.ts documents the "copy-pasted in all 5 strategies" boilerplate it replaced. Grep `mirrors .*\.ts:` and `duplicated` to find the remaining seams fast.
- **`buildKernelInput` + `CrossCuttingInput` (Pick-derived) already enforce "no dropped field = compile error"** for kernel-spawning strategies (reflexion/ToT). plan-execute's `StepExecutorInput` and blueprint's `workerCtx` are hand-typed subsets that bypass this guard — that's exactly where FM-I fields leak (blueprint loses budgetLimits/calibration). Converting those two to `Pick`-derived bundles would statically close the gap.
- **`FM-I (#195)`, `HS-###`, `W# FIX-#`, `P3/FM#4` tags** thread through comments as a change-ledger; the RI-block dup (F1) is tagged `W3 FIX-23` (plan-execute) and `W5 FIX-5` (ToT) — same fix applied twice by hand, the canonical signature of missing shared code.
- **Three strategies degrade/fallback to reactive** (blueprint on invalid/empty, adaptive on partial, ToT skip-bfs) — reactive is the de-facto floor; a shared loop should treat "degrade to reactKernel" as a first-class terminal policy rather than three inline `return yield* executeReactive(input)` calls (blueprint.ts:325,473; adaptive.ts:303).
- **Token accounting divergence (F4)** means cross-strategy cost comparisons (adaptive's `costAwareAdjustment`, ToT's budget guard) compare estimated-/4 tokens against real usage tokens — a latent correctness bug in the cost-downgrade heuristic.