---
tags: [harness-improvement-loop, fix, empirical, evidence]
date: 2026-05-25
model: qwen3.5:latest
probe: failure-corpus.ts (8 scenarios)
status: shipped — branch fix/ri-empty-run-invariant
---

# Harness Improvement Loop — 2026-05-25

## Probe baseline (qwen3.5:latest)

8-scenario failure-corpus run (4 labeled "success", 4 labeled "failure"):

| Scenario | Label | Before | After |
|---|---|---|---|
| success-days-of-week | success | ✅ | ✅ |
| success-capital-france | success | ✅ | ✅ |
| success-rgb-colors | success | ✅ | ✅ |
| **success-typescript-paradigm** | success | ❌ | ✅ **FIXED** |
| failure-rate-limit-loop | failure | failure | failure |
| failure-save-loop | failure | failure | failure |
| failure-verify-loop | failure | failure | failure |
| failure-contradictory-data | failure | failure | failure |

Success-corpus completion: 3/4 → **4/4**. Failure-corpus detection: 4/4 → 4/4 (no regression).

## Root cause — FM-A3 Spurious Tool Engagement + RI empty-run termination

Trace `01KSGRBEJQ8APBNQ5HQ0BVN4Z9` (before fix):

- Task: `success-typescript-paradigm` — pure knowledge recall, `tools: []`, maxIterations=4.
- Agent invoked auto-injected `find` tool 2× (looking up "TypeScript programming paradigm features") despite `tools: []` in the scenario config.
- RI dispatched `early-stop` at iter 2 (50% of budget) with reason `Approaching maxIterations (iter=2, max=4)`.
- Kernel terminated `status=done` via `dispatcher_early_stop` with `outputLen=0`.
- Runtime wrapped empty output as `status="failure", error="Reasoning failed"`.

Two coupled bugs:

1. **`find` is in `FRAMEWORK_TOOL_NAMES`** (`tools-registry.ts:30`) — auto-injected regardless of scenario `tools: []`. Agent reached for it on a knowledge task that didn't need any tool. **(Root cause — deferred to follow-up; this commit is the backstop only.)**
2. **`evaluateEarlyStop` overflow guard** (`early-stop.ts:34`) fires at `iter >= maxIter - iterationsBeforeMax` (default 2). For `maxIter=4` this triggers at iter 2 — **50% utilization, not "approaching"**. Fires regardless of whether agent has produced any output.

## Structural fix — `hasUserOutput` invariant

Empty-run invariant added to `evaluateEarlyStop`: RI's `early-stop` MUST NOT fire when `hasUserOutput === false && iteration < maxIterations - 1`. Applies to **both** the convergence branch and the overflow guard. Last-iteration early-stop still allowed (agent out of budget regardless).

Edits:
1. `packages/reactive-intelligence/src/types.ts` — `ControllerEvalParams.hasUserOutput?: boolean`. Permissive default (omitted → suppression doesn't apply) preserves outer-loop callers in plan-execute / ToT that manage their own output bookkeeping.
2. `packages/reactive-intelligence/src/controller/early-stop.ts` — derived `suppressForEmptyOutput`, applied to both early-return branches.
3. `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts` — caller passes `hasUserOutput: typeof s.output === "string" && s.output.trim().length > 0`.

## Verification — same model, same probe

Trace diff `01KSGRBEJQ8APBNQ5HQ0BVN4Z9` → `01KSGS4YG317D4KJNJER83FYXS`:

```
final state
  A: status=done outputLen=0   terminatedBy=controller_early_stop:dispatcher_early_stop
  B: status=done outputLen=593 terminatedBy=controller_early_stop:dispatcher_early_stop

verifier verdicts: 0 → 1/1 passed
interventions suppressed: 1 → 2  (extra suppression = new invariant firing)
iterations: 3 → 8
tool calls: 2 → 1  (find called once instead of twice)
```

Content sample (after fix, first 150 chars of output):

> TypeScript primarily supports **Object-Oriented Programming (OOP)**, though it is technically a multi-paradigm language that also supports functional programming. Two features that reflect this OOP focus: 1. **Classes and Inheritance**…

Legitimate technical answer. Verifier `output-not-harness-parrot` + `synthesis-grounded` checks passed.

## Tests

- New: 5 cases in `early-stop.test.ts` covering both branches of the invariant (overflow + convergence, with-output + without-output, at-last-iter vs not, permissive default for omitted flag).
- RI package: 476 → **481** pass / 0 fail.
- Reasoning package: 1373 / 0 fail (no regression).
- Workspace: 5645 → **5655** pass / 0 fail / 23 skip.
- Build: 38/38 green.

## Architectural framing — Affordance Leakage

Today's fix is a **backstop**. The root cause is broader and codified as a new design principle:

> **Affordance Leakage** — framework injects tools, RI decisions, strategy variants, and Compose tags by default. Agent must actively suppress what shouldn't be in scope rather than opt into what should.

Convergent evidence (all symptoms share this root):

| Symptom | Affordance leaked |
|---|---|
| FM-A3 (today) | `find` auto-injected on `tools: []` task → agent calls it → empty output |
| RI early-stop at 50% budget | Decision fires without checking if output exists |
| ToT 3-23× cost on trivial tasks | Strategy routes by task-shape, not cost-vs-benefit |
| 8/13 RI decisions dead in failure corpus | Declared variants never fire — surface > usage |
| 4/7 Compose tags dead | Same shape — emit site never written |
| M2a/b/c pre-Phase-0 | Framework markup leaked because producer had no audience-scope tag |

North Star §9 "Anti-Scaffold" caught the *declared-without-callers* half. Flip side is unfixed: *callers-without-scope-gates*. Both ship noise.

Proposed structural directions (filed as follow-up issues):

1. `ToolDefinition.relevancePredicate?: (task: TaskComprehension) => Confidence` — `find` returns LOW on knowledge tasks → not in registry presented to LLM
2. `ControllerDecision.relevancePredicate` — formalizes today's empty-run invariant for all 13 decision variants
3. `StrategyAdapter.costEstimate(task)` → adaptive router compares before picking ToT for trivial math
4. `Compose.Tag.requireEmitSite: true` lint rule

## Out-of-scope (filed follow-ups)

- **`find` auto-injection root cause** — `tools: []` should yield no `find` tool. Backstop in this commit; root fix is separate (`FRAMEWORK_TOOL_NAMES` audit + tool-relevance gating).
- **`failure-verify-loop` overran maxIter (13 actual vs 12 declared)** — off-by-one or "force-last-synthesis" path; file as separate issue.
- **Convergence-threshold tuning for cogito:14b / qwen3.5:latest** — `convergenceThreshold=0.3` default is calibrated against historical models; today's qwen3.5 hits 0.15 on trivial tasks and could trigger convergence-branch early-stop at any iter ≥2. Currently masked by `hasUserOutput=false` suppression, but worth tier-specific recalibration.

## Files touched

- `packages/reactive-intelligence/src/controller/early-stop.ts`
- `packages/reactive-intelligence/src/types.ts`
- `packages/reactive-intelligence/tests/controller/early-stop.test.ts`
- `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts`
- `wiki/Research/Harness-Reports/improvement-2026-05-25.md` (this file)
