---
"@reactive-agents/cortex": patch
"@reactive-agents/observability": patch
"@reactive-agents/ui-core": patch
---

Cortex: a failed utility run no longer becomes the chat title or a compaction summary; utility prompts run without extended thinking; failed chat turns are marked "did not finish" live and after reload; thinking blocks no longer repeat each other; per-pass guard rows move to the internal timeline lane; strategy switches and tolerated successes are shown in the run view. Console: metric values are rounded, the low-confidence grade no longer contradicts its cap, step-count alerts fire only on runs that did not succeed, and live mode no longer prints the logs twice.
