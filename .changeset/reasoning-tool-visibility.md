---
"@reactive-agents/reasoning": minor
---

Configured tools are no longer hidden on turn 1 by keyword relevance. When the permitted domain tool set has 15 or fewer tools (and no classifier or required-tools narrowing applies), every tool is visible from the first turn, so a task such as "what is bitcoin worth" can no longer hide a `crypto-price` tool and make the agent answer "I do not have that tool". Lazy disclosure through `discover-tools` now applies only above that budget, and `disclosure: "discover"` stays strict at any size. Tool-heavy agents with 15 or fewer tools send more schema tokens per turn than before; larger sets are unchanged. A call to a registered tool that was not shown still resolves and runs.
