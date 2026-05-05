---
"@reactive-agents/cortex": minor
"@reactive-agents/cli": patch
"@reactive-agents/diagnose": patch
"@reactive-agents/trace": patch
"reactive-agents": patch
---

feat(cortex): publish @reactive-agents/cortex to npm with lazy-load CLI support

- Made cortex publishable to npm as a standalone package with tsup bundling
- Restored `rax cortex` command with lazy-load pattern for optional peer dependency
- Updated CLI with cortex command restoration and full documentation
- Synced all package versions to match coordinated releases
- Cortex fully validated: health API returns 200, UI serves correctly from npm install
