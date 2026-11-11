---
"@reactive-agents/runtime": minor
---

`.withTools({ builtins: ["git"] })` registers a `shell-execute` scoped to the preset's programs (`git` and `gh`). It runs in the run's workspace, so git sees your repo.

- With no workspace set, the scoped shell runs in the process's current directory (`process.cwd()`), as `git-cli`, `gh-cli` and `gws-cli` did, so `git log` works in the directory the app was started from. It does not fall back to a `/tmp` sandbox. With `terminal` on, the terminal's working-directory rules apply unchanged. The tool description the model reads says the same: the scoped shell's says it runs in the host process's current directory when no workspace is set; the terminal's still says `/tmp`.

- With `terminal` also on, the agent still has one `shell-execute`: the preset's programs are added to the terminal's `additionalCommands`, and the terminal keeps its own approval and risk settings.
- `gh-cli` and `git-cli` still work in `builtins`, `allowedTools` and `requiredTools`. Each one means `shell-execute` scoped to its program, and the build prints one deprecation warning per name. `gws-cli` and `workspace` select no tool; the build prints a deprecation warning that says to allow `gws` in the terminal. `requiredTools: ["git-cli"]` is met by a `shell-execute` call. The scalar form (`builtins: "gh-cli"`, `builtins: "workspace"`) is no longer a `ToolsOptionError` and warns the same way as the array form.
- `allowedTools` and `requiredTools` now resolve toolset names the same way `builtins` does (`allowedTools: ["git"]` allows `shell-execute`). A name that is one of your own tools stays literal: with a custom tool named `web`, `allowedTools: ["web"]` still means that tool.
- A `.withContract()` that requires `gh-cli` (or `git-cli`) passes build validation: the name resolves to the scoped `shell-execute` the build registers.
