---
"@reactive-agents/runtime": patch
---

`.withModel(model, { numCtx })` now applies only to the agent that declared it. The builder used to write the window into a process-wide capability registry, so in a long-lived process every later agent on the same model id inherited the first agent's window (context budget and ContextPressure events), and the first declared value won for good. The window is now passed per agent to the context profile, build validation, the LLM observability wrapper and the structured-output calibration check, and no registry row is written.
