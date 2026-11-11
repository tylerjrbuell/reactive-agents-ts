---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

`.withApprovalPolicy({ commands: ["git push"] })` gates shell calls by command. The agent's approval gate and every shell it registers (the read-only `git` preset, the terminal) get the same rule list, so in the git preset a matched write such as `git push origin main` now asks for approval instead of being refused: block mode with no `onApprove` refuses it, an approving `onApprove` lets it run, detach mode pauses on it. A shell gets rules only from the approval policy; a hand-set `terminal.approvalCommands` is ignored. Sub-agents inherit the rules with the rest of the policy. The data half of the policy (`mode`, `tools`, `commands`) is now in the declarative `AgentConfig` as `approvalPolicy` and round-trips through `toConfig()` / `fromConfig()`; `onApprove` and `requireFor` stay code-only. An approved push still needs credentials the sandboxed shell does not pass (no credential helper, no SSH keys or agent).
