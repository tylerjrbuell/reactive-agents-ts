---
"@reactive-agents/reasoning": patch
---

A strategy run no longer ships an old draft over tool results it fetched and never read. When the answering kernel pass ends with tool results no think read (for example the batch a pass runs at its iteration cap), and the output to ship was written before those results, the shared strategy terminal makes one synthesis call. The call covers the task, the pass's tool results and the draft. Before this, a reflexion improve pass ran 4 market-trend searches and the run still answered "The EV market is large.". The call is bounded. It runs only when new, non-error, non-meta results exist and the shipped answer predates them. It does not run for an answer the model wrote in the same turn as its calls or through `final-answer`, for results identical to ones already read, or for a pass that ended on a provider error. When the run's token or cost budget is spent, the call is skipped and the skip is recorded. Every use is recorded as a `harness_signal` step (actor `unread-results-synthesis`), as `metadata.unreadResultsSynthesis` and as one more `llmCalls`.

Separately, harness meta tools such as `discover-tools` are never nominated as required tools. A research task used to nominate `discover-tools` because its description says "search web", so the repetition guard told runs with no required tools "You still need to call: discover-tools".
