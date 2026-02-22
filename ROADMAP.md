# Reactive Agents — Roadmap

> **Grounded in market validation, February 2026.**
> Ordered by competitive impact and developer value. Items within each milestone are sequenced by dependency and urgency.

---

## Strategic Context

The agent framework landscape has clarified significantly. TypeScript-first frameworks (Vercel AI SDK, Mastra, Google ADK, AWS Strands) are mainstream. **Seven capabilities remain uniquely ours** — no competitor has implemented them:

1. Multi-strategy reasoning with AI selection
2. 5-layer hallucination verification
3. Cost-first architecture (semantic caching, complexity routing, prompt compression)
4. Zettelkasten knowledge graphs in memory
5. Cryptographic agent identity (Ed25519 certificates)
6. Versioned prompt engineering with A/B testing
7. Cross-task self-improvement (learned strategy preferences)

The roadmap below is about two things: **closing the gaps** that currently block production adoption, and **doubling down on what makes us irreplaceable**.

---

## Current State — v0.3.0 ✅ Released

**15 packages, 340 tests, fully composable via Effect-TS. All services wired through execution engine.**

What's shipping in v0.3.0:

- ✅ 10-phase execution engine **fully wired** — all phases call their respective services
- ✅ **5 reasoning strategies**: ReAct, Reflexion, Plan-Execute-Reflect, Tree-of-Thought, **Adaptive meta-selector**
- ✅ **Tools integrated into reasoning** — ToolService provided to strategies, real tool execution during ReAct loop
- ✅ **OpenAI function calling** — tools sent in request body, tool_calls extracted from responses
- ✅ **Token tracking** — accumulated across LLM calls, reported in TaskResult metadata
- ✅ **Observability spans** on every execution phase
- ✅ **Guardrail phase** calls GuardrailService.check(), blocks unsafe input with GuardrailViolationError
- ✅ **Verify phase** calls VerificationService.verify(), stores score and risk level
- ✅ **Cost routing** calls CostService.routeToModel() for complexity-based model selection
- ✅ **Cost tracking** calls CostService.recordCost() with accumulated data
- ✅ **Audit phase** logs task summary via ObservabilityService
- ✅ **Context window management** — messages truncated before each LLM call
- ✅ **Memory integration** — tool results logged as episodic memories, flush() called in memory phase
- ✅ Working/Semantic/Episodic/Procedural memory (bun:sqlite, FTS5)
- ✅ Guardrails (injection, PII, toxicity)
- ✅ Semantic entropy + fact decomposition verification
- ✅ Cost routing (Haiku/Sonnet/Opus) + budget enforcement
- ✅ Agent identity + RBAC
- ✅ 5 interaction modes with dynamic escalation
- ✅ Multi-agent orchestration (sequential, parallel, pipeline, map-reduce, orchestrator-workers)
- ✅ Prompt template engine + versioning
- ✅ `rax` CLI (init, create, run, eval, inspect)
- ✅ Compiled ESM + DTS output — works in Node.js, Bun, and edge runtimes
- ✅ **4 LLM providers**: Anthropic, OpenAI, Gemini, Ollama (all with tool calling where supported)
- ✅ **28-page documentation site** with features, cookbook, and API reference
- ✅ **Eval framework** — LLM-as-judge scoring, regression detection, CLI integration

What's scaffolded but not production-complete:

