---
"@reactive-agents/runtime": patch
---

An aborted `runStream()` now publishes one `ExecutionCancelled` bus event with the run's `taskId`. Aborting through the signal, `handle.terminate()`, or by breaking out of the stream before the run ended used to publish no terminal event, so subscribers (dashboards, trace bridges) saw the run as live forever. A run that already ended (completed, failed or paused) publishes no extra event.
