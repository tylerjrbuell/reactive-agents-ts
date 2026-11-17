---
"@reactive-agents/core": patch
"@reactive-agents/observability": patch
"@reactive-agents/observe": patch
"@reactive-agents/runtime-shim": patch
"@reactive-agents/testing": patch
---

Rewrote the npm READMEs to the shared package README standard: pitch, stability tier, install, a working example, API table, docs link, runtime support and license. Fixed code examples that no longer matched the API, and the runtime-shim Node floor (22.5, not 20). The core, observability and testing examples now type-check against the real APIs.
