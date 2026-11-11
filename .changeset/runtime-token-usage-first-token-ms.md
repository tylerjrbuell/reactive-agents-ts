---
"@reactive-agents/runtime": patch
---

The streamed `TokenUsage` event now carries optional `firstTokenMs` (milliseconds to the first streamed output token), forwarded from `LLMRequestCompleted`. It is absent for non-streamed calls. With it, a consumer can report a true output rate instead of a duration-wide lower bound.
