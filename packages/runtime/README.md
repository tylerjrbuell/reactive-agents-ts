# @reactive-agents/runtime

> Version: **0.10.3** — execution runtime for [Reactive Agents](https://docs.reactiveagents.dev/).

The runtime package contains the 12-phase `ExecutionEngine`, the `ReactiveAgentBuilder` fluent API,
`createRuntime()` for low-level Effect-TS layer composition, and the agent-level orchestration
surfaces (streaming, debrief, sessions, channels, gateway).

## Installation

```bash
bun add @reactive-agents/runtime
```

Or install the umbrella package (recommended for new projects — pulls in core, reasoning,
llm-provider, tools, memory, gateway, and channels in one shot):

```bash
bun add reactive-agents
```

## What this package provides

- **`ReactiveAgentBuilder`** — chainable builder for assembling agents from optional capabilities
  (provider, model, memory, reasoning, tools, gateway, channels, observability, …).
- **`ExecutionEngine`** — the 12-phase reactive lifecycle that every task flows through; emits
  hooks at every phase boundary.
- **`createRuntime()` / `createLightRuntime()`** — Effect-TS layer factories for embedding the
  runtime inside larger Effect programs.
- **`AgentSession` / `directChat()`** — stateless and stateful chat surfaces backed by
  `SessionStore` (used by gateway chat mode).
- **`AgentStream`** — streaming event API (deltas, tool calls, phase transitions).
- **`synthesizeDebrief()`** — post-run summary with cost, tools, entropy, verdict.
- **`ingestDocuments()`** — RAG ingestion helper for `.withDocuments()`.

## Quick example

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withMemory("1")
  .withReasoning()
  .withGuardrails()
  .withCostTracking()
  .build();

const result = await agent.run("Explain the CAP theorem");
console.log(result.output);
console.log(result.metadata); // { duration, cost, tokensUsed, stepsCount, ... }
```

### Effect API

```typescript
import { Effect } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";

const program = Effect.gen(function* () {
  const agent = yield* ReactiveAgents.create()
    .withName("my-agent")
    .withProvider("anthropic")
    .withModel("claude-haiku-4-5-20251001")
    .buildEffect();

  return yield* agent.runEffect("What is the meaning of life?");
});

const result = await Effect.runPromise(program);
```

### Low-level `createRuntime()`

```typescript
import { createRuntime } from "@reactive-agents/runtime";

const runtime = createRuntime({
  agentId: "my-agent",
  provider: "anthropic",
  enableReasoning: true,
  enableGuardrails: true,
  enableCostTracking: true,
});
```

## The 12-Phase Execution Engine

Every task flows through the following phases. Each phase supports `before`, `after`, and
`on-error` lifecycle hooks via `.withHook()`.

| # | Phase | Purpose |
|---|---|---|
| 1 | `bootstrap` | Initialize execution context, load memories, prepare state |
| 2 | `guardrail` | Detect injection, PII, policy violations on input |
| 3 | `cost-route` | Estimate task complexity and route to a cost-appropriate model |
| 4 | `strategy-select` | Choose reasoning strategy (ReAct, Reflexion, Plan-Execute, ToT, Adaptive) |
| 5 | `think` | Multi-step reasoning loop (LLM completions inside the kernel) |
| 6 | `act` | Execute tool calls produced by `think` |
| 7 | `observe` | Process tool results, update kernel context |
| 8 | `verify` | Semantic verification, evidence grounding, retry-or-pass arbitration |
| 9 | `memory-flush` | Persist new memories (episodic, procedural, experiences) |
| 10 | `cost-track` | Record token usage and cost metrics |
| 11 | `audit` | Emit compliance/observability events |
| 12 | `complete` | Finalize, assemble output, return result |

The reasoning kernel that powers `think` / `act` / `observe` / `verify` lives in
`@reactive-agents/reasoning` under `kernel/capabilities/` (act, attend, comprehend, decide, reason,
reflect, sense, verify), `kernel/loop/`, and `kernel/state/`. See
[reasoning README](../reasoning/README.md).

## Builder methods

The full set of `.with*()` methods on `ReactiveAgentBuilder`:

| Method | Purpose |
|---|---|
| `.withName(name)` | Human-readable agent name |
| `.withAgentId(id)` | Stable id for memory + telemetry |
| `.withPersona(persona)` | Persona/system prompt scaffolding |
| `.withSystemPrompt(prompt)` | Raw system prompt override |
| `.withProvider(name)` | `"anthropic" \| "openai" \| "gemini" \| "ollama" \| "litellm" \| "test"` |
| `.withModel(modelOrParams)` | Model id string or `{ model, temperature, thinking, ... }` |
| `.withReasoning(opts?)` | Enable strategies (defaults to ReAct) |
| `.withTools(opts?)` | Register tools (built-ins + custom) |
| `.withTerminalTools(cfg?)` | Add `shell-execute` (opt-in, allowlist-gated) |
| `.withDynamicSubAgents(opts?)` | Add `spawn-agent` for runtime sub-agent dispatch |
| `.withAgentTool(...)` / `.withRemoteAgent(...)` | Wrap another agent as a callable tool |
| `.withMemory(tier)` | `"1"` (FTS5) or `"2"` (vec) memory |
| `.withDocuments(docs)` | RAG ingestion at build time |
| `.withGuardrails(opts?)` | Input/output safety detectors |
| `.withVerification(opts?)` | Verifier strategies (semantic, evidence, …) |
| `.withCostTracking(opts?)` | Budget enforcement + cost metadata |
| `.withModelPricing(...)` / `.withDynamicPricing(...)` | Custom pricing tables |
| `.withCircuitBreaker(...)` / `.withRateLimiting(...)` | Provider-level protection |
| `.withFallbacks({...})` | Fallback chain across providers/models |
| `.withGateway(opts?)` | Persistent harness (heartbeats, crons, webhooks) |
| `.withChannels({adapters,triggers?,defaultAgent?})` | Bot/webhook channel adapters |
| `.withA2A(opts?)` | Agent-to-Agent protocol server |
| `.withObservability(opts?)` | Verbose live event stream |
| `.withTracing({dir?})` / `.withTelemetry(cfg?)` / `.withLogging({...})` | Observability outputs |
| `.withCalibration(mode)` | Calibration store mode (off / read / write) |
| `.withReactiveIntelligence(...)` | RI dispatcher (strategy switching) |
| `.withSkills({...})` / `.withMetaTools(cfg)` | Skill system + meta-tools |
| `.withMaxIterations(n)` | Cap kernel loop iterations |
| `.withCustomTermination(fn)` | Custom termination predicate |
| `.withHook(hook)` | Lifecycle hook (`phase × timing` → fn) |
| `.withLayers(layer)` | Inject extra Effect layers |
| `.withIdentity()` | Identity service |
| `.withInteraction()` | Human-in-the-loop interaction service |
| `.withPrompts(opts?)` | Prompt manager |
| `.withCortex(url?)` | Cortex telemetry endpoint |
| `.withStreaming({density?})` | Stream events back to caller |

Build with `.build()` (Promise) or `.buildEffect()` (Effect).

## Gateway chat mode

When you combine `.withGateway()` and `.withChannels()`, incoming messages are routed through the
gateway's chat mode by default. Each `(platform, senderId)` pair gets a persistent SQLite-backed
session with:

- 40-turn / 8 KiB sliding window
- Episodic memory injection from previous sessions
- Daily compaction (consolidates older turns into a summary)
- TTL-based pruning (`accessControl.sessionTtlDays`, default 30 days)

```typescript
const agent = await ReactiveAgents.create()
  .withName("ops-bot")
  .withProvider("anthropic")
  .withMemory("1")
  .withGateway({
    accessControl: {
      mode: "chat",                 // 'chat' (default) or 'task'
      accessPolicy: "allowlist",
      allowedSenders: ["U_TYLER"],
    },
  })
  .withChannels({ adapters: [discordAdapter] })
  .build();

await agent.start();   // gateway loop + adapters come up here
```

Switch to `mode: "task"` if you want each inbound message to spawn a fresh one-shot run.

## Streaming

```typescript
const stream = agent.runStream("Summarize the news");
for await (const ev of stream) {
  if (ev.type === "delta") process.stdout.write(ev.text);
  if (ev.type === "tool-call") console.log("→", ev.name, ev.args);
}
```

`StreamDensity` controls verbosity: `"compact" | "standard" | "verbose"`.

## Common patterns

**Sub-agent composition:**

```typescript
import { agentFn, pipe, parallel } from "@reactive-agents/runtime";

const research = agentFn(researchAgent);
const summarize = agentFn(summarizerAgent);
const workflow = pipe(research, summarize);
const out = await workflow.run("Latest LLM evals?");
```

**Persistent chat session:**

```typescript
import { AgentSession } from "@reactive-agents/runtime";
const session = new AgentSession(agent, { sessionId: "user-42" });
await session.send("Hi");
await session.send("Remember my favorite color is blue.");
```

**Post-run debrief:**

```typescript
import { synthesizeDebrief, formatDebriefMarkdown } from "@reactive-agents/runtime";
const debrief = synthesizeDebrief({ result, steps: result.metadata.steps });
console.log(formatDebriefMarkdown(debrief));
```

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Builder reference: [docs.reactiveagents.dev/api/builder/](https://docs.reactiveagents.dev/api/builder/)
- Lifecycle hooks: [docs.reactiveagents.dev/guides/hooks/](https://docs.reactiveagents.dev/guides/hooks/)
- Related: [`@reactive-agents/reasoning`](../reasoning/README.md),
  [`@reactive-agents/llm-provider`](../llm-provider/README.md),
  [`@reactive-agents/tools`](../tools/README.md),
  [`@reactive-agents/memory`](../memory/README.md),
  [`@reactive-agents/gateway`](../gateway/README.md),
  [`@reactive-agents/channels`](../channels/README.md).

## License

MIT
