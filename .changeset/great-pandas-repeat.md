---
"@reactive-agents/reasoning": patch
---

GH #244: contract compiler emits `action-required` requirements for external-effect tasks (new `ActionCapability` vocabulary: `send-message` | `create-ticket` | `schedule-event`), and the runner's iteration-0 satisfiability preflight abstains honestly with a named missing-capability reason (listing available tools) when zero surface tools are relevant and no other path exists. Questions and information tasks are unaffected; unknown/empty surfaces fall back to the zero-evidence stand-down unchanged.
