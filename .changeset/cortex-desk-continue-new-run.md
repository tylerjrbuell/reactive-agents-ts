---
"@reactive-agents/cortex": patch
---

Cortex desk Continue (the Runs page "Can continue" strip) and Resume of a crashed run now start a new run linked to the one that stopped (`resumeRun(runId, { newRun: true })`), like chat Continue. The new run gets its own run row, filed with the original launch settings and a "continued from" link, its events land on it, and its page opens when you press Continue. The stopped run keeps its own page and trace and is no longer offered beside its continuation; a crashed run's row is closed as stopped. Approving or denying a paused run still continues the same run.
