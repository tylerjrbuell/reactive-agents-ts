---
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/compose": patch
---

Remove nine `AgentEvent` tags that were exported on the EventBus but had no producer anywhere in the codebase (a "dead signal" audit; a new gate now asserts every consumed tag has a real producer). Fix `BudgetExhausted` specifically: it does have real consumers, and is now actually published when a budget killswitch aborts a run, instead of the abort happening silently.
