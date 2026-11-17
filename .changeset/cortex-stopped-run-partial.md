---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": patch
---

A run or chat turn you stop or pause now shows as a partial result with its answer so far, not as a failure. The framework ships a user stop as `success: false` with `stopped_by_request` outstanding; Cortex read that as a failed run (error banner, error toast, "Unfinished: stopped_by_request"). One classifier now covers it: `turnOutcomeOf` returns `{ ending: "partial", interruptedBy: "user", draft }` for a user stop, and the run status is `stopped`. Chat history keeps the answer with a "the user stopped this reply here" marker instead of a failure note.

New additive `@reactive-agents/ui-core` exports: `USER_STOP_CRITERION`, `isUserStopKind`, `isUserStopResult`, and the optional `stop` / `loopStop` fields on `RunCompletionLike`.
