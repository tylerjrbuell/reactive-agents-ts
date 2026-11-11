---
"@reactive-agents/runtime": patch
---

`agent.stop()` now ends a run within about 100 ms, even inside a long reasoning loop or an in-flight model call. It used to be checked only between engine phases, and the whole reasoning loop is one phase, so `stop()` waited for the loop to finish. The run ends as before: `AgentStopping` and `AgentStopped` are published and `run()` rejects with `KillSwitchTriggeredError` (reason `stop() requested`).

`agent.terminate()` now publishes `AgentTerminated` for an in-flight `run()` before it resolves, exactly once. A caller that disposes the agent right after `await agent.terminate()` used to lose the event, because it was published only after the run's rejection settled, on a runtime that might already be disposed.
