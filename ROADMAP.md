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

## Current State — v0.4.0 ✅ Released (Feb 22, 2026)

**15 packages, 442 tests across 77 files, fully composable via Effect-TS.**

### v0.3.0 → v0.4.0 History

- **v0.3.0** (Feb 21): All 10 execution engine phases wired, 5 reasoning strategies, OpenAI function calling, 28-page docs site
- **v0.3.1** (Feb 21): Ollama SDK, MCP parameter population, builder MCP config, Tavily web search
- **v0.4.0** (Feb 22): Enhanced builder API (ReasoningOptions, ToolsOptions, PromptsOptions), structured tool results across all 4 adapters, EvalStore persistence, 80+ new tests

### What's Complete

- ✅ 10-phase execution engine fully wired — all phases call their respective services
- ✅ 5 reasoning strategies: ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive
- ✅ 4 LLM providers: Anthropic, OpenAI, Gemini, Ollama (all with tool calling where supported)
- ✅ Full memory system (Working/Semantic/Episodic/Procedural, FTS5, Zettelkasten)
- ✅ Guardrails, verification, cost tracking, identity, observability, interaction, orchestration
- ✅ MCP stdio transport, Tavily web search, built-in tools
- ✅ Eval framework with LLM-as-judge and EvalStore persistence
- ✅ `rax` CLI, Starlight docs (28 pages), compiled ESM + DTS output

### What's Scaffolded / Incomplete

- ⚠️ MCP SSE and WebSocket transports (stubs only)
- ⚠️ Self-improvement learning loop (spec'd, not wired)
- ⚠️ Streaming service (spec'd, not wired)
- ⚠️ A2A protocol (not started — critical gap)

---

## v0.5.0 — A2A Protocol, Agent Composition & Hardening

**In Progress — see `spec/docs/14-v0.5-comprehensive-plan.md` for full implementation plan.**

**A2A is the single most important gap.** Google ADK and AWS Strands both ship native A2A support. It is the emerging Linux Foundation standard (21.9K stars) for agent-to-agent communication.

> **MCP = agent ↔ tools. A2A = agent ↔ agent.**

### New Package: `@reactive-agents/a2a`

- **A2A Server**: JSON-RPC 2.0 over HTTP, Agent Cards at `.well-known/agent.json`, SSE task streaming
- **A2A Client**: Discover remote agents, send tasks, subscribe to updates
- **Agent-as-Tool**: Register local or remote agents as callable tools

### MCP Full Transports

- SSE transport for remote MCP servers
- WebSocket transport for bidirectional MCP

### Test Coverage Hardening

- Target 550+ tests (from 442)
- Focus: verification, identity, orchestration, observability, cost packages

### Builder & CLI Extensions

- `.withA2A()`, `.withAgentTool()`, `.withRemoteAgent()` builder methods
- `rax serve`, `rax discover` CLI commands

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
| v0.4.0 ✅ | Enhanced builder, structured tool results, EvalStore         | Composable builder options + persistent eval       |
| v0.5.0    | **A2A interop, agent-as-tool, MCP transports, test hardening** | **First TS framework with A2A + agent composition** |
| v0.6.0    | Self-improvement, semantic caching, 40+ providers            | Cross-task learning + LiteLLM adapter              |
| v0.7.0    | Voice, UI, Edge                                              | Full-stack agent runtime no competitor matches     |
| v1.0.0    | Stability, benchmarks                                        | Production-grade, proven, documented               |
| v1.1.0+   | Evolutionary intelligence                                    | GEA-inspired zero-cost genome evolution            |

---

_Last updated: February 22, 2026 — v0.4.0 released, v0.5.0 in progress_
_Grounded in: `spec/docs/12-market-validation-feb-2026.md`, `spec/docs/14-v0.5-comprehensive-plan.md`_
