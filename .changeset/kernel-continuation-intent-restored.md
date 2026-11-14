---
"@reactive-agents/reasoning": patch
---

The continuation-intent verifier check rejects again: a rejected continuation announcement ("I'll make one more attempt...:") never ships as the run's output. Only the semantic checks (fabricated-measurement, listed-entities) stay demoted to advice.
