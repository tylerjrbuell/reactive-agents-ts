---
"@reactive-agents/trace": patch
---

`attributeFailure` (and `rax-diagnose attribute`) fix two over-blaming faults. A dropped call that repeats, with the same arguments (key order and resolved path ignored), a call that already failed twice is no longer `harness:tool-call-dropped`: running it would have failed again. A retry steer that names the tool whose own last call failed is no longer `harness:misleading-guidance`, even when the ledger counted the requirement as met. New reason `harness:contradictory-guidance`: the run's deciding `think` turn told the model to call a tool its request offered no schema for, the model tried, and the tool never ran. Such runs used to read `model:never-engaged`.
