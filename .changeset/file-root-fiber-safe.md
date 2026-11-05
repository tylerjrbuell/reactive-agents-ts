---
"@reactive-agents/tools": patch
---

File tools now keep their sandbox root across Effect fiber scheduling. The root lived only in AsyncLocalStorage, which Effect's scheduler can lose after a yield, so a relative `file-write` path inside `withFileRoot(dir, …)` could resolve against `process.cwd()` and escape the run's directory. A `FileRootRef` FiberRef now carries the root (`bindFileRoot(effect)` pins it), and `getFileRoot()` reads it first. New exports: `FileRootRef`, `bindFileRoot`, `currentFileRoot`.
