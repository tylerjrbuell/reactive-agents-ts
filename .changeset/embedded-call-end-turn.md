---
"@reactive-agents/reasoning": patch
---

A tool call embedded in an assistant reply that ends with `end_turn` (for example `const x = fileRead("/abs")` for a low-risk tool) is now dispatched instead of the run completing on that text, and an unresolved call-shaped reply is no longer delivered as a successful final answer; it goes to the unresolved-call guard.
