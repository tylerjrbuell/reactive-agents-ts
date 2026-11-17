---
"@reactive-agents/cortex": minor
---

Cortex pauses, stops and continues any interrupted durable run, not only loop stops. Pause and Stop on a running desk run or chat turn call the framework's `pauseRun` / `stopRun` (the run ends at its next step with a saved place to continue from; the response says whether it was saved), and Continue (`resumeRun`) is offered for every resumable run: paused or stopped by you, loop guard, budget, timeout, error or crash. The continue card and the Runs strip show a chip from the stop's kind, what was done and what is left; the Runs list has a "Can continue" segment; a turn you stopped now offers Continue. Needs the existing Durable runs setting; nothing else to turn on.
