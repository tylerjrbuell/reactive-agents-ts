---
"@reactive-agents/core": patch
---

`LLMRequestCompleted` gains an optional `firstTokenMs` field: milliseconds from request start to the first streamed output token, absent for non-streamed calls. New `outputTokensPerSecond(event)` helper returns output tokens/sec over the generation window (`durationMs - firstTokenMs`), or `undefined` when `tokensOut` is missing or the window is not positive. Additive: existing producers and consumers compile unchanged.
