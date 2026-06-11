---
"@reactive-agents/memory": patch
"@reactive-agents/llm-provider": patch
"@reactive-agents/runtime": patch
"@reactive-agents/observability": patch
"reactive-agents": patch
---

API-honesty fix cluster. Memory operations no longer silently swallow telemetry failures; telemetry sinks expose a health counter. `ResultMetadata` gains `complexity` and `llmCalls` fields, and `ReactiveAgent.getLastDebrief()` provides direct access to the most recent debrief. The interaction HITL surface drops a documented-but-nonexistent phantom method, `confidenceFloor` documentation now matches its actual behavior, the cortex UI `AgentStreamEvent` union is fully typed, and the LLM provider schema deep-clone is deduplicated through a shared helper.
