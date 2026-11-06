---
"@reactive-agents/reasoning": patch
---

Every final answer the model gives now passes the exit gate. Two paths used to skip it: the `final-answer` tool and the termination oracle's exit on the model's text. While a required tool or delivery condition is still unmet, the gate now denies both. A denied `final-answer` call gets the outstanding list as its tool result, not "accepted". A denied model answer is recorded as `gateDecision: "deny"`, a new value that can repeat. A guard's single per-run nudge stays `deny-once`. A controller early-stop that reaches the oracle is the harness's decision, not the model's. It is gated like the runner's dispatcher early-stop: it is denied once, then the run ends as a handoff.

The context-overflow retry now compacts the thread to 0.7x the prompt size the provider reported. It falls back to the projected window when the provider gives no size. The retry happens at most once per run, not once per think call, and a sub-agent gets its own. A successful recovery is recorded as the `context-overflow-recovered` trace fact.
