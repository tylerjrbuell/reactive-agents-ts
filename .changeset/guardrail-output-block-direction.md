---
"@reactive-agents/runtime": patch
---

A run blocked by the final-output guardrail screen now says so. `GuardrailViolationError` carries `direction: "input" | "output"`, and `errorContext()` reports output blocks as "Output blocked by a guardrail" instead of "Input blocked", with advice that fits a withheld answer rather than "rephrase input".
