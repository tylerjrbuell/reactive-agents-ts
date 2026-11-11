---
"@reactive-agents/reasoning": patch
---

A `find` result that was large enough to be compressed now reaches the model. Before, the model saw its own `find` call with no result, plus guidance saying "You have tool results above", and answered that it could not see the results. The cause: `find` stores its full result by replacing the run's scratchpad map, and the act phase then synced only the replaced map. The compressed result's stored key (`_tool_result_N`) was lost from the run state and from `recall`. The end-of-round sync now merges the kernel's writes with the tools' writes.

The thread now enforces tool-result pairing: every tool call in the model's thread is answered by its result. A stored key missing from the scratchpad projects the message's own preview instead of dropping the message. Any such recovery, or a tool call left unanswered, emits a `tool-result-pairing` guard event in the trace. The "You have tool results above" guidance renders only when the thread carries a tool result.
