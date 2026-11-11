---
"@reactive-agents/reasoning": patch
---

Streamed model calls now set `firstTokenMs` on `LLMRequestCompleted`: the milliseconds from request start to the first streamed output (text, tool call, or thinking). `outputTokensPerSecond(event)` from `@reactive-agents/core` uses it to measure generation speed without queue and prefill time. Non-streamed calls, and streams that emitted no output, leave the field absent.
