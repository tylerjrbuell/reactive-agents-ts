---
"@reactive-agents/runtime": patch
---

`agent.resumeRun()` now gives a run that stopped on its iteration cap more iterations, so Continue no longer re-stops at once. A resume of a spent cap (including a cap a plan raised at run start) runs to the restored iteration plus `extraIterations`, default 10, and the raised cap is stamped on the restored state. A run that stopped with iterations left keeps its own cap. The stop record of an iteration-cap stop keeps `kind: "budget"` and now carries the stable `reason: "max_iterations"`, so a UI can word it apart from a token or cost budget.
