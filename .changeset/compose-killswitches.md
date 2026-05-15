---
"@reactive-agents/compose": minor
"@reactive-agents/runtime": minor
"@reactive-agents/core": minor
---

Initial release of `@reactive-agents/compose`. Harness composition API with six production-ready killswitches and a builder `.compose()` alias.

**Killswitches** (`@reactive-agents/compose`):
- `maxIterations(n)` — stop/terminate after N kernel iterations
- `budgetLimit({ maxTokens?, maxCostUSD? })` — stop/terminate when token or cost budget exceeded
- `timeoutAfter(duration)` — stop/terminate after wall-clock time (`"60s"`, `"5m"`, or milliseconds)
- `watchdog({ timeout })` — stop/terminate when no tool-result progress for a given duration; resets on each tool call
- `requireApprovalFor(toolName, approver)` — gate specific tool calls with a synchronous approver function; deny returns `{ abort: "stop" }`
- `confidenceFloor(threshold)` — early exit when verifier confidence meets or exceeds threshold

All killswitches are pure `(harness: Harness) => void` factories. They wire into phase hooks (`before`/`after`/`tap`) — no new TagMap entries needed.

**Builder API** (`@reactive-agents/runtime`):
- `.compose(fn)` — alias for `.withHarness(fn)`; attaches a harness transform to the build pipeline
- `.withSystemPrompt(prompt)` — now desugars through `h.on("prompt.system", ...)` in addition to setting the internal field
- `.withErrorHandler(fn)` — now desugars through `h.onError("*", ...)` in addition to the internal field
- `.withHook(phase, fn)` — now registers as a harness phase hook alongside the Effect-based hooks array

**Core** (`@reactive-agents/core`):
- `HarnessPipeline.collectPhaseHooks()` — phase hook registry now wired into kernel execution at bootstrap, think, act, and complete phases