- ⚠️ MCP client (stdio implemented; SSE and WebSocket transports are stubs)
- ⚠️ Self-improvement learning loop (spec'd, not wired)
- ⚠️ Streaming service (spec'd, not wired into engine)

---

## v0.4.0 — A2A Protocol & Agent Interoperability

**Target: 60 days**

**A2A is the single most important gap.** Google ADK and AWS Strands both ship native A2A support. It is the emerging Linux Foundation standard (21.9K stars, v0.3.0, 139 contributors) for agent-to-agent communication. Without it, our agents are isolated silos.

> **MCP = agent ↔ tools. A2A = agent ↔ agent.**

### A2A Server — Expose Agents as Endpoints

Any `ReactiveAgent` should be exposable as an A2A-compatible endpoint.

```typescript
import { A2AServer } from "@reactive-agents/orchestration";

const server = A2AServer.from(agent, {
  port: 3000,
  agentCard: {
    name: "research-assistant",
    description: "Researches topics and summarizes findings",
    capabilities: ["web-search", "document-analysis"],
  },
});
await server.start();
```

- JSON-RPC 2.0 over HTTP/S transport
- SSE for streaming responses and async push notifications
- Agent Cards: machine-readable capability discovery (JSON-LD)
- Authentication: bearer tokens, API keys
- Preserves agent opacity — internal state never exposed

### A2A Client — Consume External Agents

External A2A agents become first-class participants in our orchestration workflows.

```typescript
import { A2AClient } from "@reactive-agents/orchestration";

const externalAgent = await A2AClient.connect("https://agent.example.com");
const result = await externalAgent.sendTask("Analyze this dataset");
```

- Discover capabilities via Agent Cards
- Support sync, streaming, and async task modes
- Rich data exchange: text, files, structured JSON
- Works as a tool within our reasoning loop

### Agent-as-Tool Pattern

Any agent can be registered as a tool callable by other agents — enabling recursive, hierarchical agent architectures.

```typescript
const researchAgent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()
  .build();

const orchestratorAgent = await ReactiveAgents.create()
  .withName("orchestrator")
  .withProvider("anthropic")
  .withTools([researchAgent.asTool()]) // ← agent as tool
  .build();
```

- Typed input/output schemas between agents
- Timeout and budget propagation from parent to child
- Works with both local and A2A remote agents

### Streaming Service — Real-Time Agent Events

First-class streaming so UIs and dashboards can observe agent execution live.

- `StreamingService` with per-agent event queues (Effect `Queue` + `Stream`)
- Structured event types: `thinking`, `action`, `action-result`, `verification`, `output-chunk`, `state-change`, `checkpoint`, `cost-update`
- SSE endpoint when combined with A2A server
- `.withStreaming()` builder method + `onEvent` callback

### MCP Full Implementation

- Complete SSE (HTTP event stream) and WebSocket transports
- Auto-convert MCP tool schemas to typed `defineTool()` format
- Test with real MCP servers (Filesystem, GitHub, Brave Search)

---

## v0.5.0 — The Intelligence Advantage

**Target: 90 days**

This milestone makes our unique differentiators fully production-ready. These are the features no other framework has — the moat.

### Cross-Task Self-Improvement

The `AgentLearningService` is spec'd but not wired into the execution engine. This is our most unique differentiator — no other framework learns from past executions.

- Wire `AgentLearningService` into the execution engine's `complete` phase
- After each task: record outcome (strategy, success, score, cost, latency) to persistent SQLite store
- Before strategy selection: query learned preferences for the current task type
- Minimum 3 samples before overriding default — avoids overfitting
- Expose trends via `rax inspect <agent-id> --learning`

### Semantic Caching

Spec targets a 10x cost reduction. No competitor has architectural caching.

- Cache LLM responses keyed by semantic similarity (cosine distance < 0.05 = cache hit)
- Use `sqlite-vec` (already in the memory layer) for fast KNN lookup
- Cache invalidation: TTL, manual, or confidence-score-based
- Cost savings reported in `result.metadata.cacheSavings`
- `withCostTracking({ semanticCache: true })` to enable

### Prompt Compression

Reduce token costs on long contexts — already spec'd in the cost layer.

- Automatic summarization of conversation history beyond a token threshold
- Priority-based context window budgeting (system > task > memory > history)
- Sliding window with topic coherence preservation
- Works transparently within `ContextWindowManager`

---

## v0.6.0 — LiteLLM Bridge & Enterprise Identity

**Target: 120 days**

### LiteLLM Provider Adapter

Vercel AI SDK supports 40+ providers. We need parity without maintaining 40 adapters.

- `LiteLLMAdapter` that proxies any LiteLLM-compatible endpoint
- Unified model naming convention
- Covers: Mistral, Cohere, Azure OpenAI, AWS Bedrock, Together AI, Groq, DeepSeek, and more
- `.withProvider("litellm", { model: "mistral/mistral-large", baseUrl: "..." })`
- Maintains our typed `LLMService` contract — no API changes for consumers

### Ed25519 Agent Certificates — Production-Ready

The identity layer has RBAC, but the cryptographic certificate chain needs hardening for enterprise.

- Ed25519 key generation per agent instance
- Certificate signing by an issuer (your org's key or a built-in test CA)
- Delegation chains: agent A delegates subset of permissions to agent B
- Immutable audit log: every privileged action is signed and timestamped
- Certificate revocation for compromised agents
- `rax inspect <agent-id> --identity` shows full certificate chain

### Behavioral Contracts + Kill Switch — Full Integration

- `killAgent(agentId, reason)` publishes `GuardrailKillAgent` event that execution engine listens for
- In-flight tasks are cancelled via Effect fiber interruption — no runaway agents
- Kill events are signed with the calling agent's certificate (requires identity layer)
- Audit log entry created with reason and calling agent identity

---

## v0.7.0 — Voice, UI & Edge

**Target: 180 days**

### Voice / Realtime Agent Support

AWS Strands, OpenAI, and Google ADK all ship voice agent capabilities. This is the fastest-growing agent segment.

- Bidirectional audio streaming via WebRTC or WebSockets
- Integration with realtime speech APIs (OpenAI Realtime, Gemini Live)
- `@reactive-agents/voice` package with `VoiceAgent` builder
- Turn-taking, interruption handling, and silence detection
- Works with our 5 interaction modes — voice calls can trigger `collaborative` mode checkpoints

### `@reactive-agents/react` — UI Framework Integration

Vercel AI SDK dominates the TS/React narrative with `useChat`, `useCompletion`. We need native React hooks that expose our richer agent state.

```tsx
import { useAgent, useAgentStream } from "@reactive-agents/react";

function ChatUI() {
  const { run, result, isRunning } = useAgent({ provider: "anthropic" });
  const { events } = useAgentStream(result?.agentId);
  // events: thinking, action, cost-update, checkpoint...
}
```

- `useAgent()` — run and track agent execution
- `useAgentStream()` — subscribe to real-time agent events
- `useAgentMemory()` — read/write agent memory from UI
- `AgentProvider` context for app-wide agent configuration
- Compatible with Next.js, Remix, Vite

### Edge / WASM Target

Deploy agents to Cloudflare Workers, Deno Deploy, and Bun Edge.

- Replace `bun:sqlite` with a WASM SQLite build for edge environments
- Tree-shake memory tiers: Tier 1 (FTS5) works on edge, Tier 2 (vector) requires more compute
- `@reactive-agents/edge` compatibility shim
- Vercel Edge Functions support

---

## v1.0.0 — Stable Release

**Target: 270 days**

- Semantic versioning commitment — no breaking changes without major version
- Compiled output stable across all packages
- A2A Protocol at spec v1.0
- All 7 unique differentiators fully implemented and tested
- Performance benchmarks published against LangChain, Vercel AI SDK, Mastra
- Enterprise support tier documentation
- Migration guide from LangChain, CrewAI, AutoGPT

---

## v1.1.0+ — Evolutionary Intelligence (Phase 5)

Inspired by UC Santa Barbara **Group-Evolving Agents (GEA)** research (Feb 2026).

### `@reactive-agents/evolution`

- **AgentGenome** — serializable strategy configuration evolved through fitness evaluation
- **ExperiencePool** — shared episodic and procedural memory across agent groups
- **FitnessEvaluator** — drives `@reactive-agents/eval` to score genome fitness
- **Zero-cost deployment** — evolved strategies baked into config, no extra LLM calls at runtime
- **Cross-model transfer** — genomes evolved on one model deploy to another
- **A2A integration** — genomes shared via Agent Card metadata

---

## Ongoing Priorities (Every Release)

### Developer Experience

- Keep the 10-phase engine invisible behind `ReactiveAgents.create().build()`
- Every new capability opt-in via a single `.withX()` builder method
- Error messages that name the Effect layer and suggest fixes
- `rax dev` hot-reload for agent iteration without full restarts

### Type Safety Hardening

- Tighten generic constraints on `createRuntime()` to eliminate `as any` casts in layer composition
- Encode layer requirements in the type system: `.withReasoning()` on a builder without `.withProvider()` should be a type error
- Schema-validate all cross-layer messages at runtime in development mode

### Performance

- Target: < 50ms overhead for the execution engine itself (excluding LLM calls)
- SQLite WAL mode enabled by default for concurrent read access
- Lazy layer initialization — only activate layers that a task's context actually needs

### Test Coverage

- Every new capability ships with unit tests (Bun test runner) + one integration test using the `test` provider
- Regression suite: run on every PR, blocking merge
- Eval suites for reasoning strategies and verification layers using `@reactive-agents/eval`

---

## What We Will Not Do

Keeping this intentional:

- **No LangChain compatibility layer** — we are not a migration shim
- **No Python port** — Effect-TS is the differentiator; Python has its own ecosystem
- **No GUI visual builder** (pre-v1.0) — code-first DX is our identity
- **No vendor lock-in** — every provider is optional; no feature requires a specific LLM

---

## Competitive Positioning by Milestone

| Milestone | Gap Closed                                                   | Unique Advantage Added                             |
| --------- | ------------------------------------------------------------ | -------------------------------------------------- |
| v0.1.0 ✅ | Node.js ESM output, Gemini, Reflexion                        | 4-strategy reasoning + compiled output day one     |
| v0.2.0 ✅ | Tools-in-ReAct, MCP stdio, Eval framework                   | Eval backed by our 5-layer verification            |
| v0.3.0 ✅ | **All services wired, 5 strategies, OpenAI tools, full docs** | **Adaptive meta-strategy + fully observable engine** |
| v0.4.0    | A2A interoperability, streaming, MCP complete                | First TS framework with A2A + agent-as-tool        |
| v0.5.0    | Self-improvement, semantic caching                           | Cross-task learning unique in market               |
| v0.6.0    | 40+ providers, enterprise identity                           | Cryptographic audit trail unique in market         |
| v0.7.0    | Voice, UI, Edge                                              | Full-stack agent runtime no competitor matches     |
| v1.0.0    | Stability, benchmarks                                        | Production-grade, proven, documented               |
| v1.1.0+   | Evolutionary intelligence                                    | GEA-inspired zero-cost genome evolution            |

---

_Last updated: February 2026 — v0.3.0 foundation integration released_
_Grounded in: `spec/docs/12-market-validation-feb-2026.md`, `spec/docs/00-VISION.md`, `spec/docs/13-foundation-gap-analysis-feb-2026.md`_
