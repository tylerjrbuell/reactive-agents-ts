---
"@reactive-agents/llm-provider": patch
---

Wave 7.3: all shipped SLM priors re-measured (n=5 runs, probeVersion 2;
qwen3:4b at n=10 after a bistable attention probe). Data-only change, but it
moves routing posteriors: cogito:8b parallel partial→sequential-only,
gemma4:e4b + llama3.2 dialect None→native-fc, qwen2.5-coder:7b stub
(runs:0) replaced with measured data. Each behaviorally-significant delta
was confirmed by a second measurement pass.
