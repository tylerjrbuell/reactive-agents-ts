---
"@reactive-agents/tools": patch
---

`http-get` now reports a failure instead of a success for HTTP 4xx/5xx responses and for 200 responses whose body is a short (under 2 KB) "not found" page. The failure message names the status and URL and suggests another source, so dead links no longer inflate success counts or hide from the broken-tool tracker. Normal pages and JSON are unchanged.
