---
"@reactive-agents/runtime": patch
---

W0.3 front-door truth: `build()` and `buildEffect()` now warn prominently when the provider silently defaults to `"test"` because the user never expressed provider intent. A bare `ReactiveAgents.create().build()` used to return canned output and report success without ever calling a model (silent fake green). The check lives in one private method invoked from `buildEffect()`'s Effect.gen; `build()` is covered transitively via its `Effect.runPromise(this.buildEffect())` delegation, keeping exactly-once-per-build on both terminals. Explicit arms stay silent: `.withProvider(...)` (including `"test"`), `.withTestScenario(...)`, and `.withReplayLLM(...)`; `quick()`/`fromConfig()` route through `.withProvider()` so they never fire. Signal only: no throw, no default change.
