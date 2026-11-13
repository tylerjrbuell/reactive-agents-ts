---
"@reactive-agents/cortex": patch
---

Fix channel-hub turns failing with `turn_failed` after a saved agent was edited: an open conversation kept its session on the disposed agent until Cortex restarted. Each turn now uses the current built agent. A failed hub turn or agent build also logs and shows its real cause (sanitized: message only, no URL queries or tokens) in the activity feed and the simulate result.
