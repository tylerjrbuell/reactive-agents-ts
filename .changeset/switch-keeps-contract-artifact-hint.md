---
"@reactive-agents/reasoning": patch
---

A strategy switch no longer drops the run's contract. Before, when the loop detector switched strategy mid-run, the new strategy started without the compiled run contract, the delivery conditions, or the run budget meter. The exit gate and terminal then accepted a "done" even though named files were never written. For example, a run that wrote out-1.txt of six files was recorded as verified. The switched kernel now keeps these run-level facts, so a premature "done" is redirected with the missing files named, and is handed off as an honest partial once the repair budget is spent.

The local-tier quality check now names the missing file. When the run contract still owes a file and the model answers in chat instead, the hint is no longer the generic "Review your answer ... fix it now", which invited another rewrite. It now names the path and the writing tool (for example, "Your answer above is the content of ./analysis.md, but ./analysis.md is not written yet. Call file-write with path ./analysis.md and that content now."). Runs without a contract keep the adapter text.
