---
"@reactive-agents/reasoning": patch
---

A model turn that hits the output-token limit while only thinking (no answer text, no tool call) is no longer retried with a much larger output budget. That retry let a runaway think for minutes more. It now gets one retry at the same budget with a recovery prompt, and a second runaway ends the run as failed with a clear "thinking runaway" error. A turn cut off mid-answer still gets the larger budget. Each decision is recorded as a `thinking-runaway` harness signal in the trace.
