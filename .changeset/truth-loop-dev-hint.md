---
"@reactive-agents/reasoning": patch
---

Loop-detector messages for the repeated-thought and consecutive-thought patterns no longer include builder-config advice (`.withContextProfile(...)`, `.withReasoning(...)`, persona suggestions). These messages reach the model through the strategy-switch handoff, so they now say only what happened and what to do next. The developer advice moved to a new `LoopDetection.devHint` field. It is appended to the run's error when the loop ends the run.
