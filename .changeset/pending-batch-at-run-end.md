---
"@reactive-agents/reasoning": patch
---

A run that ends between the model's think and the act phase no longer drops the model's tool calls without a record. One rule now handles every such ending, at the entry of the kernel terminal pipeline. If the iteration cap stopped the loop and the pending batch writes a declared deliverable the run still lacks, the batch runs once: one act, with no new think and no LLM call. The cap then judges the run with that write in evidence. Before this fix, recorded runs lost a final `out-6.txt` write this way and failed. In every other case the batch does not run. The run records a `pending-batch` intervention step, which reaches the receipt, and a `pending_batch` guard event that names the calls. This covers guard and controller exits (early stop, strategy-switch exhaustion, loop resolution) and a cap whose batch writes nothing outstanding. Durable approval and interaction pauses keep their batch for the resume.
