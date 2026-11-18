---
"@reactive-agents/reasoning": patch
---

An honest decline no longer ends as a failure. When a guard (for example the dispatcher early-stop) stops a run whose required tool errored on every call, and the model's latest text says it cannot answer because the input is missing (and carries no figure of its own), the run now ends `abstained` with the model's text as its output. Before, it ended `failure` with "stopped before the model wrote a final answer" even though the model had written the true answer. A tool that has not failed, or a partial answer, keeps the existing outcome.
