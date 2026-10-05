---
type: implementation-plan
status: active
created: 2026-10-05
tags: [budget, kernel, arbitrator, run-envelope, architecture-debt]
---

# Bundle: `run-level-budget-meter` (#231)

Date: 2026-10-05
Budget: 240 min (oversized P1; see descope note)
Issues: #231 (partial — canonical mechanism; cleanup split to follow-ups)

## Problem (verified)

`.withBudget({ tokenLimit, costLimit })` is enforced **per kernel invocation**, not
**per agent run**. The Arbitrator pre-intent guard (`kernel/capabilities/decide/arbitrator.ts`
`computeBudgetSignal` via `arbitrationContextFromState`) reads `state.tokens`, which
`initialKernelState` resets to 0 per kernel. Multi-kernel strategies that also make
direct LLM calls between kernels (plan-execute, reflexion, tree-of-thought, blueprint)
each get a fresh pool; direct calls enter no Arbitrator. Live evidence: stackblitz 03
demo, `plan-execute-reflect` with `tokenLimit: 20000` ran to 25,675 tokens.

Interim strategy-layer fix shipped (`aac481dc`) for plan-execute only. #231 is the
canonical fix: run-scoped accounting at a shared choke point, consumed by the Arbitrator
as sole termination authority, so all 8 strategies inherit it by construction.

## Canonical design (Option A)

**One run-scoped mutable meter, fed by the observable LLM wrapper, read by the Arbitrator.**

The observable wrapper (`kernel/observable-llm.ts`) already sits on EVERY LLM call path
(kernel think + direct plan-execute/reflexion/ToT calls). It is the choke point.

1. **New `kernel/run-budget.ts`** (reasoning-local, no core/runtime change):
   - `interface RunBudgetSpend { tokens: number; cost: number }`
   - `type RunBudgetMeter = { tokens: number; cost: number }` — a plain **mutable**
     object (not a `Ref`). Synchronous `+=` on a number is atomic in single-threaded
     JS; `arbitrationContextFromState` is a **pure sync function** and must read the
     live value without an Effect, which a `Ref` cannot provide. This is the reason for
     the mutable-object choice.
   - `const CurrentRunBudget = FiberRef.unsafeMake<RunBudgetMeter | null>(null)` —
     reasoning-local ambient carrier (same pattern as `CurrentRunContext`).
   - `makeRunBudgetMeter()`, `addRunSpend(spend)` (FiberRef.get + mutate; no-op when
     absent), `readRunSpend()`, `withRunBudgetMeter(effect, meter)`.

2. **Feed it** — `kernel/observable-llm.ts`: after every `complete` /
   `completeStructured` response, and at stream finalization, call `addRunSpend` with
   `tokens = usage.totalTokens ?? (inputTokens + outputTokens)`, `cost =
   usage.estimatedCost ?? 0`. For `stream`, capture the ambient meter at open time
   (same pattern as `ambientTaskId`) and mutate in `Stream.ensuring` (fiber-hop safe).

3. **Set it per run** — `services/reasoning-service.ts` (parent scope): create one
   meter per `execute` call, and set it alongside the existing
   `Effect.locally(CurrentRunContext, …)`:
   `Effect.locally(CurrentRunBudget, meter)`. Strategies never see or forward it, so
   they cannot drop it.

4. **Reach the Arbitrator** — `kernel/state/kernel-state.ts` adds optional
   `runBudgetMeter?: RunBudgetMeter` to `KernelMeta` (+ `KernelInput` if needed).
   `kernel/loop/runner.ts` reads the ambient meter at kernel start and stores the
   **reference** on `state.meta.runBudgetMeter`. On resume, if the deserialized
   `state.meta.runBudgetMeter` is ahead of the fresh ambient meter, max the ambient
   meter up from it before assigning.

5. **Consume it** — `arbitrator.ts` `arbitrationContextFromState`: when
   `state.meta.runBudgetMeter` is present, feed `computeBudgetSignal` the **run**
   spend (`meter.tokens` / `meter.cost`) instead of kernel-local `state.tokens` /
   `state.cost`. Absent meter → fall back to kernel-local (byte-identical to today).
   Keep `state.tokens`/`state.cost` untouched for kernel-local honest-partial
   semantics.

6. **Compose parity** — `packages/compose/src/killswitches/budget-limit.ts`: read the
   run meter when present. **Deferred to a follow-up issue** (cross-package descope
   gate; see below).

7. **Retire per-strategy gates** — delete the plan-execute interim wave-gate and
   blueprint's bespoke `overBudget`. **Deferred to a follow-up issue** (removal risks
   their existing honest-partial tests; leaving them is safe and additive).

