---
"@reactive-agents/reasoning": patch
---

Tool calls the kernel refuses are no longer dropped silently. The think-phase tool gate keeps a call out of a turn when its `maxCallsPerTool` budget is used up, when required-tool steering runs only the calls toward a missing required tool, when a call is outside the relevant tools, when only one exploratory call may run, in single-step mode and in strict dependency mode. Each refused call now emits a `guard-fired` event (`guard: "tool-gate"`, `outcome: "block"`, metadata `{ toolName, toolCallId, kind }`). It also gets a harness-authored guard observation (never counted as tool evidence) and a `tool_result` in the conversation that says "<tool> was not run: <reason>", so the model sees the reason on its next turn. A turn whose every call is refused goes back to thinking with those answers instead of falling through to the termination oracle.
