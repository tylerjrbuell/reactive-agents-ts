---
"@reactive-agents/cli": patch
---

Fix `rax examples demo` spawning demos from the built CLI and add island-sim thinking-mode passthrough. The demo working directory resolved against the `src` layout, so the bundled `dist/index.js` pointed at a nonexistent directory and `Bun.spawn` surfaced it as `ENOENT posix_spawn 'bun'`. The CLI now probes both `src` and `dist` layouts, spawns via `node:child_process` with the absolute Bun binary, and errors clearly when demo files are absent. Also adds `--minds scripted|judgment|llm` (mapped to `ISLAND_SIM_JUDGMENT` / `ISLAND_SIM_LLM_DECISIONS`, explicit flag wins over ambient env), forwards `demo <name> --help` to the demo process, and teaches the island-sim demo itself to parse `--minds` with matching precedence.
