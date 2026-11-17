---
"@reactive-agents/reasoning": patch
---

Plan-execute in detach approval mode no longer pauses for a planned tool step its tool will refuse anyway (for example a shell command outside the allowlist). The step fails with the tool's refusal so the plan can adapt, matching the kernel path.
