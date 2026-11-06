---
"@reactive-agents/tools": patch
---

The assistant-text tool-call parser now reads a whole line of the form `tool-name {json}`, which is the form the embedded-call refusal hint tells the model to use. Before, a model that copied the hint got no tool call and the run looped.