## Acceptance criteria (this bundle)

- [ ] New `kernel/run-budget.ts` with the meter + FiberRef; JSDoc states the
      accounting boundary and why a mutable object (not `Ref`).
- [ ] Observable wrapper feeds the meter on `complete` / `completeStructured` /
      `stream`; 0 overhead when no meter is ambient.
- [ ] `reasoning-service.ts` creates + sets the meter per run.
- [ ] Runner seeds the reference onto `state.meta.runBudgetMeter`; resume max-seed.
- [ ] Arbitrator uses run spend when the meter is present; kernel-local fallback when
      absent.
- [ ] Deterministic (TestLLMService, no network) tests proving a crossed
      `tokenLimit` halts at the boundary with a budget termination reason for at
      minimum: `reactive` (single kernel), `plan-execute-reflect` (multi-kernel +
      direct), `reflexion` (multi-kernel + direct), `tree-of-thought` (multi-kernel +
      direct), `blueprint`; controls (no limits / generous limits) complete unchanged.
- [ ] Overshoot bounded to at most the in-flight LLM call.
- [ ] Codec round-trip test: `meta.runBudgetMeter` survives serialize/deserialize.
- [ ] `bun test packages/reasoning` green; `bunx turbo run typecheck
      --filter=@reactive-agents/reasoning` green; new test files contribute **0**
      `as unknown as` sites.
- [ ] Changeset added.

## Execution units

1. **Unit 1 (kernel-warden):** `run-budget.ts` + observable wrapper feed +
   kernel-state field + runner seeding + arbitrator consumption + codec/resume.
   TDD: unit tests for the meter + wrapper feed.
2. **Unit 2 (kernel-warden):** strategy integration tests (reactive,
   plan-execute-reflect, reflexion, tree-of-thought, blueprint) using a
   `makeObservableLLM()`-wrapped TestLLMService so the meter is actually fed.
3. **Unit 3 (parent):** `reasoning-service.ts` wiring; run full reasoning suite +
   typecheck + cast-ceiling check; changeset.
4. **Unit 4 (parent):** verify, update DEBT register row `D-2026-10-05-P`, file
   follow-up issues (compose parity, gate retirement), PR/merge to `dev`.

## Risk register

- **`arbitrationContextFromState` is pure** → mutable-object meter chosen over `Ref`.
- **Stream fiber hop** → capture meter at open (mirrors `ambientTaskId`).
- **Double counting** → meter is the total run spend (includes kernel calls); the
  Arbitrator must NOT add `state.tokens` on top. Kernel-local numbers stay only for
  honest-partial metadata.
- **Resume reset** → runner max-seeds the ambient meter from persisted
  `state.meta.runBudgetMeter`.
- **PATH_TOKEN O(n^3) backtracking** on huge prior-step blobs (pre-existing) → tests
  must avoid multi-thousand-char dot-free blobs in step tasks.
- **Cross-package descope:** compose parity deferred; bundle stays
  `packages/reasoning` (+ wiki/changeset).

## Out of scope (explicit, file as follow-ups)

- Compose `budgetLimit()` killswitch parity (cross-package).
- Deleting plan-execute interim gate + blueprint bespoke gate.
- Cross-RUN (daily/monthly) budget persistence — cost-service territory.
- Display/`E3 pace band` reading true run spend.

## Baseline

- reasoning: 2907 pass / 4 todo / 0 fail
- runtime: 1644 pass / 3 skip / 2 fail (pre-existing #214 cast-ceiling)
- workspace typecheck: 68/68; build: 38/38
- cast ceilings: src 80 vs 78, tests 266 vs 237 (pre-existing #214)

## Result (2026-10-05)

- reasoning: **2927 pass / 4 todo / 0 fail** (+20 tests); typecheck green; build 38/38
- runtime: 1644 pass / 3 skip / 2 fail (unchanged pre-existing #214)
- workspace typecheck: 68/68
- cast ceilings unchanged (src 80, tests 266) — new files contribute 0 `as unknown as`
- production wiring proven by `services/reasoning-service-run-budget.test.ts`

**Deviation:** meter carried on the ambient `CurrentRunBudget` FiberRef set by
`ReasoningService.execute`, not `RunEnvelope` (same drop-proof guarantee; the
pure+sync Arbitrator needs a mutable object, not a `Ref`). Auxiliary `execute`
passes (verification retry, continuation) get their own meter — per-execution,
not per-whole-run.

**Follow-ups filed:** completeStructured metering, compose parity, retire
per-strategy gates.
