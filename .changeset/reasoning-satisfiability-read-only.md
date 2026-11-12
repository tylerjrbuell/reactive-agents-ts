---
"@reactive-agents/reasoning": patch
---

The iteration-0 satisfiability preflight now abstains an action-required task (for example "send X to Y") when every visible domain tool is flagged `mutatesExternalState: false`. Before, a read-only search tool whose words matched the task kept the run going, and it spent iterations web-searching for how to send a message. Tools with an unknown flag behave as before. `ToolSchema` gains an optional `mutatesExternalState` field.
