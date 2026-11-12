---
"@reactive-agents/tools": minor
---

`web-search` accepts explicit per-agent API keys and an ordered provider list. New exports: `makeWebSearchHandler({ apiKeys?, providers? })`, `WEB_SEARCH_PROVIDERS` (ordered ids with the env vars each reads), `WebSearchConfig`. Explicit keys win over environment variables; providers without one fall back to env. Keys are scrubbed from error text. Default behavior is unchanged.
