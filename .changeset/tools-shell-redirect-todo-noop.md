---
"@reactive-agents/tools": patch
---

`shell-execute` now allows redirects that contain `&`: `2>&1`, `>&2`, `1>&2`, `&>file`, `&>>file` and `|&`. They were refused as a background operator, which broke commands like `bun test 2>&1 | tail -20`. Background `&` (`sleep 1 &`, `sleep 1 & ls`, `a &b`) is still refused. `|&` starts a new pipeline segment, so the program after it is checked against the allow-list. Redirect targets are now path-checked even when glued to the operator (`>&/etc/x`, `2>/etc/x`). In the read-only git/gh shell, a descriptor dup such as `git diff 2>&1 | head` no longer counts as an output redirect.

`todo` keeps one item in progress at a time. `start` with several targets starts one: the item already in progress, else the first pending one. `start` with no id starts the first open item. A `start` or `done` call that changes nothing now begins with a `No change: …` line that names the next step, for example `No change: item 1 is already in progress — do its work now with a tool, then todo({action:"done", id:1}).`

`todo` has a new `reopen` action that puts a done item back to pending. `undo`, `re-open` and `uncheck` heal to it, and canonical verbs are accepted in any case (`Done`). The `todo` checklist cannot edit, remove or clear items yet. `remove`, `delete`, `edit`, `rename`, `clear`, `reset` and `patch` now return an error that says so. Before, the error suggested the closest valid verb, so `delete` could get `done`.
