---
"@reactive-agents/react": patch
"@reactive-agents/vue": patch
"@reactive-agents/svelte": patch
---

Dedupe each binding's `AgentStreamEvent` type onto `ui-core`'s canonical `UiStreamEvent`, removing three divergent copies of the same wire-event shape.
