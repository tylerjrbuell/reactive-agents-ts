---
"reactive-agents": patch
---

The `rax` binary shipped by `reactive-agents` now starts with `#!/usr/bin/env node`, so `npx rax` works on machines with Node.js 22.5+ and no Bun installed. `rax cortex` still needs Bun.
