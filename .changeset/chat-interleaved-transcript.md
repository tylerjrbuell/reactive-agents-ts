---
"@reactive-agents/ui-core": minor
"@reactive-agents/cortex": patch
---

New turn transcript projection in `@reactive-agents/ui-core`: `turnTranscriptOf(trace)`, `persistedTurnTranscriptOf(stored, answer)` and `buildTurnTranscript(steps, { answer, pending })` turn an agent turn into the order a modern agent chat reads in. The model's prose between iterations comes first as message text, then the tool work between prose collapses into one group (`Ran 4 tools · 1 failed`, or `Running <tool>` while a call runs) that carries its steps for drill-down, and the answer comes last. Provider thinking never becomes prose. Prose that repeats earlier prose or the answer is dropped. The projection is live-safe: while streaming, the in-flight text is a non-final answer.

Cortex chat renders assistant turns this way. Narration shows as normal text, and each tool group is a one-line row that expands to the step detail (calls, failure reasons, thinking). The answer closes the turn with its copy button. Goal checks and the turn summary move to a quiet footer. Reloaded turns read the same way. Older turns with no stored narration show one tool group and the answer.
