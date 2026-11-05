---
"@reactive-agents/reasoning": patch
---

Bookkeeping tool calls no longer count toward the stall guard. A turn whose only tool calls are meta tools (`todo`, `brief`, `pulse`, `checkpoint`, `recall`, `find`, and similar) now leaves the stall counter unchanged instead of advancing it, so a run that updates its to-do list between real work is no longer ended early as stalled. Turns with no tool call, and turns that call `final-answer` or `task-complete`, still count. The stall guard's trace record now reports how many meta calls it excluded (`metaCallsExcluded`).
