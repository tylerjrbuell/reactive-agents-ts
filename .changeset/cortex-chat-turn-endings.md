---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": minor
"@reactive-agents/svelte": patch
"@reactive-agents/react": patch
"@reactive-agents/vue": patch
---

Cortex chat no longer loses or hides how a turn ended.

- A turn that fails before the model answers (a model that is not pulled, a provider without a key, a refused request) keeps your message and ends as a failed turn with the cause and Retry. The cause no longer starts with an error class tag such as `LLMError:`.
- Stop ends the run on the server and the turn reads "stopped". Leaving the page mid-reply stops the run and the turn reads "interrupted" with that cause when you come back. Partial text and spend are kept, and Retry is offered.
- Stopped, left and orphaned chat runs no longer stay live in Trace: they end as `stopped`, desk Stop included, and chat runs a restart left open are closed at startup.
- Before the model's first token the turn reads "Waiting for the model · 12s" ("Waiting for Ollama (loading the model or queued)" on Ollama) instead of "Thinking".

ui-core adds what a builder's chat UI needs for the same states: `turnOutcomeOf` classifies an interrupted turn (`interrupted` input, `TurnEnding` `"interrupted"`, `interruptedBy`, `interruptionCause`), `causeLineOf` drops error class tags, `foldModelWait` / `initialModelWait` / `modelWaitLabel` and `RunState.modelWait` (with `ReduceOptions.now`) track the wait on the model, `statusOfTurn` / `statusOfRun` / `statusOfSubAgent` map every surface onto one `StatusTone` vocabulary, and `formatCost` / `formatTokens` / `formatRelativeTime` / `formatClockTime` are shared formatters. The Svelte, React and Vue bindings re-export the formatters and status helpers.
