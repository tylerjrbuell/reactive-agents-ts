---
"@reactive-agents/cortex": patch
---

Cortex UI polish. A run that hit its step limit while the model's last tool call was still waiting now reads "The run reached its step limit before the model's last tool call could run. Raise the step limit or Continue." in Why it ended, not "At fault: Harness: tool call dropped". Chat shows one card for a stop: when Continue is offered for a step-limit, loop or timeout stop, the generic "Run error" note is dropped, and so is the inline "Stopped by you" note when Continue is offered for your own Stop or Pause. The approval card shows a tool call's parameters once (summary rows, or the full text after Show full parameters, never both). The Beacon hero's idle sonar rings are a little stronger so they read on the dark background.
