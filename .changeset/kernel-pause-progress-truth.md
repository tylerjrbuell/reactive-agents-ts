---
"@reactive-agents/reasoning": patch
---

Observer events now tell the truth about paused runs and iteration progress. A run paused for human approval or input no longer publishes `FinalAnswerProduced` with the pause notice as its "answer"; the pause is still reported through `awaitingApprovalFor` / `awaitingInteractionFor` and the stream's `RunPaused`. `ReasoningIterationProgress` now fires once per kernel iteration, 1-based, as documented. Before, a tool turn (think pass, then act pass) reported each iteration twice, the first time at the previous number (starting at 0). `LLMRequestStarted.provider` now names the real provider for string-model requests (it read `"unknown"`), using the same resolution as the completed event.
