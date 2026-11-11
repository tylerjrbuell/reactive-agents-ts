---
"@reactive-agents/llm-provider": patch
---

Local-tier tool-error recovery guidance now classifies errors by class, not substring. A policy refusal such as shell-execute's "background operator '&' is not supported (escapes the timeout)" no longer gets "timed out, try again" guidance; it is told the call was refused and must change. Real timeouts ("timed out after 120000ms", `ETIMEDOUT`) are recognized, 404 guidance needs an HTTP-status context instead of any "404" digits, and errors that already name the fix ("Allowed commands:", "Closest valid call", "Did you mean", "Valid:") get no extra recovery line.
