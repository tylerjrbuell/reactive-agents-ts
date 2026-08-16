---
"@reactive-agents/core": minor
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

Added — `prompt.guidance` compose tag

Of the 9 harness-authored "Guidance:" text channels folded into the system
prompt each turn (required-tools reminders, oracle/ICS nudges, error-
recovery hints, the finish nudge, quality-gate hints, evidence-gap
redirects), only one had any override point before this. `.compose(h =>
h.on('prompt.guidance', (text, ctx) => ...))` can now inspect, replace, or
suppress the entire rendered guidance block — the same level of control
`prompt.system` already gives over your own base prompt, now extended to
what the harness itself says on top of it.

Fixed — corrected `withEnvironment()`'s docs, which incorrectly claimed the
auto-injected `Environment:` block was reachable via the `prompt.system`
compose hook. It isn't (assembled in a separate channel) — documented
honestly rather than left misleading.
