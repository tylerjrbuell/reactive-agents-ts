---
"@reactive-agents/runtime": patch
"@reactive-agents/cost": patch
"@reactive-agents/health": patch
"@reactive-agents/interaction": patch
---

The npm READMEs for runtime, cost, health and interaction now follow one template (pitch, stability, install, usage, API, docs, runtime, license) and link to the docs instead of duplicating them. They fix dead docs links, remove relative links, and correct examples that did not match the code: `.withHealthCheck()` takes no arguments, `/ready` returns 503 only when unhealthy, and the interaction examples now use real service methods.
