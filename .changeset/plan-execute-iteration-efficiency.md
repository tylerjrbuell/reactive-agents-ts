---
"@reactive-agents/reasoning": patch
---

Executing a seeded plan no longer spends the iteration budget on todo bookkeeping. A step whose tool hint names a tool that just succeeded (and that no other unchecked step names) is marked done by the harness, so the model does not spend a turn on it. A round that only called `todo` does not count against `maxIterations` (at most half the budget is refunded, and each refund is recorded as a `bookkeeping_refund` guard event and an intervention step). The follow-the-plan guidance now also says to issue independent tool calls together, update `todo` alongside real work, and never re-add steps already on the list. Plan-turn checklists are derived from one list in the reply (the one whose steps name tools) instead of a union of restated lists. New opt-in `RA_WRAPUP_RESERVE=1`: on a seeded plan run the last think call ships without tools and asks for an answer from the evidence gathered, naming what is unfinished.
