---
"@reactive-agents/reasoning": patch
---

The Code Action strategy now runs from an npm install. 0.19.0 shipped without the sandbox worker and asked for `dist/sandbox-worker.ts`, so every Code Action run failed with `ModuleNotFound`. The worker is now built to `dist/sandbox-worker.js`, and the sandbox loads it on Bun and on Node 22.5+.
