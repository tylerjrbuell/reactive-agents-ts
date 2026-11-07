---
"@reactive-agents/cortex": patch
---

Chat sessions, desk runs and saved gateway agents now build agents from the same config.

- **Security:** a chat with tools turned off no longer gets `shell-execute` when its stored config has `terminalTools: true`. The host shell is a tool, so it follows the tools switch like workspace and shell options already did.
- Chat accepts every strategy name and alias the framework registers (read from the capability manifest), so `strategy: "rewoo"` no longer falls back to `reactive`. The run-chat tab lists the framework's strategies instead of a hard-coded five.
- A tools-off chat keeps a configured strategy and iteration cap; it used to drop both.
- Structured output's parse-fail mode (`.withOutputSchema(schema, { onParseFail })`) is now settable in the Lab builder and reaches chat sessions and gateway agents, not only desk runs. "Degrade" (the framework default) keeps the text answer and reports the parse error; "throw" fails the run.
- Editing a saved chat session whose config has an output schema, harness config or documents no longer breaks: the stored objects load back into the builder as JSON text.
