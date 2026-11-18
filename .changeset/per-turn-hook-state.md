---
"@reactive-agents/reasoning": patch
---

Per-turn hooks now see the state of their moment. `after act`, `before observe` and `after observe` hooks get the round's merged state, including the tool calls and results just made (they used to get the state from before the round, so an `after act` hook could not see the tool it had just run). `after observe` also sees the round's ledger. `before think` and `after think` for the same turn now report the same 0-indexed `iteration` (the after hook used to report the next turn's number).
