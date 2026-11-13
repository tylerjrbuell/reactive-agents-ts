---
"@reactive-agents/a2a": patch
---

The A2A client now bounds `sendMessage`, `getTask` and `cancelTask`: a per-request timeout (`timeoutMs`, default 30s), a streamed response size cap (`maxResponseBytes`, default 5 MiB) and the shared egress policy through the SSRF-safe pinned fetch (`allowPrivateNetwork` to opt in or out; metadata and link-local always refused; redirects refused). New typed errors `RequestTimeoutError`, `ResponseTooLargeError` and `EgressDeniedError` join the client error union (`ClientRequestError`).
