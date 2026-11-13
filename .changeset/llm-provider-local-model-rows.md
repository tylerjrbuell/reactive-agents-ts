---
"@reactive-agents/llm-provider": patch
---

Added static capability rows for 11 more Ollama models: llama3.1, llama3.2:3b, gemma4:e4b, gemma4:12b, granite4:tiny-h, granite3.3, qwen2.5:14b, deepseek-r1:14b, mimo-v2.6, ornith and phi4-mini-reasoning. Benchmark preflight no longer marks them inconclusive, and `RA_BENCH_ALLOW_FALLBACK` is not needed for them. Each row sets `toolCallDialect: "native-fc"` from what the Ollama model card advertises. Only llama3.2:3b and gemma4:e4b have a calibration file that confirms it. Tool emission is unmeasured for gemma4:12b, mimo-v2.6 and ornith (stub templates), and deepseek-r1:14b made no tool call in a smoke run.
