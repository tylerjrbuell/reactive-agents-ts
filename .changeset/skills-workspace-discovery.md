---
"@reactive-agents/runtime": minor
"@reactive-agents/reactive-intelligence": minor
---

Skills resolve per run at the run's workspace. `.withSkills()` no longer requires `paths`: with no arguments it discovers `<root>/.agents/skills` (plus `<root>/.<agentId>/skills` and `<root>/.claude/skills`), where `<root>` is the run's `workspace`, else `.withTools({ workspace })`, else an ambient `withFileRoot()`, else `process.cwd()`. Relative `paths` now resolve against that root instead of `process.cwd()` (the same thing when no workspace is bound). New `run(task, { skills: { activate: [...] } })` pins skills for one run, merged with `.withSkills({ activate })`. Each skills-enabled run records `run-started.config.skills = { roots, catalog: [{ name, sha256 }], pinned }`; runs without `.withSkills()` have no `skills` key.

**Breaking:** the user-global skill directories `~/.agents/skills` and `~/.reactive-agents/skills` are now opt-in. To keep loading them, add `global: true`: `.withSkills({ global: true })`. `discoverSkills` now takes `(root, paths, { global?, agentId? })`, and the resolver config's `skipGlobalPaths` is replaced by `includeGlobal` (default `false`).
