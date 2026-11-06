---
"@reactive-agents/reasoning": patch
---

plan-execute: a composite step now passes the tool results it observed to the steps that depend on it. Before, a dependent step got only the composite step's closing text. When plan repair ran a read step without its path as a composite step, the file content never reached the next step, so the model wrote the deliverable from a guess. A step planned as one tool call now hands on the tool's payload, just like a direct tool step. Other composite steps hand on their text followed by the tool results.
