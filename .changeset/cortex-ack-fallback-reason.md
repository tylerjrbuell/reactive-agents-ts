---
"@reactive-agents/cortex": patch
---

The channel hub activity feed now says why a model-written acknowledgement fell back to canned text (`timeout`, `empty`, `thinking_only` or `error`), for example `acknowledged (canned, owner; model ack fell back: thinking_only)`. The activity record also carries the reason as a field. No message text is shown.
