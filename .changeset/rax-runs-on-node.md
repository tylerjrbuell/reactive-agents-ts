---
"@reactive-agents/cli": patch
---

`rax` now runs on Node.js 22.5+ without Bun installed: the binary's shebang is `#!/usr/bin/env node`, so `npx @reactive-agents/cli demo` works on a Node-only machine. `rax --help`, `demo`, `init` (every template), `run`, `playground` and `cortex --help` run on Node, and Node's "SQLite is an experimental feature" notice no longer prints on every command. On Node, `rax init` and `rax demo` print commands for the package manager that launched `rax` (npm by default). `rax dev` runs your entry with Bun when installed and otherwise with the project's `tsx`. `rax cortex` and `rax examples suite|demo` still need Bun. On Node they re-run under Bun when `bun` is on `PATH`, and otherwise print one "needs Bun" line instead of a stack trace. Bun users can force the Bun runtime with `bunx --bun rax` or `bun run --bun rax`.
