# Reasoning Strategy Portfolio + Cross-Cutting Enhancements — Scoping Spec

**Date:** 2026-06-28
**Status:** SCOPING (no code yet)
**Origin:** efficiency investigation ([[project_harness_sweep_2026_06_26]]) → pivot to reasoning quality/efficiency.

## Goal

A **portfolio of tier-portable reasoning strategies that each shine in a distinct domain** (not dead weight), plus cross-cutting enhancement of the four substrates every strategy rides — **context engineering, tool design, memory, verification**. Every strategy must work well across **all model tiers** (local → frontier), adapting its own cost/structure to the tier.

## Principle 1 — Strategies are domain tools, not a hierarchy

Each strategy is a *tool with tradeoffs*, selected (by `adaptive` or the user) for the task's shape. The bar for keeping/adding one: **it must win on SOME (task × tier) cell vs every other strategy** — otherwise it's dead weight. Current routing (`adaptive.ts:heuristicClassify`): trivial/short→reactive, plan/pipeline→plan-execute, compare/explore→ToT, critique/refine→reflexion.

### Current portfolio matrix (domain · tradeoff · evidence)

| Strategy | Shines on | Tradeoff | Tier note |
|---|---|---|---|
| **reactive (ReAct)** | most tasks; tool use; Q&A | per-step LLM call (N calls) | the workhorse all tiers |
| **plan-execute-reflect** | multi-phase / pipeline | **heaviest — 9+ calls (rw-8=43k tok), no quality lift vs react (spike verdicts)** | expensive on local |
| **tree-of-thought** | explore / compare / brainstorm | wide fan-out cost | weak local models thrash |
| **reflexion** | critique / iterative refine | extra critique passes | needs a capable critic |
| **code-action** | code-gen / exec tasks | sandbox dep | — |
| **direct** | trivial single-shot | no tools/loop | — |
| **adaptive** | auto-route | classification cost | meta |

**Gap surfaced by data:** the decomposable / tool-heavy domain is served only by **plan-execute-reflect**, which is the cost monster (58% of all ra tokens in the sweep) for **no quality gain**. That domain needs a *cheaper* option — ReWOO.

## Principle 2 — Tier portability (every strategy, every tier)

A strategy must degrade/scale gracefully by `ContextProfile.tier` (local/standard/large/frontier — already exists). Design contract for any strategy:
- **local** (small ctx, weak instruction-following): fewest LLM calls, smallest visible tool set, terse prompts, aggressive scratchpad offload, low fan-out.
- **frontier**: may use wider fan-out / more reflection where it actually lifts.
- The strategy reads `profile.tier` + `calibration` and adjusts its OWN knobs (fan-out width, reflection passes, plan depth). New strategies MUST declare their per-tier behavior, not assume frontier.

## The concrete build: ReWOO (Reasoning WithOut Observation)

**Why:** the one modern strategy that targets *fewer LLM calls* — directly fixes the plan-execute cost. Decouples planning from observation.

