---
"@reactive-agents/reasoning": patch
---

The adaptive strategy now runs on the shared strategy run substrate and ends by relaying the result of the strategy it dispatched to. That result keeps its own status, output, verdict, abstention and pause fields exactly as the dispatched strategy produced them; adaptive no longer re-judges it. Reported `llmCalls` is now complete: it includes the dispatched strategy's calls plus adaptive's own classifier call (before, adaptive reported no `llmCalls` at all). When adaptive falls back to reactive after a partial result, the tokens, cost and calls of the abandoned attempt are now counted in the run's spend.
