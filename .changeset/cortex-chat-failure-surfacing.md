---
"@reactive-agents/cortex": patch
---

Cortex chat: a failed turn now shows the run's cause (for example the provider's "400 Your credit balance is too low") under the "did not finish" badge, live and after reload, and the run's failure toast carries the same line. Each run gets at most one end toast. A queued message is kept, not auto-sent, when the reply's run failed. Run toasts keep arriving after you visit the Trace page. Restore on a set-aside draft is a swap: the text it replaces gets its own Restore, so Edit then Restore loses nothing. Compaction accepts section headings that differ only in case, spacing, a trailing colon or a parenthetical, and the summariser prompt no longer puts guidance in the heading lines.
