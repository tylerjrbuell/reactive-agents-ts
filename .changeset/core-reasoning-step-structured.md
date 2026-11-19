---
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
---

`ReasoningStepCompleted` gains an optional `structured` field (`ReasoningStepData`, discriminated on `kind`: `tot-node`, `tot-path`, `code-action`, `reflexion`) so UIs can render per-strategy visuals without parsing text. Additive: existing events and recorded traces are unchanged. Schemas are exported as `ReasoningStepDataSchema` and per-variant schemas.

Tree-of-thought, code-action and reflexion now fill it: ToT publishes a `tot-node` per explored node (score, `pruned`), re-emits the chosen nodes (and the root) with `selected: true`, then one `tot-path`; code-action carries the generated code, the sandbox result (`stdout` is the observation text, `stderr` the sandbox failure) and the verify verdict; reflexion carries the full critique and whether it accepted the attempt. Text fields are unchanged.
