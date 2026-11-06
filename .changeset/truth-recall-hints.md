---
"@reactive-agents/reasoning": patch
---

Recall instructions render only when `recall` is on the model's tool surface. This covers the overflow-preview hint, the history-compaction stub and the duplicate-gather nudge. When recall is not offered, the compaction stub names the stored keys without claiming they can be retrieved, and the dedup nudge points at the result the model already has. The code-execute failure text no longer suggests a keyless `recall()`. When the compaction stub does list recall pointers, the recall-overflow gate now treats it like a truncated tool result and keeps recall callable.
