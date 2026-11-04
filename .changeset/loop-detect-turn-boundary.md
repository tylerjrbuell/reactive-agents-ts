---
"@reactive-agents/reasoning": patch
---

Loop detection now runs only at turn boundaries, so a strategy switch no longer discards a native tool call the model made in the same turn. A switch that still drops pending calls is recorded as a `strategy_switch` guard event.
