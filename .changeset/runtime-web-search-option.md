---
"@reactive-agents/runtime": minor
---

`.withTools({ webSearch: { apiKeys, providers } })` gives one agent its own web-search keys and provider order. `apiKeys` (tavily, brave, serper, keenable; plain strings or `Redacted`) win over environment variables and are never put in the process env, so shell and code-execute children cannot read them and concurrent agents do not share them. `providers` sets the order to try. It applies only when `web-search` is a permitted built-in. `toConfig()` and `fromConfig()` round-trip `providers` as `tools.webSearch`; `apiKeys` are runtime-only and never serialized.
