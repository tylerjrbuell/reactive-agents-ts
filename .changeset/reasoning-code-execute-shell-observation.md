---
"@reactive-agents/reasoning": patch
---

When `code-execute` refuses a shell command, the agent is no longer told to "fix the code". The observation says the command did not run and points to `shell-execute` only when the run offers it; otherwise it says no shell tool is available.
