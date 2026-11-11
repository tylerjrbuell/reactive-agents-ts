---
"@reactive-agents/cortex": patch
---

Cortex run view and run compare fixes from live QA:

- A run whose answer an output guardrail withheld no longer shows that text as the run's Answer (or seeds "Continue in chat" with it); the failure banner explains the block.
- Compare marks a loop only one run reached as a difference ("did not reach this loop") instead of "Same on both".
- Compare deltas read "same" when the two values look the same (0s vs 0s), and the config line reads "1 setting differs".
- Runs without a name show 12 characters of their id (as the run header does), so runs started in the same second are told apart in Runs and the Compare picker; the picker also shows each run's strategy.
- Durable-run agents get the user-question rail through the AgentConfig (`userInteraction`) instead of a Cortex-only builder call, so Export shows `.withUserInteraction()` in the code.
