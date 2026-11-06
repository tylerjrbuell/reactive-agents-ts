---
"@reactive-agents/runtime": minor
---

Set an agent's working directory with `.withTools({ workspace: "/abs/path" })`, and override it for one run with `agent.run(task, { workspace })` (also `runStream()` and `runEffect()`). File tools resolve relative paths against the workspace and refuse paths outside it. The built-in `shell-execute` tool (`terminal: true`) runs in it; a `terminal.cwd` resolves inside the workspace and is refused if it escapes, unless `terminal.allowUnsafeCwd` is set. Sub-agents inherit it. The workspace must be an existing directory: `.withTools()` throws `ToolsOptionError`, `run()` rejects and `runStream()` ends with a `StreamError` otherwise. Precedence: run option, builder option, ambient `withFileRoot()`, none. Round-trips through `toConfig()` as `tools.workspace`.

Behavior change: with an ambient `withFileRoot()` root active and `terminal` on, `shell-execute` now runs in that root too (it used a /tmp sandbox dir before), so file tools and the shell agree on one directory.
