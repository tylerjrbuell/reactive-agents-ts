---
"@reactive-agents/tools": patch
"@reactive-agents/runtime": patch
---

shell-execute now describes its real environment to the model. New `shellExecuteToolFor(config, { runWorkspace })` builds the tool definition from the resolved shell config: where commands run (the run's workspace directory, a configured cwd, a private temp directory under /tmp, or a throwaway Docker container), the allowed commands including opt-ins, the opt-in commands that are not enabled, Docker escalation for inline interpreter code, and the path confinement the handler enforces. Before, the description always said "sandboxed /tmp directory", even when the shell ran in a host workspace. `shellExecuteTool` remains as the default-mode definition.
