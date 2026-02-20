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

## Current State — v0.1.0 ✅ Released

**15 packages, 300 tests, fully composable via Effect-TS.**

What's shipping in v0.1.0:
- ✅ 10-phase execution engine with lifecycle hooks
- ✅ ReAct, Plan-Execute, Tree-of-Thought, **Reflexion** reasoning strategies
- ✅ Working/Semantic/Episodic/Procedural memory (bun:sqlite, FTS5)
- ✅ Guardrails (injection, PII, toxicity)
- ✅ Semantic entropy + fact decomposition verification
- ✅ Cost routing (Haiku/Sonnet/Opus) + budget enforcement
- ✅ Agent identity + RBAC
- ✅ Observability (tracing, metrics, logging)
- ✅ 5 interaction modes with dynamic escalation
- ✅ Multi-agent orchestration
- ✅ Prompt template engine + versioning
- ✅ `rax` CLI (init, create, run, inspect)
- ✅ **Compiled ESM + DTS output** — works in Node.js, Bun, and edge runtimes
- ✅ **Google Gemini provider** — Gemini 2.0 Flash, 2.5 Pro, embeddings, streaming

What's scaffolded but not production-complete:
- ⚠️ MCP tool client (interface defined, implementation shallow)
- ⚠️ `@reactive-agents/eval` (types defined, LLM-as-judge incomplete)
- ⚠️ Adaptive reasoning meta-selector (spec'd, not built)
- ⚠️ Self-improvement learning loop (spec'd, not wired)
- ⚠️ Semantic caching (spec'd, not built)
- ⚠️ Streaming service (spec'd, not wired into engine)

---

## v0.2.0 — Eval, MCP & More Providers
**Target: 30 days**

With Node.js compatibility and Gemini shipped in v0.1.0, v0.2.0 closes the critical ecosystem gaps.

### `@reactive-agents/eval` — Full Implementation
Evaluation is becoming table stakes (AWS Strands ships 7+ evaluator types; Google ADK has built-in eval). Ours is stubbed.

- **LLM-as-judge scoring** for accuracy, relevance, completeness, safety, cost-efficiency
- **Regression detection**: `compare(runA, runB)` flags degraded dimensions
- **Shadow eval**: run eval suite alongside production without blocking responses
- **`rax eval run --suite <name>`** CLI command wired to `EvalService`
- **Dataset service**: load eval cases from JSON/YAML files
- Leverage our unique 5-layer verification as the eval backbone — a differentiator over Strands' approach

### MCP Full Implementation
MCP is now universal (97M+ monthly SDK downloads, Linux Foundation). Currently our `createToolsLayer` has the interface but shallow implementation.

- Complete the MCP client: tool discovery, invocation, result mapping
- Support both local stdio and remote HTTP MCP servers
- Auto-convert MCP tool schemas to our typed `defineTool()` format
- Test with real MCP servers (Filesystem, GitHub, Brave Search)

### Provider Expansion: Mistral & Cohere
Broaden the provider ecosystem beyond OpenAI/Anthropic/Gemini.

- `MistralAdapter` — Mistral Large, Mistral Small, embeddings
- `CohereAdapter` — Command R+, embeddings with Cohere's rerank API
- Consistent `LLMService` contract — no API changes for consumers
- `MISTRAL_API_KEY` and `COHERE_API_KEY` environment variables

---

## v0.3.0 — A2A Protocol & Agent Interoperability
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
  .withTools([researchAgent.asTool()])  // ← agent as tool
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

---

## v0.4.0 — The Intelligence Advantage
**Target: 90 days**

This milestone makes our 7 unique differentiators fully production-ready. These are the features no other framework has — the moat.

### Adaptive Reasoning Meta-Selector
ReAct, Plan-Execute, ToT, and Reflexion are all implemented. The final piece is autonomous strategy selection:

- **Adaptive meta-selector**: an LLM evaluates the task complexity, urgency, and available strategies, selects the best one with reasoning. Replaces static strategy assignment.
- **Strategy effectiveness tracking**: each strategy's success rate is recorded per task type in SQLite, feeding the self-improvement loop.
- `.withReasoning({ strategy: "adaptive" })` — the agent picks from all 4 strategies automatically.

### Cross-Task Self-Improvement
The `AgentLearningService` is spec'd but not wired into the execution engine. This is our most unique differentiator — no other framework learns from past executions.

- Wire `AgentLearningService` into the execution engine's `complete` phase
- After each task: record outcome (strategy, success, score, cost, latency) to persistent SQLite store
- Before strategy selection: query learned preferences for the current task type
- Minimum 3 samples before overriding default — avoids overfitting
- Expose trends via `rax inspect <agent-id> --learning`

### 5-Layer Verification — Complete All 5
Currently only semantic entropy and fact decomposition are implemented. Three more from the spec:

- **Multi-source verification**: cross-check claims against multiple LLM calls with different system prompts
- **Self-consistency**: sample 3-5 times, compare answers — high variance → low confidence
- **NLI (Natural Language Inference)**: use an NLI model to check if generated claims are entailed, neutral, or contradicted by source documents
- Adaptive risk assessment: route high-stakes tasks to stricter verification tiers
- Confidence calibration: Platt scaling to produce calibrated 0–1 scores

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

## v0.5.0 — LiteLLM Bridge & Enterprise Identity
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
Guardrails have contracts, but the kill switch isn't fully wired to the execution engine.

- `killAgent(agentId, reason)` publishes `GuardrailKillAgent` event that execution engine listens for
- In-flight tasks are cancelled via Effect fiber interruption — no runaway agents
- Kill events are signed with the calling agent's certificate (requires identity layer)
- Audit log entry created with reason and calling agent identity

---

## v0.6.0 — Voice, UI & Edge
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

| Milestone | Gap Closed | Unique Advantage Added |
|-----------|-----------|----------------------|
| v0.1.0 ✅ | Node.js ESM output, Gemini, Reflexion | 4-strategy reasoning + compiled output day one |
| v0.2.0 | Eval parity, MCP completeness, Mistral/Cohere | Eval backed by our 5-layer verification |
| v0.3.0 | A2A interoperability, streaming | First TS framework with A2A + agent-as-tool |
| v0.4.0 | Full verification, adaptive reasoning | Self-improvement + 5-layer verification fully live |
| v0.5.0 | 40+ providers, enterprise identity | Cryptographic audit trail unique in market |
| v0.6.0 | Voice, UI, Edge | Full-stack agent runtime no competitor matches |
| v1.0.0 | Stability, benchmarks | Production-grade, proven, documented |

---

*Last updated: February 2026 — v0.1.0 shipped*
*Grounded in: `spec/docs/12-market-validation-feb-2026.md`, `spec/docs/00-VISION.md`, `spec/docs/11-missing-capabilities-enhancement.md`*