**Call pattern (vs plan-execute's ~9 calls):**
1. **Planner (1 LLM call):** produce the full plan as a tool-call DAG up front — steps with `#E1, #E2…` variable bindings, where later steps reference earlier evidence (`#E1`). No execution yet.
2. **Worker (0 LLM calls):** execute the tool calls in dependency order, substituting `#En` evidence. Pure orchestration — **no LLM in the loop.** Independent steps run in parallel (LLMCompiler-style).
3. **Solver (1 LLM call):** synthesize the final answer from the task + collected evidence.

Total ≈ **2 LLM calls + N tool execs** vs plan-execute's plan + per-step-kernel×N + reflect + synthesis.

**Shines on:** decomposable tasks with a knowable tool plan (multi-fetch, multi-file generation, data pipelines — rw-8/rw-9 class). **Tradeoff:** weaker on tasks needing mid-course replanning from observations (ReAct/plan-execute win there — ReWOO commits to a plan up front). That's a *legitimate domain split*, not dead weight.

**Tier adaptation:**
- local: cap plan to K steps, terse planner prompt, sequential worker (parallel may overwhelm), one-shot solver.
- frontier: deeper plans, parallel worker, optional one replan if a step hard-fails.

**Routing:** `adaptive` routes plan/pipeline/multi-tool-decomposable → **ReWOO** when the plan is static (no "depends on what we find" language); keeps **plan-execute-reflect** for adaptive/observation-driven decomposition. ReWOO becomes the *cheap* planner, plan-execute the *adaptive* planner.

**Verification:** ReWOO output rides the same terminal verifier (fabrication guard, scaffold-leak, etc.) + StallPolicy applies to the worker's required-tool satisfaction.

**Proof gate (before commit):** head-to-head vs plan-execute-reflect on rw-8 (the 43k monster) + rw-9 (parallel fetch) across tiers — measure **tokens, LLM-call count, accuracy**. Adopt as default for the static-decomposable domain only if ≈ equal accuracy at materially fewer calls (expect ~9→~3).

## Cross-cutting enhancements (lift ALL strategies — higher leverage than any single strategy)

Ranked; each is a separate scoped effort. These raise the floor for every strategy + every tier.

1. **Context engineering** (`context/context-manager.ts`, `context-profile.ts`): the biggest force-multiplier. Tighter tier-aware observation compaction + scratchpad-offload (keep the running thread small — we saw history bloat); recency placement; per-tier prompt budgets. Lifts cost AND small-model accuracy.
2. **Tool design** (`kernel/capabilities/act/tool-capabilities.ts`): lazy disclosure stability (don't churn the visible set), parallel tool execution (LLMCompiler primitive — reused by ReWOO), better tool-result shaping for small models. (Note: classifier fires every task — gate for obvious cases.)
3. **Verification** (`verify/verifier.ts`): the moat. Already shipped fabrication guard + StallPolicy. Next: per-tier verifier strictness, cheap deterministic checks before any LLM critique.
4. **Memory** (`packages/memory`): default-off today; experience-reuse (recall prior solutions for similar tasks) is the long-horizon lever — but only where it earns its tokens (tier-gated).

## Recommended sequence

1. **ReWOO** (this spec) — concrete, efficiency-aligned, fills the cheap-decomposable gap. Prototype → bench → adopt-for-domain.
2. **Parallel tool execution** primitive — unblocks ReWOO's worker + speeds reactive multi-tool.
3. **Context-engineering pass** — tier-aware compaction (raises every strategy's floor).
4. Then memory experience-reuse + verifier tiering.

**Anti-goals (per data):** do NOT add LATS / Graph-of-Thoughts / self-consistency — more cost, no lift on our evals. Variety must mean *distinct domain wins*, not more scaffolds.

---

## Warden Brainstorm Synthesis (2026-06-28 — kernel/tools/memory/provider)

**ReWOO feasibility: GREEN, ~80% infra exists.** ReWOO = plan-execute-reflect MINUS reflect/refine + capability-gated plan structure.
- Worker primitive (loop-less, 0 LLM): `executeToolAndObserve` (`kernel/capabilities/act/tool-observe.ts:159`) — already used standalone by `strategies/plan-execute/step-executor.ts:126-228`.
- #E1/#E2 DAG: `resolveStepReferences`/`extractDependencies`/`computeWaves` (`types/plan.ts:151/183/205`); `{{from_step:sN}}` semantics; parallel via `Effect.all(..,{concurrency:4})` (`plan-execute.ts:670`).
- Parallel tool exec: `ToolService.execute` (`tools/src/tool-service.ts:319`) is concurrency-safe, NO shared state/rate-limit — **no new tools-layer primitive**; the Worker does `Effect.all(calls.map(execute),{concurrency})`. MUST reuse `isParallelBatchSafeTool` (`decide/tool-gating.ts:106`) — writes/deletes sequential-only.
- Registration: 1 line in `services/strategy-registry.ts:150-164` (`StrategyFn` already carries tier/calibration/requiredTools/budget). NB: strategy + registry are OUTSIDE kernel-warden authority.

**Tier-portability design (the hard requirement) — drive off calibration+capability:**
- `ModelCalibration.parallelCallCapability` ("reliable"|"partial"|"sequential-only", `calibration.ts:51`) = THE signal: reliable→parallel DAG; partial→cap fan-out 2; sequential-only→linearize.
- `capability.toolCallDialect !== "native-fc"` OR `source==="fallback"` → degrade to **text-parsed sequential plan** (else a one-shot tool-DAG silently never executes on weak/unknown models). Cloud tiers have no calibration JSON → default frontier/large/mid = reliable.
- `steeringCompliance` (`calibration.ts:48`) → which channel (system vs user) to inject the plan schema for weak models.
- Local Ollama: parallel calls only arrive on `chunk.done` (can't start workers mid-stream) — known constraint.
- **Recommend a fused accessor** `parallelPlanCapability(modelId, tier, provider)` (capability for cloud + calibration for local) so ReWOO picks parallel-vs-linear once. (provider-layer, additive.)

**ReWOO must-handle risks (wardens):**
1. StallPolicy + required-tools gate are LOOP-INTERNAL (`iterate-pass.ts`, `runner-helpers/stall-deliverable.ts`) → a direct Worker BYPASSES them. ReWOO must (a) validate required-tools/quota AT PLAN TIME — reuse synthetic-step injection `plan-execute.ts:299-380`; (b) self-enforce `input.budgetLimits` at the wave loop.
2. Failed `#E` dep silently → empty args (`plan.ts:163` + `step-executor.ts:142-146`) — correctness landmine; add **fail-on-unresolved-ref**.
3. **Healing pipeline NOT in the direct-dispatch path** — Worker must run `runHealingPipeline` (`tools/src/healing/healing-pipeline.ts:18`) per call or weak-model arg errors (tool/param misname, type, path) hard-fail. tools-warden: highest-value tier-portability wire-up. Also reuse `normalizeToolCallArguments` (`act.ts:86`).
4. Do NOT add a per-step terminal verifier (`react-kernel.ts:184` omits deliberately; M3-REWORK invariant `verifier.ts:217`). Solver-output `defaultVerifier.verify()` (sync/pure) + `enforceQualityGate` (`finalize.ts`) are SAFE.
5. No mid-plan recovery → optional bounded **re-plan-once** on wave failure (`plan-execute.ts:730-758` patchPlan).

**Cross-cutting wins surfaced (lift ALL strategies; some are bugs):**
- **[MEMORY P0 — severed load-bearing loop, CORRECTNESS]** `ExperienceSummary→toolGuidance` hardcoded `experienceSummary: undefined` at `context/prompt-sections-default.ts:161` (adapter `adapter.ts:181` is built to consume it, gets null → emits nothing). AND `experienceTips` written (`skill-postprocess.ts:133`) but never injected. Rewire = cheapest highest-leverage memory fix: ≤3 lines, active-tool-filtered, LOCAL-tier-only, iter-0-only (`formatToolGuidanceFromSummary`, `calibration.ts:280`). Fix lives in reasoning/runtime (outside memory-warden authority). Needs RED test (M10 recall harness) before widening.
- **[KERNEL] Skip terminal synthesis when the last step IS the deliverable** — duplicate-generation tax (`plan-execute.ts:392-503,1044`); lifts plan-execute AND ReWOO.
- **[KERNEL] Tier-aware compression on ALL strategies** — plan-execute hardcodes `modelTier:"mid"` (`plan-execute.ts:208`) + `{budget:2000,previewItems:8}` (`step-executor.ts:193`), ignoring tier. `CONTEXT_PROFILES[tier]` exists (`context-profile.ts:64`).
- **[MEMORY] Episodic injection has NO tier budget** (15×600 same local+frontier, `reasoning-think.ts:88`) — token-bloat risk on small local context. Any new recall MUST add a tier cap.
- **[TOOLS] Result compression + scratchpad offload already exist** (`compressToolResult`, `tool-execution.ts:704`) — Worker must route results through it, pass only compressed previews to the Solver.

## RESEARCH-SHARPENED DESIGN — "blueprint" strategy (2026-06-28)

Named **blueprint** (was "ReWOO"). Research validates the pattern AND surfaces the tier-portability fix.

**Research basis (web, 2026-06-28):**
- ["Beyond ReAct" Planner-Centric DAG framework](https://arxiv.org/html/2511.10037v1) (Nov 2025): single-pass DAG plan-execute **beats GPT-4 ReAct 59.8% vs 48.2% on StableToolBench at 2.29 avg steps** — DAG plan-execute is efficiency AND accuracy on tool tasks. blueprint = the inference-only version (they fine-tune via SFT+GRPO; we can't — BYOK/local — so we take the design, not the training).
- blueprint is the canonical 4th single-agent pattern (ReAct / Plan-Execute / **ReWOO** / Reflexion) — we have the other 3.
- **Hard caveat for our #1 requirement (all tiers):** "SLMs are unreliable as standalone multi-step planners" ([SLM-future](https://arxiv.org/pdf/2506.02153), [PACT](https://arxiv.org/html/2606.16995)). One-shot DAG + no mid-course observation = garbage-in-garbage-out on weak models. The literature's fix (PACT): plan → **VERIFY** → execute. Prompt structure alone lifts small models materially (numbered steps: qwen3.5 81→88%).

**Design: blueprint = PLAN → VERIFY → EXECUTE (0-LLM, parallel) → SOLVE.**

### Small-model planning leverage stack (the differentiator — our thesis: engineer max reasoning out of small models)
blueprint's PLAN step is NOT a naive `llm.complete("make a plan")`. It pours the framework's existing leverage systems into planning so small/local models produce a RELIABLE DAG:
1. **Schema/grammar-enforced generation** — plan via `extractStructuredOutput(LLMPlanOutputSchema)` (structured-output/pipeline.ts). On local, `jsonSchemaEnforcement`/grammar (local.ts:963) FORCES a valid DAG shape — a weak model can't freeform a graph but CAN fill a constrained schema. This is the single biggest small-model planning lever.
2. **Calibration-driven prompt + channel** — `steeringCompliance` (system vs user) places the plan schema where the specific model obeys it; `systemPromptAttention:weak` → re-state the schema; numbered-step structure (research-proven small-model lift).
3. **Experience-reuse injection** — inject prior successful plans/tips (the just-wired `appendExperienceTips` + PlanStore recall) so the planner bootstraps from what worked before on similar tasks — tier-capped (tight on local).
4. **Plan VERIFICATION gate** (the PACT fix, mostly deterministic = cheap, tier-scaled):
   - deterministic: valid DAG (no cycles via computeWaves), every required tool present (reuse plan-execute.ts:299-380 synthetic injection), all referenced tools exist, no unresolved `#E`/self-refs, args schema-shaped.
   - heal the plan (runHealingPipeline on tool names/params).
   - local-tier optional: ONE bounded critique-refine pass (cheap; only when deterministic checks flag gaps) — NOT a reflexion loop.
   - On unfixable invalid plan → degrade to **reactive** (don't execute a broken observation-free plan).
5. **Capability/calibration tier branch** — `parallelCallCapability` + `toolCallDialect`: capable → parallel DAG worker; weak/`partial` → cap fan-out / linearize; `dialect!=="native-fc"||source==="fallback"` → text-parsed sequential plan.
6. **Healing in the Worker** — runHealingPipeline per tool call (weak-model arg errors the direct-dispatch path otherwise hard-fails).

### Tier matrix (planner)
- **local:** schema-grammar-FORCED plan + experience-tips + numbered-step prompt on the calibrated channel + deterministic verify + optional 1 critique-refine + linearized/sequential worker. Degrade→reactive if plan invalid.
- **mid/large:** schema plan + deterministic verify + parallel worker.
- **frontier:** richer DAG, light verify, parallel worker, optional re-plan-once on wave failure.

Anti-goal reaffirmed: no fine-tuning-dependent variants (PACT/PilotRL/GRPO) — design only. (Chain-of-Draft terser reasoning = orthogonal cross-cutting lever, parked — our tax is input-dominated.)

## Build sequence (research-sharpened)

✅ DONE: Memory P0 (experienceTips wired) + tier-aware plan prompt (merged local main 2026-06-28).

1. **Parallel-tool Worker helper** — reasoning-side `Effect.all` over `executeToolAndObserve` + `isParallelBatchSafeTool` (writes sequential) + `runHealingPipeline` per call + fail-on-unresolved-`#E`. Tier-scaled concurrency. Reused by blueprint AND reactive batch.
2. **Plan-verification helper** — pure deterministic checks (valid DAG / required-tools present / tools exist / no unresolved refs) + heal; returns ok|repaired|invalid. Reusable.
3. **`blueprint.ts`** — PLAN (schema/grammar-enforced via extractStructuredOutput + calibration channel + experience-tips + numbered-step prompt) → VERIFY (helper #2; degrade→reactive if invalid) → EXECUTE (helper #1) → SOLVE. Capability/calibration tier branch (parallel-DAG vs linear/text-parse). Self-budget. Register as `"blueprint"` (+ alias `"rewoo"`?).
4. **Proof gate** — blueprint vs plan-execute on rw-8/rw-9 across local+frontier: tokens / LLM-call count / accuracy. Adopt for static-decomposable domain only if ≈equal accuracy at materially fewer calls (~9→~3) AND local-tier accuracy holds (the plan-verify gate is what makes this pass).
5. Cross-cutting (later): skip-synthesis-when-last-step-is-deliverable; scratchpad-offload; episodic tier-budget.
