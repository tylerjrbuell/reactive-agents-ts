---
"@reactive-agents/reasoning": minor
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

Tests: `kernel/run-budget.test.ts` (primitive, wrapper feed, Arbitrator consume,
runner seed, resume max-seed, codec round-trip),
`kernel/run-budget-strategies.test.ts` (reactive / plan-execute-reflect /
reflexion / tree-of-thought / blueprint halt on a crossed limit),
`services/reasoning-service-run-budget.test.ts` (production wiring). Known gap:
`completeStructured` exposes no usage, so structured calls are not yet metered.
