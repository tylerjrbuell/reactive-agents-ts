---
"@reactive-agents/reasoning": minor
"@reactive-agents/llm-provider": minor
---

**Run-scoped budget enforcement (Issue #231 / DEBT D-2026-10-05-P).**
`.withBudget({ tokenLimit, costLimit })` was enforced per kernel invocation,
not per agent run: the Arbitrator's pre-intent guard read `state.tokens`, which
`initialKernelState` resets to 0 at every kernel start. Multi-kernel strategies
that also make direct LLM calls between kernels (plan-execute-reflect, reflexion,
tree-of-thought, blueprint) therefore handed each kernel a fresh pool, and their
direct calls entered no guard at all (live: 25,675 tokens past a 20,000 cap).

The observable LLM wrapper is the one chokepoint on every call path, so it now
feeds a run-scoped `RunBudgetMeter` carried on the ambient `CurrentRunBudget`
FiberRef. `ReasoningService.execute` arms one meter per reasoning execution when
budget limits are declared; the kernel runner stores the live reference on
`state.meta.runBudgetMeter`; the pure+sync Arbitrator reads cumulative run spend
(`Math.max(meter, state.tokens)`) instead of the per-kernel reset value, so all
strategies inherit run-level enforcement by construction. The meter is a plain
mutable object because `arbitrationContextFromState` is synchronous; numeric
`+=` is atomic in single-threaded JS. Crash-resume max-seeds the fresh meter from
the persisted numbers.

Runs without `.withBudget()` are byte-identical (no meter armed, no new
`state.meta` field). New exports: `CurrentRunBudget`, `makeRunBudgetMeter`,
`addRunSpend`, `withRunBudgetMeter`, types `RunBudgetMeter`/`RunBudgetSpend`.

The meter carries the **run-scoped original limits** too (`CurrentRunBudgetLimits`
→ `state.meta.runBudgetLimits`), and the Arbitrator uses them when the meter is
present. Without this, run-total spend would be compared against the *reduced*
per-kernel limit plan-execute hands its step sub-kernels (`withSpentBudget`),
halting a run early by up to the prior spend (e.g. run total 65 vs true limit
100 halted because the reduced limit was 60).

**Structured calls are metered too (`llm-provider`).** `runStructuredParseWithRetry`
now surfaces the provider's real (retry-summed) usage on the exported
`StructuredUsageRef` FiberRef; the observable wrapper reads it after
`completeStructured` and feeds the meter. `completeStructured`'s public return
type is unchanged (`A`). This closes the plan-generation/extraction accounting gap.

Tests: `kernel/run-budget.test.ts` (primitive, wrapper feed incl. structured,
Arbitrator consume, runner seed, resume max-seed, codec round-trip),
`kernel/run-budget-strategies.test.ts` (reactive / plan-execute-reflect /
reflexion / tree-of-thought / blueprint halt on a crossed limit),
`services/reasoning-service-run-budget.test.ts` (production wiring),
`llm-provider/tests/structured-usage-ref.test.ts` (usage surfaced). Remaining
gap: the meter is per-`execute`, not per-whole-run (auxiliary passes).

**Strategy gates unified on the meter (#234).** Direct LLM calls between kernels
never enter the Arbitrator, so the per-strategy gates remain the direct-call
enforcement complement (full removal is premise-falsified). Their duplicated
accounting is gone: `strategies/budget/run-budget-spend.ts` `resolveRunSpend()`
reads the run meter and maxes it over the strategy's local figure, so
plan-execute's quality-gate/wave/reflect gates and blueprint's SOLVE gate agree
with the Arbitrator on the boundary.
