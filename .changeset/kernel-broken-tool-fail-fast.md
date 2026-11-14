---
"@reactive-agents/reasoning": patch
---

A required tool that keeps failing now ends the run honestly instead of burning iterations to the stall guard. After 10 consecutive failures with no success, a new `broken-tool-exit` turn operation proposes an exit (`terminatedBy: required_tool_quota`, guard event reason `required_tool_unavailable`) and the exit gate names the tool in the result as unavailable instead of asking for a call that cannot land; a model draft ships as a labelled partial, otherwise the run fails with its gathered evidence attached. From 4 consecutive failures the recovery and loop guidance name the tool as unavailable and never tell the model to retry it, and when the run has already routed around it (for example `http-get` succeeded after `web-search` failed) the guidance says so. An exit left with only an unavailable tool outstanding is no longer denied for work that cannot land.
