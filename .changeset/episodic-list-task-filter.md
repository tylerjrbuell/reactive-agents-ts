---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

`agent.memory().episodic.list({ taskId })` returns only the entries logged during that task, filtered in the store query before `limit`, newest first. Older entries of a task are no longer cut off by the default limit of 50.
