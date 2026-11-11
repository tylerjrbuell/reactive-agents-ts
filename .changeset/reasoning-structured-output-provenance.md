---
"@reactive-agents/reasoning": minor
---

`extractStructuredOutput()` now reports how each extraction succeeded or failed. A success carries `result.report`. A failure is a `StructuredOutputExtractionError` with the same `report`. The report covers the layer that produced the value (`native | prompt | repaired | coerced | retried`), the native outcome, the attempt counts, the JSON repairs applied, coercion, and budget escalation. A failure also lists field-level validation errors (JSON Pointer `path` plus `message`) and a failure kind. Error messages and retry prompts are unchanged.
