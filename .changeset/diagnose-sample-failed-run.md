---
"@reactive-agents/diagnose": patch
---

`@reactive-agents/diagnose` now ships a real recorded failed run at `examples/failed-run.jsonl`, so you can try `rax-diagnose` without an API key, Ollama or a run of your own: `npx rax-diagnose cause node_modules/@reactive-agents/diagnose/examples/failed-run.jsonl`. The run comes from an experimental opt-in configuration (a local qwen2.5-coder:14b model), not the default harness. `cause` reports that the model never called a tool, and `attribute` traces the failure to contradictory harness guidance.
