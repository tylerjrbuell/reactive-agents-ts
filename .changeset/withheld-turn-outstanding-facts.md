---
"@reactive-agents/reasoning": patch
---

When the kernel withholds tools for one think call (after repeated tool-call text that could not be executed), the outstanding-requirements block in that turn no longer tells the model to "call the `X` tool". It lists the unmet requirement ids under "Requirements not yet satisfied:" with no call directive and no phase steer, so it agrees with the plain-text instruction and the empty tool list.
