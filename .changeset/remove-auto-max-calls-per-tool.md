---
"@reactive-agents/runtime": patch
---

Required tools are no longer capped at their required count + 2 calls by default. The runtime used to derive a per-tool call budget from the required-tool set (3 calls for a required tool with no quantity), which silently dropped legitimate calls to distinct targets — a task that must read six files and write six files lost reads and writes 4–6. The runtime now passes no per-tool call budget to the kernel; identical-call loops remain caught by the repetition guard. The internal `buildAutoMaxCallsPerTool` helper (re-exported from `execution-engine.ts`, not from the package entry) is removed.
