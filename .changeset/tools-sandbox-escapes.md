---
"@reactive-agents/tools": patch
---

Security: closes four ways a tool call could act outside its sandbox.

- `shell-execute` no longer lets `sed` or `awk` run commands or write files. `echo id | sed e`, `sed '1e id'`, `sed 's/a/b/w/tmp/f'` and `awk '{print $0 |("id")}'` ran host commands or wrote outside the sandbox with the default allow-list. The `sed` and `awk` programs are now parsed and refused unless every construct is known safe (`e`, `w`, `r` commands and flags, `-f` script files, `system()`, `getline`, pipes, `print > file` and `ARGV` are refused; comparisons like `awk '$3 > 5'` still work). `sort --compress-program` is refused too.
- `shell-execute` now path-checks option values, so `sort --output=/tmp/x` and `sort -o/tmp/x` can no longer write outside the sandbox.
- `recall` can no longer read arbitrary files. A model-written `[SPILLED_TO_DISK:/path]` value is no longer dereferenced: spill markers resolve only to files inside the spill directory (symlinks resolved), and `recall` refuses to store content that starts with the marker.
- `grep` can no longer escape the file root through a `glob` such as `../other/*` or an absolute glob, or through a sibling directory sharing the root's name prefix (`/work-secret` vs `/work`).
- `file-read`, `file-write`, `file-edit` and `file-list` now resolve symlinks before confining a path, so a link inside the working root that points outside it is refused. Writes to paths that do not exist yet behave as before.
