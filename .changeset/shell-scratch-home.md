---
"@reactive-agents/tools": patch
---

`shell-execute` no longer points `HOME` and `TMPDIR` at a caller-supplied working directory. When the shell runs in a workspace, each call gets a fresh scratch directory outside it (removed when the call ends), so `~`, dotfiles such as `.gitconfig`, and tool caches never land in your project. `HOME` is still never your real home directory. Without a `cwd`, the shell's own throwaway sandbox remains `HOME`, as before.
