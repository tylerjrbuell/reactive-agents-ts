---
"@reactive-agents/reasoning": patch
---

A think call made with tools withheld no longer tells the model to call a tool. After two unparseable tool-call replies the next request has no tool schemas, but its `Guidance:` block still carried "REQUIRED tools not yet called … Call these" and the stall nudge ("Required tool quota not met … Continue calling"). The stall nudge also replaced the plain-text instruction, so the model never saw it. That turn now renders only the plain-text instruction, the fact about the last call, and the environment notice. Live verdict: 16 of 18 withheld turns showed a "call X" steer, and 2 runs ended at strike 3.
