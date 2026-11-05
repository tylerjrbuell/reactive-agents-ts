---
"@reactive-agents/reasoning": patch
---

Stored tool-result keys (`_tool_result_N`) are now minted from the run's own scratchpad instead of a process-wide counter, so identical runs in one process send identical prompts (replay determinism; long-lived servers no longer drift). The per-iteration repetition checks (flail signature, content stability) use a banded early-exit similarity test instead of a full Levenshtein matrix, about 12x faster on long thoughts with identical results.
