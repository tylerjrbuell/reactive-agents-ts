---
"@reactive-agents/cortex": patch
---

Cortex follows the fold of `gh-cli` and `git-cli` into a scoped `shell-execute`. The chat `/tools` picker and the builder's Tools picks offer the `git` (`git · gh via shell`) toolset by name, so selecting it grants a shell limited to those programs, never the full host shell. Chats and saved agents stored with `gh-cli` / `git-cli` open with the `git` toolset; `gws-cli` and the removed `workspace` (gws) toolset are dropped from stored configs with a server warning and never turn on the shell. New `GET /api/tools/shell-presets` lists the programs each shell toolset runs.

While the `git` toolset is picked, the agent always has a shell, so the builder's host-shell checkbox stays checked. Clicking it switches between a shell limited to `git · gh` and the full host shell, and a hint under it says which is on. The chat shell chip and the `/terminal` picker show the same `Shell: git · gh only` state. Unpicking the toolset shows your own shell setting again.
