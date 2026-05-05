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

Critical: Fix all package.json bun exports pointing to non-existent src/ directory. All packages were exporting `"bun": "./src/index.ts"` in their exports, but npm packages only include dist/. This caused Bun module resolution to fail when importing these packages from npm-installed CLI.

This fix is critical for v0.10.1 release viability.
