---
"@reactive-agents/reasoning": patch
---

Give-up honesty: a run may no longer report `success: true` when its answer is a give-up / incapability statement ("the tools do not include X, so I cannot complete this") and nothing was grounded. Such runs now terminate as an honest `abstained` (the model's own explanation is kept as `output`, `result.abstention` carries the reason). Fixes the hole where `resolveCompletionStatus` mapped a harness give-up (`loop_graceful` / exhaustion) to `completed`, and the terminal verifier's give-up check (which requires unused tools) never fired for zero-tool runs.
