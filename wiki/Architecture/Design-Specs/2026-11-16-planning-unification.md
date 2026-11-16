---
type: design-spec
status: active
created: 2026-11-16
tags: [planning, strategies, plan-execute, blueprint, reflexion, checklist, canonical]
---

# Planning unification: one Plan artifact, pluggable producers and executors

Owner direction 2026-11-16: plan-execute, reflect and blueprint each plan on their own, while plan posture, `todo` and the checklist grew a second planning path. Decide what is one system and what stays separate. Rule: Cortex only renders; every primitive is a framework primitive (see `2026-11-16-plan-execute-posture-robustness.md`).

## Where things stand (verified in code)
1. **Strategy-internal plan** `reasoning/src/types/plan.ts` (`Plan`, `PlanStep` with deps/tool/args, DAG `computeWaves`), persisted via `PlanStoreService` (memory). Produced by one schema-enforced LLM call (`LLMPlanOutputSchema`, `plan-prompts.ts`), consumed by plan-execute (per-step sub-kernels, reflect/refine) and blueprint (verify, 0-LLM DAG worker, one solve call).
2. **Ledger checklist rows** (core `checklist-item` facts). Strategies already project their plan into it (`strategies/planning/plan-checklist.ts`: "the plan IS the checklist", origin `plan`); the kernel's `todo` and the harness-derived plan write the same rows (origin model / `harness-derived`).
3. **Core `Plan`** (`core/types/plan.ts`, portable Markdown/JSON/HTML, findings, events) built from the checklist snapshot for the public API (`agent.plan/execute`, `session.plan`).
4. **Plan posture** (kernel): a reasoning-only turn that produces (2)->(3).

So the display layer is already canonical (2). The split is at the producer and the lifecycle:
- (1) and (3) are two shapes of the same artifact with no mapping. A strategy cannot run a user-edited `Plan`; `agent.plan()` cannot use the schema-enforced DAG planner.
- **Defect class (owner screenshot, 18-row list for a 4-coin task):** `plan-checklist.ts` keeps a replaced step's row forever ("the checklist has no cancelled state yet"). `refine-plan.ts` `patchPlan` splices the tail of `plan.steps` (replacement steps get new ids/titles, the old rows stay open) and `augmentPlan` appends steps with no dedupe against existing titles, so repeated "Verify report", "Recover s7", "Return the final answer" rows accumulate, with stale rows shown as in progress. Same family as the todo near-duplicate bug fixed in `todo-add.ts`. Strategy step `tool` hints are also never written to the rows (no dropdown value).

## Decision: separate concerns
**Unify (one implementation, shared by every strategy and entry point):**
- The **Plan artifact**: core `Plan`/`PlanStep` is the only public/durable shape. Strategy `PlanStep` becomes core `PlanStep` plus optional executor fields (`dependsOn`, `args`) carried as typed extras, not a parallel type; `PlanStoreService` persists the core shape.
- **Lifecycle ops on the artifact**: add, replace (supersede), reorder, edit, tool-set, status. All go through the one checklist op set (`add|remove|status|edit|tool`) so the display, events (`PlanRecorded`, `PlanStepStatusChanged`), editing and portability work for any producer. Replaced/obsolete steps are REMOVED from the checklist (or a `superseded` state if Cortex needs history), never left open.
- **Normalization**: one near-duplicate title helper (token overlap + containment, tool-hint stripped) used by todo add, plan-posture derivation, refine/augment and import. It lives in core.
- **Sizing and guards**: `planBudget`, recon and clarifying questions apply to every plan producer through the shared substrate, not per strategy (AGENTS.md pitfall 12).
- **Events**: strategies publish `PlanRecorded` / `PlanStepStatusChanged` from the same helper, so Cortex needs no per-strategy logic.

**Stay separate (genuinely different):**
- **Producers**: free-form (model `todo`/prose under plan posture, harness-derived fallback) vs schema-enforced DAG planner (blueprint/plan-execute: valid DAG, tools exist, refs resolve). Both emit a core `Plan`; the DAG planner adds `dependsOn/args` and a verify gate.
- **Executors**: ReAct loop with a seeded checklist (reactive, adaptive), per-step sub-kernels (plan-execute), 0-LLM DAG worker (blueprint). Executor choice is a function of plan richness (free steps -> loop; deps+tool+args -> DAG worker) and the strategy setting, not of who planned.
- **Revision policy**: plan-execute's reflect/refine/augment and reflexion's critique loop are policies that CALL the shared lifecycle ops; the policies stay strategy-specific.

## Resulting contract
`Planner(input) -> Plan` and `Executor(plan) -> Result+StepStatuses` are the seams. Today's strategies decompose as: blueprint = DagPlanner + VerifyGate + DagExecutor + Solve; plan-execute = DagPlanner + StepKernelExecutor + RefinePolicy; reactive = PostureOrFreePlanner + LoopExecutor. `agent.plan()` accepts a planner choice (default free-form; `strategy: "blueprint"` uses the DAG planner); `agent.execute(plan)` accepts a plan from any producer and picks the executor.

## Phases (each one concern, ablation where a default changes)
0. **Defect fixes (no new concepts)**: `plan-checklist.ts` removes rows of replaced non-completed steps and passes step `tool` on add; `refine-plan` augment/patch dedupe against existing and replaced titles with the shared helper; tests on the screenshot shape (4 coins, repeated Verify/Return rows). kernel-warden (+ core-warden for the shared helper).
1. **Shared helper + ops**: `isNearDuplicateTitle` in core (reused by tools todo-add and kernel); strategies publish plan events through one helper (`planStatusEvents`). core + kernel + tools.
2. **Artifact unification**: core `PlanStep` gains typed `dependsOn?` and `args?`; strategy `types/plan.ts` becomes a thin extension; `PlanStoreService` stores the core shape (migrate-on-read). kernel + memory.
3. **Seams**: `agent.plan({strategy})` uses the DAG planner and returns a core `Plan`; `agent.execute(plan)` selects an executor by plan richness; a user-edited plan can run in blueprint. runtime + kernel.
4. **Ablation**: plan->execute (free) vs DAG plan->DAG execute on multi-step tool tasks; success, LLM calls, tokens, redundant steps. Accept rule stated first (>=3pp or >=15% fewer calls at no accuracy loss, <=15% token overhead).

## Non-goals
Removing a strategy; changing blueprint's 0-LLM execute; a second plan UI; hard enforcement of plan following.
