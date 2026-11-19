---
"@reactive-agents/reasoning": patch
---

`recall(key, full: true)` now returns the stored content instead of a compressed preview. When the content fits the remaining context window, it comes back in full as plain text. When it does not fit, the result states the total size and how much fits, shows that first section, and names the call that reads the next one (`recall(key, full: true, start: N)`). The result is never re-stored as a new `_tool_result_N` key. A repeated identical recall is replayed with the duplicate note.

The budget answer turn is now on by default (owner decision 2026-11-19, to be measured afterwards). A run can reach the last think call its iteration budget allows with tool evidence gathered and only the answer missing. That call now ships with no tools, so the model writes the answer instead of making a tool call that nobody answers. A guard stop (for example the dispatcher early-stop) that would otherwise end such a run without an answer also gets this one answer turn, even after an earlier denial. In a multi-pass strategy, only the run's own last call is reserved. A pass cap with run budget left is not. Turn it off with `harness: { budgetAnswerTurn: false }` or `RA_BUDGET_ANSWER_TURN=0`. An explicitly enabled `wrapUpReserve` takes the call first on seeded plan runs.
