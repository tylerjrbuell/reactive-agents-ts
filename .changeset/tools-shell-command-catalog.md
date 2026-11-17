---
"@reactive-agents/tools": minor
---

A tool call that omits a required parameter now gets an error that names the parameter and shows a valid example call, for example `Missing required parameter "command". Valid call: shell-execute({"command":"git log --oneline -5"})`. The `shell-execute` definition carries a typed `commandPolicy` (`allowedCommands`, `notEnabledCommands`, `sandbox`, `workingDirectory`) derived from its real allowlist, and the new `shellCommandAvailability()` and `isCommandOnPath()` report which allowed commands exist on PATH (cached, no process spawn), so a planner does not need a step like `gh --version`.
