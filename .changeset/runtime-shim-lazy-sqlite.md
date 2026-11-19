---
"@reactive-agents/runtime-shim": patch
---

`Database` now loads its SQLite backend (`node:sqlite` / `bun:sqlite`) on the first `new Database(...)` instead of at import. Under Node, importing `reactive-agents` or running `rax-diagnose` no longer prints `ExperimentalWarning: SQLite is an experimental feature` unless a database is actually opened. `instanceof Database` is not supported; type against `DatabaseLike`.
