---
"@reactive-agents/cortex": patch
---

Cortex: `/plan <task>` now sends the task unwrapped with run posture `plan` (the harness restricts the turn to planning) instead of a prompt wrapper. The chat routes accept an optional `posture` (`"execute"` or `"plan"`, other values return 400) and pass it to the session turn. New `/go` command proceeds with the plan; a "Planning mode" badge shows until the next execute turn.
