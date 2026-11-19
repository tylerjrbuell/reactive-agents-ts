---
"@reactive-agents/reasoning": patch
---

The duplicate-call refusal now leads with the write owed: when a listed input is already read but its paired numbered output (notes-N to out-N) is unwritten, the refusal tells the model to write that output from the value just read instead of steering to another read.
