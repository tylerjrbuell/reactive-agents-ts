---
"@reactive-agents/a2a": patch
---

The A2A client's `auth: { type: "apiKey" }` now sends `Authorization: Bearer <apiKey>`, the only scheme the built-in server accepts (it previously sent `X-API-Key` and got 401). Agent-card discovery (`discoverAgent`, `getAgentCard`) now goes through the SSRF-safe pinned fetch (DNS validated once and pinned, redirects refused) and has a time budget, default 10s, set with `egress: { timeoutMs }`.
