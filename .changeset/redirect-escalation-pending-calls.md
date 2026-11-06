---
"@reactive-agents/reactive-intelligence": patch
"@reactive-agents/reasoning": patch
---

Reactive intelligence's tool-failure redirect no longer ends runs that have changed approach. Before this fix, every first fire was an early-stop: the handler counted its own log entry as a prior fire, so the redirect nudge never ran. That covered 30 of 30 fires in the recorded long-horizon and H3 traces. The first fire is now the nudge. The nudge no longer says the tool is "unavailable" or orders a final answer. It asks the model to stop retrying the failing call and change approach. A run is stopped only when the model's next batch still calls the failing tool. A batch that has switched tools (for example, file-writes after a failed file-read) now runs. The failure streak counts batches, not results, so two parallel failures in one batch count as one. The kernel passes the pending batch's tool names to the controller as `pendingToolNames`.
