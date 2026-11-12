---
"@reactive-agents/tools": patch
"@reactive-agents/guardrails": patch
---

`shell-execute` now refuses `find -fprint`, `-fprint0`, `-fprintf` and `-fls` (they write files), and refuses `find -exec`, `-execdir`, `-ok` and `-okdir` when the program they run is not on the allow-list, is a wrapper such as `env` or `xargs`, or is a `sed` / `awk` program that could run commands. The PII email pattern is now linear-time: an 80 KB adversarial input no longer blocks the event loop for seconds. Detection of ordinary addresses is unchanged.
