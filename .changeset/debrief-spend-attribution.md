---
"@reactive-agents/runtime": patch
"@reactive-agents/core": patch
---

The background debrief's LLM call is now attributed to the run: its `LLMRequestCompleted` event carries the run's taskId instead of `llm-direct`. Its spend (input, output, total tokens, cost and `calls`) is readable after the run from `result.debriefRich()` and the run's `DebriefCompleted` event (`debrief.metrics.synthesisTokens`, now declared on the core event type). `tokensUsed` and `llmCalls` count the run up to its result; the run's full billed spend is `tokensUsed + synthesisTokens.total`. The debrief still runs in the background, so results are not delayed.
