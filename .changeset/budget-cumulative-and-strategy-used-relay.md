---
"@reactive-agents/runtime": patch
"@reactive-agents/reasoning": patch
---

Two root-cause fixes surfaced by the StackBlitz playground demos, both
pinned red-before-green.

**Adaptive sub-strategy relay (`runtime`).** `AgentResult.metadata.strategyUsed`
reported `"adaptive"` on every adaptive run instead of the sub-strategy the
router dispatched. `normalizeReasoningResult` (engine/util.ts) rebuilds
strategy metadata from a whitelist and never copied `selectedStrategy`, even
though the same type declares it - the declare-but-drop drift class DEBT-REGISTER
Section 3 tracks for runLedger/verdict/scratchpad. The key now passes through,
so `reasoning-think.ts`'s existing relay chain resolves to the real sub-strategy
and `strategyUsed` (and the engine's AgentCompleted event) report what actually
ran. Tests: `packages/runtime/tests/normalize-reasoning-result-selected-strategy.test.ts`.

**Run-level budget enforcement for plan-execute-reflect (`reasoning`).**
`.withBudget({ tokenLimit })` could be overshot arbitrarily by
plan-execute-reflect: the kernel's Arbitrator pre-intent guard counts spend
SINCE ITS OWN KERNEL START, and plan-execute threaded the same FULL limit
into every step sub-kernel while its outer plan/analysis/reflect/synthesis
LLM calls were never guarded at all (live: 25,675 tokens past a 20,000 cap).
New shared helper `strategies/budget/remaining-budget.ts` gives the strategy
layer run-scoped accounting: each wave's step kernels receive the REMAINING
budget, and once cumulative spend crosses the limit the strategy stops
launching any new work (step waves, reflect, refinement, synthesis, quality
gate), terminating honestly as `status: "partial"` with
`budgetTerminalPartial`/`harnessAuthoredOutput` markers and a
`rawTerminatedBy: budget-limit:tokens:<spent>/<limit>` reason shaped like the
compose killswitch. Overshoot is now bounded to the in-flight wave. The
per-kernel-invocation Arbitrator semantics are unchanged; reflexion and
tree-of-thought share the multi-kernel gap (audit-only, follow-on work) and
can adopt the same pure helper. Tests:
`packages/reasoning/src/strategies/budget/remaining-budget.test.ts`,
`packages/reasoning/src/strategies/plan-execute-cumulative-budget.integration.test.ts`
(deterministic TestLLMService, no network).
