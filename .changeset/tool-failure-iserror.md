---
"@reactive-agents/reasoning": patch
---

Real tool failures (handler error, timeout, non-zero exit) now reach the model as `tool_result` messages marked `isError`, so the tool-failure-streak guard can fire on the kernel path. Gate refusals stay `refused` and do not count as failures. Failed results are excluded from the synthesis tool data, as `finalize` already documented.
