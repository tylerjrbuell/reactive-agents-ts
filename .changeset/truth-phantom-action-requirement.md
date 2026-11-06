---
"@reactive-agents/reasoning": patch
---

The run contract no longer adds phantom action requirements such as `[action:create-ticket] task requires a "create-ticket" action`. Detection now reads only the user's own message. Conversation history was already excluded; prior-context and recalled-memory blocks appended after the message are now cut too. The verb must also govern its object: imperative position, same clause, and a short plain-word gap. Before this, "files … issues" in recalled memory on a "get the price of xrp" turn, or "test file … bug" in a debug task, compiled a requirement the model could never satisfy. That requirement could also make a run abstain at iteration 0 with "missing capability". A request like "File a bug for the login crash" is still detected.
