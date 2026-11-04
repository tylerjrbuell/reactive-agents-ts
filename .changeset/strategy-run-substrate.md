---
"@reactive-agents/reasoning": minor
---

Strategies now run on one shared substrate (`runStrategy`): it owns a run's steps, token/cost/call accounting, the durable-pause terminal and the relay of a kernel pass's outcome (terminatedBy, abstention, honesty markers, ledger). `reactive`, `direct` and `tree-of-thought` use it first. Their results are now uniform: `direct` and `tree-of-thought` pick their answer by the same rule as `reactive` (a "let me try again" or unresolved tool-call thought is no longer shipped as the answer) and carry the same metadata (`extensions.signalTally`, `finalAnswerCapture`, `scratchpad`); `tree-of-thought` reports its input/output token split.
