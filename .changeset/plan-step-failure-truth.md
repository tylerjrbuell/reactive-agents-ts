---
"@reactive-agents/reasoning": patch
---

plan-execute: a plan step whose direct tool call fails (unknown tool, missing argument, tool error) is now recorded as a failed step and the run ends `partial` (the delivery verdict may still lift it), instead of counting the error text as a completed step. A planned `tool_call` step that lacks a required argument (per the tool's schema) now runs as a composite step scoped to that tool, so the model fills the argument instead of the harness dispatching a call that can only fail.
