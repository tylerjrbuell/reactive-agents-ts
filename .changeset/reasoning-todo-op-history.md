---
"@reactive-agents/reasoning": patch
---

The kernel's `todo` handler now passes the run's checklist op history (this run's committed changes plus the changes staged earlier in the same turn) to `applyTodoChecklistAction`. New todo ids therefore come after the highest id ever issued in the run: after a `remove` or `clear`, an `add` never reuses a removed id, so the model cannot mistake a new item for the deleted one. Merged sub-agent changes are not part of the history, the same as for the list itself.
