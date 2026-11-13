---
"@reactive-agents/runtime-shim": minor
---

Add `fetchPinned` and `resolvePublicUrl` to close the DNS-rebinding gap in the egress guard. `fetchPinned` resolves a hostname once, validates every answer against the `assertPublicUrl` blocklist, connects to that validated address (Host and TLS server name preserved), and re-validates and re-pins each redirect hop. Refusals throw the new tagged `PublicUrlError`. `assertPublicUrl` keeps its behavior.
