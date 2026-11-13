---
"@reactive-agents/llm-provider"
---

Added a static capability row for Ollama `gpt-oss:latest` (20.9B MoE, 131K native window, thinking supported). Benchmark preflight no longer marks it inconclusive. The row sets `toolCallDialect: "native-fc"` from what the Ollama model card advertises (`tools`); tool emission is not behaviorally measured and there is no calibration file.
