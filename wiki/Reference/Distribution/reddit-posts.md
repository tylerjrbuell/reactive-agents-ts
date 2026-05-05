# Reddit Posts (Drafts)

Post one at a time, spaced at least a week apart.

---

## r/typescript — Architecture angle

**Title:** I built a TypeScript AI agent framework using Effect-TS as the composition layer

**Body:**
After 6 months of building, I've open-sourced Reactive Agents — a framework where
every capability (memory, guardrails, cost tracking, streaming) is an independent
Effect-TS layer you compose only when needed.

The architecture: `agent.run()` for simple usage, `agent.runEffect()` for full
Effect-TS access. Users who don't know Effect can ignore it entirely.

What I found interesting about using Effect here: ManagedRuntime lets all methods
share the same service instances (EventBus, KillSwitch), which plain `runPromise`
calls can't do. FiberRef enables fiber-local text delta propagation for streaming
without global state.

24 runnable examples, all work without an API key.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts

---

## r/LocalLLaMA — Local model angle

**Title:** TypeScript AI agent framework with first-class Ollama support and context profiles

**Body:**
Built Reactive Agents with local models as a first-class use case. Key features
for local inference:

- Model-adaptive context profiles (local/mid/large/frontier tiers) that tune
  prompt density, compaction strategy, and tool result truncation per model capability
- Ollama provider works out of the box — no API key, just `withProvider("ollama")`
- Context budget system prevents small models from hitting context limits mid-run
- Works well with qwen3:14b, cogito:14b, llama3.1:8b

Example with local model:
```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:14b")
  .withContextProfile({ tier: "local", toolResultMaxChars: 800 })
  .withReasoning({ defaultStrategy: "reactive" })
  .build();
```

Repo: https://github.com/tylerjrbuell/reactive-agents-ts

---

## r/MachineLearning — Framework architecture angle

**Title:** [Project] Reactive Agents: TypeScript agent framework with swappable reasoning kernels and Effect-TS type safety

**Body:**
Open-sourcing Reactive Agents — a TypeScript agent framework with a few
architectural decisions I haven't seen elsewhere in the TS ecosystem:

1. **Composable Kernel SDK**: reasoning algorithms are swappable. The
   `ThoughtKernel` abstraction lets you register custom reasoning algorithms
   that integrate with all existing tooling (observability, guardrails, cost).

2. **FiberRef-based streaming**: TextDelta events propagate through the
   react-kernel via Effect FiberRef, avoiding global state for concurrent streams.

3. **Structured plan engine**: Plan-Execute strategy uses JSON plans with
   SQLite persistence, hybrid step dispatch, and graduated retry → patch → replan.

1,381 tests, 19 packages, CI green.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts
