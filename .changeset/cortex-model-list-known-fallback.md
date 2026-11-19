---
"@reactive-agents/cortex": patch
---

Model pickers say why a list is a fallback. When a provider's live model list fails, Cortex now lists every known model (framework presets, then PriceBook ids) with the note "Live list unavailable (…); showing known models." An out-of-credits or spending-limit refusal reads "Live list unavailable: <provider> account out of credits or spending limit reached; showing known models." PriceBook-only ids sit in their own "Known models (not confirmed live)" section in the Lab model select and the chat model menu. `GET /api/models/:provider` rows carry the framework's `listedBy`. The model page price card for hosted $0 models no longer claims a "free tier".
