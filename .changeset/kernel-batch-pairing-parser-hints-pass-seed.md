---
"@reactive-agents/reasoning": patch
---

Kernel fixes from the Plan 9 live H3 findings:

- Parallel batches no longer mix up tool results. A repeated read of `b.json` inside a parallel batch could be answered with `a.json`'s content. The duplicate guard paired each action with the step right after it, but a batch records `[actionA, actionB, observationA, observationB]`. Actions and observations now pair by tool-call id (`observationForAction`).
- Text-printed tool calls with a positional argument now bind. The kernel passes the text parser each tool's `requiredParams`, plus `riskLevel` when the schema has it. So `file-read /abs/a.txt` in a bash fence resolves to `file-read {path}` instead of ending at the unresolved-tool-call guard. A call embedded in code, such as `const x = fileRead("/abs/a.txt")`, binds the same way once the tool's schema carries a low `riskLevel`.
- New optional `KernelInput.seedRunContract` and `KernelInput.seedRunLedger` fields let a later kernel pass adopt the first pass's run contract and continue its run ledger. Leave both unset to keep the old behavior.
