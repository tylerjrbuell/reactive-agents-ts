---
"@reactive-agents/tools": patch
---

shell-execute honors a configured timeout. `terminal.timeoutMs` (ShellExecuteConfig.timeoutMs) above 30s was silently capped at 30s, because the tool definition hard-coded `timeoutMs: 30_000` and ToolService enforces the definition timeout. The definition now uses the configured timeout plus a 2s grace margin (`SHELL_TIMEOUT_GRACE_MS`), so the shell's own kill fires first and returns the output it collected instead of a bare "timed out after 30000ms" error. The default kill stays 30s.
