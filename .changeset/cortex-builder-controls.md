---
"@reactive-agents/cortex": minor
---

Cortex chat gets a quick bar for the settings you change most: strategy, tools, shell, workspace and the per-turn step cap sit next to provider and model, each one click (or `/strategy`, `/tools`, `/terminal`, `/workspace`, `/iterations`) away. The tools picker toggles built-in toolsets (research, web, file, code, git, workspace), single tools, MCP servers, or copies a saved agent's toolset, and the current toolset is always shown.

Set a workspace (an absolute, existing directory) on a chat, run or saved agent: file tools work inside it and the shell runs in it, so the shell no longer refuses to start outside /tmp. Cortex checks the path when you set it and refuses one that does not exist.

The builder panel adds shell options (Docker sandbox, shell directory, timeout, output cap, command groups, allow a directory outside the workspace), real guardrail switches (prompt injection, PII, toxicity) with a blocked-phrases list in place of the sliders that had no effect, and the approval mode for approval-gated tools. The advanced framework section now edits list and map options such as `builtins`, `focusedTools`, `maxCallsPerTool`, `riskLevels` and `requiredTools`.

Fixed: chat sessions dropped the advanced framework settings (`rawConfig`, e.g. profile) and durable-run settings; they now reach the agent the same way Lab runs do.
