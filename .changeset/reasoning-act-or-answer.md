---
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
---

New opt-in harness switch `actOrAnswer` (`.withHarness({ actOrAnswer: true })` or `RA_ACT_OR_ANSWER=1`; default off). On native function calling, when a think turn ends in plain text while tool work is still outstanding (a required tool not yet called, or an unmet delivery condition that only a tool can satisfy), the kernel asks the model once more in the same turn with `toolChoice: "required"` over the turn's callable tools, plus `final-answer` when that tool is offered. If the retry returns a call, the turn runs it through the normal act path. If not, the original reply is handled as before. The retry runs once per stall. The next one can only happen after a tool has run. Each retry is recorded as a `guard-fired` event (`guard: "act-or-answer"`, `metadata.result`: `called`, `answered` or `no-call`) and as an intervention on the run receipt. The token usage of both calls is counted. With the switch off, requests are unchanged.
