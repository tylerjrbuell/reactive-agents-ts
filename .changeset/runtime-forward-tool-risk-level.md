---
"@reactive-agents/runtime": patch
---

Forward each tool's `riskLevel` to the reasoning kernel. The engine now projects registered tool definitions through one helper (`toKernelToolSchema`) that carries `riskLevel` when defined, so the kernel's text tool-call parser can bind embedded low-risk calls in live runs.
