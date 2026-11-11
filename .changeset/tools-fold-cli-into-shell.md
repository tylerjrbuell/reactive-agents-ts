---
"@reactive-agents/tools": minor
---

`gh-cli`, `git-cli` and `gws-cli` are removed. A shell scoped to the named programs replaces them.

- New `scopedShellTool(programs, config?)` returns `shell-execute` that runs only those programs, e.g. `scopedShellTool(["git", "gh"])`. The model writes the full command (`gh repo view owner/name`). This removes the `gh gh ...` / `git git ...` failures the wrappers had (29% and 38% of their calls in 3,090 traces). The guard, sandbox, timeout and output cap are shell-execute's own. Anything outside the list, `;`/`&&` chaining into another program, `$(...)` and backticks are refused.
- The toolset alias `git` now expands to `shell-execute`. `BUILTIN_SHELL_PRESETS` lists its programs: `git` and `gh`.
- New `resolveBuiltinSelection(names)` returns the tool names, the programs the scoped shell needs, and a deprecation notice for each removed name. `"gh-cli"` and `"git-cli"` resolve to `shell-execute` scoped to their program. `"gws-cli"` selects no tool (see `tools-trap-heals`). `"all"` no longer grants git or gh: no shell is granted implicitly.
- The scoped shell keeps the old wrappers' posture: `requiresApproval: false`, `riskLevel: "medium"`. Plain `shell-execute` (`terminal: true`) is unchanged.
- When `git` is in the list, git reads a per-call copy of your global git config (`~/.gitconfig` or `$XDG_CONFIG_HOME/git/config`), so commits carry your name and credential helpers work. `GIT_AUTHOR_*` and `GIT_COMMITTER_*` are forwarded when set. Because it is a copy, `git config --global` in the shell never changes your real file. New `ShellExecuteConfig.inheritGitConfig` controls this; plain `shell-execute` does not inherit.
- The shell's host environment now forwards the Google Workspace CLI credential store (`GOOGLE_WORKSPACE_CLI_CONFIG_DIR`, default `~/.config/gws`) and its token variables, the same way it already forwarded `gh`'s. Before this, `gws` calls failed with 401 under the confined HOME.
- `git -C <dir> ...` is no longer refused as "git -c is blocked". The config-injection guard was case-insensitive, so the change-directory flag `-C` matched it. The guard is now case-sensitive and still refuses `-c key=value`, glued `-ckey=value`, quoted `'-c'`, `--config` and `--config-env`.
- The shell now refuses git options that run a program you name. These are `--upload-pack`, `--receive-pack` and their alias `--exec`, in any subcommand, with `=` or a space, quoted or abbreviated (`--up`). It also refuses `clone -u <cmd>`, and `--exec-path=<dir>`. The same applies to flags passed through `gh repo clone ... --`. `git push -u`, `git fetch -u` and the bare `git --exec-path` stay allowed. Side effect: `git rebase --exec` is refused too, because it shares the `--exec` spelling.
