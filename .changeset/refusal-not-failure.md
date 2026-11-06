---
"@reactive-agents/reasoning": patch
---

A tool call the harness did not run is no longer counted as a failed tool call. When a required tool was still missing, a refused call used to look like a tool failure. Several refusals in one turn could set off the repeated-failure redirect and end a correct run early. Failure counters now skip refusals: the reactive controller's tool-failure streak, the run assessment's failure health, the final-answer error check and the "a tool call failed" nudge. The model still sees each refusal as an error result.

Required-tool calls are also no longer deferred. If a required tool is still missing and the model calls it several times in one turn (for example six `file-write` calls), all of those calls now run that turn, in order. Calls that are not parallel-safe run one at a time. Before, only the first batch ran and the rest were refused until the next turn. Calls to other tools are still refused until the required tool has run. `maxCallsPerTool` still caps each tool.
