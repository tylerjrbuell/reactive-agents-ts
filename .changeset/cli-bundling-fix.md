---
"@reactive-agents/a2a": patch
"@reactive-agents/benchmarks": patch
"@reactive-agents/channels": patch
"@reactive-agents/cli": patch
"@reactive-agents/core": patch
"@reactive-agents/cost": patch
"@reactive-agents/diagnose": patch
"@reactive-agents/eval": patch
"@reactive-agents/gateway": patch
"@reactive-agents/guardrails": patch
"@reactive-agents/health": patch
"@reactive-agents/identity": patch
"@reactive-agents/interaction": patch
"@reactive-agents/llm-provider": patch
"@reactive-agents/memory": patch
"@reactive-agents/observability": patch
"@reactive-agents/orchestration": patch
"@reactive-agents/prompts": patch
"@reactive-agents/react": patch
"@reactive-agents/reactive-intelligence": patch
"@reactive-agents/runtime": patch
"@reactive-agents/svelte": patch
"@reactive-agents/testing": patch
"@reactive-agents/tools": patch
"@reactive-agents/trace": patch
"@reactive-agents/verification": patch
"reactive-agents": patch
---

Fix CLI module resolution: mark @reactive-agents/eval, @reactive-agents/llm-provider, @reactive-agents/a2a, and @reactive-agents/trace as external dependencies in tsup config. This prevents bundling issues when the CLI is installed from npm and needs to dynamically require these modules at runtime.
