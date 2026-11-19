---
"@reactive-agents/reasoning": patch
---

code-action no longer reports a run as a success when its code returned an error instead of an answer. When the value the code returns is only an `{ error }` object, or every tool call the code made failed, the strategy treats the result as a failed check. It retries while iterations remain and, at the cap, ends the run `failed` with the reason as its error. A tool output with `success: false` now throws into the generated code instead of resolving as a value. Tool results that are JSON text (how MCP tools return data) reach the code decoded, so code can read their fields. Before this change, an MCP result arrived as a string and code that read `result.websites` found nothing.
