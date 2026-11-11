---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

`AgentConfig` now carries the data-like builder options that `toConfig()`, `agentConfigToBuilder()` and `agentConfigToSource()` used to drop:

- `thinking` accepts `{ enabled, effort, budgetTokens }` (`.withThinking()`). Fixes `.withThinking({ effort })` losing its effort through `toConfig()`. A plain on/off still serializes as a boolean.
- `skills` (`.withSkills()`), `metaTools` (`.withMetaTools()`, `false` turns them off), `agentTools` (`.withAgentTool()` and `.withRemoteAgent()`), `dynamicSubAgents`, `verificationStep`, `documents` (`.withDocuments()`), `modelRouting` and `execution.llmTimeoutMs` (`.withLlmTimeout()`).
- `reasoning.synthesis`, `synthesisModel`, `synthesisProvider`, `synthesisTemperature`.
- `tools.terminal` accepts the shell's data options (`cwd`, `allowUnsafeCwd`, `timeoutMs`, `maxOutputChars`, `allowedCommands`, `additionalCommands`, `commandAccess`, `sandbox`). Before, an object `terminal` serialized as `true`.

Code-only parts stay code-only: a sub-agent's `parameters`, a shared document `store`, and the shell's `blockedPatterns`, `onAudit` and `dockerEscalation`.
