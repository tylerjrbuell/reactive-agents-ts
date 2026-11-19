---
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
---

`ReasoningStepCompleted` gains an optional `structured` field (`ReasoningStepData`, discriminated on `kind`: `tot-node`, `tot-path`, `code-action`, `reflexion`, `strategy-choice`, `plan-step`) so UIs can render per-strategy visuals without parsing text. Additive: existing events and recorded traces are unchanged. Schemas are exported as `ReasoningStepDataSchema` and per-variant schemas.

Tree-of-thought, code-action and reflexion now fill it: ToT publishes a `tot-node` per explored node (score, `pruned`), re-emits the chosen nodes (and the root) with `selected: true`, then one `tot-path`; code-action carries the generated code, the sandbox result (`stdout` is the observation text, `stderr` the sandbox failure) and the verify verdict; reflexion carries the full critique and whether it accepted the attempt. Text fields are unchanged.

Adaptive publishes a `strategy-choice` payload (`selected`, `reason`: `heuristic | classifier | classifier-skip | cost-downgrade | fallback`, optional `note`) at each decision point. Plan-execute and blueprint publish `plan-step` payloads (`stepIndex`, `status`: `started | done | failed | retry | patched`, `attempt` on retry, optional `note`) on their step lifecycle events. Labels and text are unchanged. `rewoo` stays an alias of blueprint, so its events carry the `blueprint` strategy name and `blueprint:*` labels.
