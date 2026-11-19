---
"@reactive-agents/reasoning": patch
---

Runs no longer finish with todo rows silently left open. The harness now keeps the model's own todo list in step with recorded evidence, with no prompt change:

- A successful tool call ticks the earliest open row whose tool hint names that tool (the `in_progress` row first). Hints match across separators, case and the provider's `functions.` prefix, so `functions.umami_list_websites` names `umami/list_websites`. Before, only seeded plans were auto-ticked, and only on an exact name.
- At the end of every strategy run, rows the ledger evidences are closed, and so are hint-less "compile / summarize / write the report" rows when the final answer was accepted. Each harness tick is a `checklist-item` status fact with `provenance` (`harness:evidence` or `harness:answer`) and the evidence call's `toolCallId`.
- Rows with no evidence stay open. They are listed as `unresolved` (reason `no evidence`) on `metadata.extensions.checklist`, along with `done`, `total` and `closedByHarness`, and traced as one `checklist-unresolved` guard event. Open rows do not change the run status: todo rows are advisory.
- Bookkeeping refund now also covers todo-only rounds on a list the model wrote itself, capped at 2 per pass and 4 per run. Seeded plans keep their half-budget cap.

`harness.autoTick: false` / `RA_AUTO_TICK=0` turns off the ticking. `harness.bookkeepingRefund: false` / `RA_BOOKKEEPING_REFUND=0` turns off the refund.
