---
"@reactive-agents/reasoning": patch
---

Failure-recovery steering only names an alternate tool when that tool can substitute for the failed one: the same kind of work (read, write, execute) on the same kind of target (web, file, or the same service). The model no longer reads "file-read failed. Try an alternate path now: file-write". With no substitute available, the steer asks the model to retry the failed tool with corrected arguments.
