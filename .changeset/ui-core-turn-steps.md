---
"@reactive-agents/ui-core": minor
"@reactive-agents/cortex": patch
---

ui-core: action-first turn steps. `turnStepsOf` / `buildTurnSteps` / `persistedTurnStepsOf` turn a run into steps titled by the tools called (retries grouped as `get_website_metrics ×4 · 3 failed → ok`), with narration and provider thinking kept apart, repeated narration collapsed to "same as step N", and each failure's reason linked to the call that fixed it. `summarizeTurn` gives a one-line rollup with the context window in use. The turn fold now files thoughts under its own iteration cursor: the runtime's `ThoughtEmitted.iteration` is a step index, which rendered phantom steps repeating earlier ones. Persisted traces add `narration` / `thinking` per iteration and `context`.

Cortex: the chat step list renders the new view with a summary line. A failed turn stays visible as failed with the kernel's cause, but is sent to the model as a failure marker instead of an answer and is never used to title the chat. Cortex no longer forces `num_ctx` 8192 on local models; the framework sizes it per model. The shell command groups now come from `@reactive-agents/tools` `COMMAND_CAPABILITY_MAP`.
