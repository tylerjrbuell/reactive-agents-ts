---
"@reactive-agents/reasoning": patch
---

The duplicate-call refusal now names the first listed input the model has not read yet ("Read notes-5.txt first"), not only the unwritten outputs. On tasks that list several source files, a model that repeated a read used to be told to "do the next item" and wrote outputs from sources it never opened. With every listed input read, the refusal text is unchanged.
