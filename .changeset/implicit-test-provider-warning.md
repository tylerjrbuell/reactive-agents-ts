---
"@reactive-agents/runtime": patch
---

W0.3 front-door truth: `build()` now warns prominently when the provider silently defaults to `"test"` because the user never expressed provider intent. A bare `ReactiveAgents.create().build()` used to return canned output and report success without ever calling a model (silent fake green). Explicit arms stay silent: `.withProvider(...)` (including `"test"`), `.withTestScenario(...)`, and `.withReplayLLM(...)`; `quick()`/`fromConfig()` route through `.withProvider()` so they never fire. Signal only — no throw, no default change.
