---
"@reactive-agents/tools": patch
---

New `dockerExecuteToolFor(config)` builds the docker-execute definition from the same sandbox config as `makeDockerExecuteHandler(config)`. The description states the resolved network mode, whether the filesystem is read-only, the memory limit and the kill timeout. The definition timeout follows `config.timeoutMs`, so a sandbox timeout above 30s is no longer cut at 30s by ToolService. `dockerExecuteTool` is `dockerExecuteToolFor()` (default config) and only gains the memory, timeout and read-only filesystem facts in its text.
