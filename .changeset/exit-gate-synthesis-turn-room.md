---
"@reactive-agents/reasoning": patch
---

A guard that stops a run late now still gives the model its one "write the final answer" turn. The exit gate counted one fewer remaining LLM call than the run loop allows, so a low-delta or stall stop on the second-to-last iteration (for example after a long open-ended "explore" gathering phase) skipped that turn and ended the run. The gate now uses the same bound as the loop. If the model answers on that turn, the run ends with the model's answer. If it does not, the handoff applies (see the answer-turn changeset), and no extra iterations are added.
