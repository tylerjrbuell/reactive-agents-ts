---
"@reactive-agents/reasoning": patch
---

When one round of tool calls holds a write and the read of the input it is paired with (notes-N.txt to out-N.txt, by the task's numbered families), the write is refused with a read-first hint instead of running with content the model wrote before it had seen the value. The read runs; the model resubmits the write next turn. Rounds with no such pairing are unchanged.
