---
"@reactive-agents/tools": patch
---

code-execute: module-style code now runs (single-line `import` is hoisted, `export` is dropped from declarations) instead of failing with "Unexpected export". Failure messages are always non-empty and cleaner: no temp-file path or Bun banner, a stated reason for silent exits and empty throws, a Docker-failure message that says nothing ran, and a hint that the working directory is `/tmp` when a relative file is missing.
