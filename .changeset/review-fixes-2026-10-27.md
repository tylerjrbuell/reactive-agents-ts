---
"@reactive-agents/cortex": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
"@reactive-agents/llm-provider": patch
"@reactive-agents/diagnose": minor
"@reactive-agents/cli": minor
---

Adversarial-review fixes. Cortex chat: cached agents are an LRU (`CORTEX_CHAT_MAX_SESSIONS`, default 8) with single-flight builds and shutdown disposal; failed/cancelled turns no longer leave orphan user rows; concurrent turns on one session return `ChatSessionBusyError`; `skills.activate` is no longer stripped by the chat API; content-only documents are accepted; Run Chat and Chat share one SSE reducer. Signal edge: effect classification reads only post-render steps and `synthesize` requires a `final-answer` call. New `rax diagnose signals <runId>`. Runtime: telemetry tool-arg validity uses real tool arguments; structured-output routing uses real model calibration. Ollama capability entries added for bonsai-2:27b, qwen3.8:27b, gemma4:26b.
