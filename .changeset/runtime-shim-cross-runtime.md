---
"@reactive-agents/runtime-shim": minor
"@reactive-agents/core": minor
"@reactive-agents/llm-provider": minor
"@reactive-agents/memory": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/tools": minor
"@reactive-agents/guardrails": minor
"@reactive-agents/verification": minor
"@reactive-agents/cost": minor
"@reactive-agents/identity": minor
"@reactive-agents/observability": minor
"@reactive-agents/interaction": minor
"@reactive-agents/orchestration": minor
"@reactive-agents/prompts": minor
"@reactive-agents/eval": minor
"@reactive-agents/a2a": minor
"@reactive-agents/gateway": minor
"@reactive-agents/testing": minor
"@reactive-agents/reactive-intelligence": minor
"@reactive-agents/runtime": minor
"reactive-agents": minor
"@reactive-agents/cli": minor
"@reactive-agents/health": minor
"@reactive-agents/benchmarks": minor
"@reactive-agents/channels": minor
"@reactive-agents/svelte": patch
"@reactive-agents/vue": patch
"@reactive-agents/react": patch
---

Add `@reactive-agents/runtime-shim` cross-runtime adapter package. The framework now runs on both Bun (with native `Bun.*` fast paths) and Node.js 22.5+ (with `node:sqlite`, `node:child_process`, `node:fs.glob`).

**What changed:**
- New package `@reactive-agents/runtime-shim` exports unified primitives: `Database`, `spawn`, `writeFile`, `readFile`, `hash`, `serve`, `glob`, `isMain`, `isBun`, `isNode`.
- Internal `bun:sqlite` imports and `Bun.*` calls across `memory`, `cost`, `reactive-intelligence`, `llm-provider`, `tools`, `eval`, `a2a`, `benchmarks`, `health`, `judge-server` now route through the shim.
- `@reactive-agents/memory`: FTS5 virtual tables are now optional. When running on `node:sqlite` (which lacks FTS5), the package logs a warning and falls back to `LIKE`-based search on the `content` column. Full-text scoring is preserved on Bun.
- Zero call-site API changes for end users.

**Why:**
- Unblocks Stackblitz embeds (Node-only WebContainer)
- Unblocks Vercel, Netlify, Cloudflare Workers (Node compat layer)
- Removes hard `engines.bun` requirement from the dependency chain

**Bump:** minor for all packages using the shim. Patch for `@reactive-agents/svelte`, `@reactive-agents/vue`, `@reactive-agents/react` — these don't import the shim but need a version bump to clear npm publish conflicts.
