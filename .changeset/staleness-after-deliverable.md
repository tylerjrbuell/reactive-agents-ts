---
"@reactive-agents/reasoning": patch
---

The loop detector no longer stops a run right after it writes its deliverables. The "no new evidence for N turns" check read progress measured before the turn's tool calls, so a turn that wrote every required file still counted as stale, and the run ended as a failure even when the model's next answer was correct. The check now re-reads progress after the tool calls; it can only lower the stale count, never raise it.
