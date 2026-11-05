---
"@reactive-agents/reasoning": patch
---

plan-execute: a composite step limited to a few tools (`toolHints`) is now held only to the required tools it can see. Before, it inherited every required tool of the whole run, gave up before its first call, and was still recorded as done, so the next step worked from nothing and invented data. A step whose sub-agent gives up or hits an LLM error is now reported as failed, so the plan repairs it or skips the steps that depend on it.
