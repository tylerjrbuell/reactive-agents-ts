---
"@reactive-agents/reasoning": minor
"@reactive-agents/core": minor
"reactive-agents": minor
---

New experimental `"code-action"` reasoning strategy. Instead of issuing named tool calls, the LLM generates a TypeScript IIFE that runs in a Worker-thread sandbox and calls tools via postMessage round-trips.

**What shipped:**
- `"code-action"` added to `ReasoningStrategy` union in `@reactive-agents/core`
- Registered as 7th strategy in `strategy-registry.ts`
- `executeCodeAction` Effect function — plan → execute → observe → reflect loop
- `generateToolBindings(specs)` — converts `ToolSpec[]` to TypeScript function signatures injected into the LLM plan prompt
- Worker-thread sandbox — tool calls route back to the host via `postMessage`; results resolve as promises inside the generated code
- `shouldTerminate(verdict, iteration, maxIterations)` — reflection gate; iteration continues until code produces a passing verdict or max iterations reached
- `ToolService` is optional (`Effect.serviceOption`) — code-action works without tools for pure-computation tasks
- Uses `noopVerifier` by default; callers may inject a custom verifier via `CodeActionInput.verifier`

**Stability:** `@experimental`. Real-LLM benchmark vs reactive strategy deferred to v0.11.2.
