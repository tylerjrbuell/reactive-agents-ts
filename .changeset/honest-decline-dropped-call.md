---
"@reactive-agents/reasoning": patch
---

An honest decline the model writes in the same turn as a tool call that a guard then drops (for example the dispatcher early-stop firing on a required tool that always errors) now ends the run as an abstention carrying the model's own words. Before, the decline was skipped because its turn had call ids, and the run failed with "stopped before the model wrote a final answer". A turn whose calls actually ran still defers to their results.
