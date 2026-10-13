---
"@reactive-agents/llm-provider": patch
---

Stream-drop `EOF` is now classified transient and retried. A live run died at iteration 0 with `ollama request failed: EOF` (trace 01M4V5GH4H43KJDCA3EC0JGVZW; same class killed 6/8 phi4 attempts in the W3c capture window) — Ollama's Go transport surfaces a server-side stream drop (model load/evict race) as a bare `EOF` / `unexpected EOF` read error, which was missing from the NETWORK_FAULT vocabulary, so the classifier sent it down the generic PERMANENT branch and the pre-first-emission stream retry (EH-1 guard) never engaged. One vocabulary addition converts the hard run-failure into a transparent backoff-retry: `retryStreamBeforeFirstEmission` re-attempts an EOF dropped BEFORE any delta; the emittedAny latch keeps mid-stream drops surfacing unretried (no duplicated output), and 401/404/400 permanents are pinned unchanged. `context canceled`/`aborted` deliberately excluded — user-initiated termination must never auto-retry.
