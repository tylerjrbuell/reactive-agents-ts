---
"@reactive-agents/reasoning": minor
---

W3a Stage B: flag-gated text-parse think→acting transition. Behind the default-off three-state flag `REACTIVE_AGENTS_TEXT_PARSE` (`off`|`shadow`|`act`), models routed to the `TextParseDriver` (`supportsToolCalling === false`) now get a working dispatch path for the `<tool_call>` markup the driver already teaches. `shadow` parses and records a parse-diff diagnostic (`HarnessSignalInjectedEmitted`, origin `text-parse-shadow`) without acting; `act` transitions parsed calls into the SAME acting pipeline native-fc uses — guard chain, tool-policy choke point, HealingPipeline, ledger seam (existing kinds only) — and markup that fails to parse loops back with a deterministic observation-shaped message instead of silently burning maxIterations. Flag `off` (the default) and every native-fc path are byte-unchanged.
