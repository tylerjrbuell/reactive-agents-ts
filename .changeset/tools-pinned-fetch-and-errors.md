---
"@reactive-agents/tools": patch
---

`http-get` now connects to the address it validated (`fetchPinned`), so a hostname that resolves to a public address at check time and a private or metadata address at connect time (DNS rebinding) can no longer reach internal services; each redirect hop is re-pinned and credentials are still dropped on cross-origin hops. `web-search` requests are now cancelled when the run is interrupted, retry with an Effect schedule instead of timers, cancel the bodies of retried responses, and fail with typed errors. `connectMCPServer` no longer requires `transport` in its type (it is inferred from `command` or `endpoint`, as before).
