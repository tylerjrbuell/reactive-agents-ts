---
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Skill persistence and `RunHandle` streaming control.

**Skill persistence** (`@reactive-agents/reasoning`):
- Learned `SkillRecord` objects are now dual-stored: in-memory session store AND `SkillStore` (SQLite-backed)
- `skillFragmentToSkillRecord(fragment)` — converter exported from `reactive-agents` umbrella
- Skills resolved across sessions via the persisted store; resolver finds previously learned skills on cold start

**RunHandle** (`@reactive-agents/runtime`):
- `agent.runStream(task)` now returns `RunHandle` — an `AsyncGenerator<AgentStreamEvent>` with attached control methods
- `handle.pause()` / `handle.resume()` — suspends/resumes the kernel loop at the next checkpoint
- `handle.stop()` — graceful stop: kernel finishes current iteration, runs synthesis, emits `StreamCompleted`
- `handle.terminate()` — immediate abort via existing `AbortController` path; emits `StreamCancelled`
- `handle.status` — current `RunStatus` (`"running"` | `"paused"` | `"stopped"` | `"terminated"` | `"completed"`)
- Fully backward compatible: `runStream()` callers that ignore the extra methods continue to work unchanged

**Exports** (`@reactive-agents/runtime`): `RunHandle`, `RunStatus`, `RunController`, `RunControllerLike`
