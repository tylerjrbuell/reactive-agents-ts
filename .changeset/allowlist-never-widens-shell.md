---
"@reactive-agents/runtime": patch
---

Security: `allowedTools` no longer widens the shell. Naming the `git` toolset (or the removed `gh-cli` / `git-cli`) in `allowedTools` without `shell-execute` used to allow the agent's whole `shell-execute`, so `.withTools({ terminal: true, allowedTools: ["git", "file-read"] })` granted the full terminal. The one shell now runs only that toolset's programs (`git`, `gh`); the terminal keeps its sandbox settings and approval flags. `builtins: ["git"]` with `allowedTools: ["gh-cli"]` now runs `gh` only. Put `"shell-execute"` in `allowedTools` to allow the full terminal.
