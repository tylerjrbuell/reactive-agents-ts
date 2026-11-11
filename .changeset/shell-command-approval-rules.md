---
"@reactive-agents/tools": minor
---

Shell command approval rules. `shellCallMatchesCommandRules(toolName, args, rules)` says whether a shell tool call runs a command a rule names (`"git push"` matches `git push origin main` in any `&&` / `;` / `|` segment). `ShellExecuteConfig.approvalCommands` lets the read-only git/gh shell run a write command that matches one of those rules instead of refusing it; every other write and all output redirects stay refused. The shell does not ask for approval itself: give the same rules to the approval gate so a matched command runs only after a human approves it.
