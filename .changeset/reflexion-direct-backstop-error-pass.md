---
"@reactive-agents/reasoning": patch
---

**Direct and reflexion no longer refuse the 4th distinct tool call. Reflexion no longer reports success after its last model call failed, and it no longer lists refused calls as done.**

- **Repetition backstop uses the run's iteration budget.** The cap on distinct-argument calls of one tool was computed from a single kernel pass's iteration cap. Direct runs a 3-iteration pass, and a reflexion pass gets a share of the run budget, so `ceil(3 * 0.75) = 3` refused the 4th, 5th and 6th distinct, informative calls (for example, six `city-population` lookups in one turn). Every strategy pass now carries the run's budget (`maxIterations`), and the backstop uses it. Reactive was not affected. `.withHarness({ repetitionBackstop })` and the review-point floor work as before.
- **A failed final model call no longer ships a rejected draft.** When reflexion's improve pass ended on a provider error after the critique judged the draft UNSATISFIED, the run returned that draft as `partial`, and the runtime counted it as success. The shared strategy terminal now fails such a run with output `""` and the cause on `error`. `terminatedBy` is `llm_error`, which matches the trace. A draft the critique accepted still ships.
- **Reflexion's ALREADY COMPLETED ACTIONS list is accurate.** Each tool call is now matched to its own result by call id, not by position. A call a guard or the tool gate refused is shown as `⛔ ... NOT run`, not `✅`. The list covers every pass so far, not just the last pass that called tools. The critique's execution evidence uses the same pairing, and a refused side-effect call no longer blocks its tool in later passes.
