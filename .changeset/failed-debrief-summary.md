---
"@reactive-agents/runtime": patch
---

A failed run's debrief now says it failed and why. Its summary used to fall back to "Task completed." when the run had no answer text. A run that a runtime check failed after the kernel finished (for example, a declared deliverable that was never produced) also had its debrief recorded as `outcome: "success"`. The debrief now reads the run's failure cause, the same text as `result.error`. A run with a cause is never recorded as a success, and its summary starts with that cause. The LLM-written debrief is told the run outcome and cause too.
