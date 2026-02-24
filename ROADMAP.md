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

## Current State — v0.5.1 ✅ Released (Feb 24, 2026)

**17 packages, 804 tests across 114 files, fully composable via Effect-TS.**

### v0.4.0 → v0.5.1 History

- **v0.4.0** (Feb 22): Enhanced builder API (ReasoningOptions, ToolsOptions, PromptsOptions), structured tool results across all 4 adapters, EvalStore persistence, 80+ new tests
- **v0.5.0 — A2A + Foundation Hardening** (Feb 23): Full A2A protocol (`@reactive-agents/a2a`), agent-as-tool, MCP SSE transport, ObservabilityService exporters (console/file), tracer correlation IDs, EventBus wiring for all phases, LLM request capture as episodic memory, semantic cache embeddings, LLM-based prompt compression, workflow approval gates, ThoughtTracer, real-time reasoning visibility (`live: true` streaming)
- **v0.5.1 — Context Engineering Revolution** (Feb 24): Model-adaptive context profiles (4 tiers), structured ObservationResult, context budget system, real sub-agent delegation, scratchpad built-in tool (7 total), progressive 4-level compaction, tier-aware prompt templates, full type safety

### What's Complete

- ✅ 10-phase execution engine fully wired — all phases call their respective services
- ✅ 5 reasoning strategies: ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive
- ✅ 4 LLM providers: Anthropic, OpenAI, Gemini, Ollama (all with tool calling where supported)
- ✅ Full memory system (Working/Semantic/Episodic/Procedural, FTS5, Zettelkasten)
- ✅ Guardrails, verification, cost tracking, identity, interaction, orchestration
- ✅ MCP stdio + SSE transports, Tavily web search, built-in tools
- ✅ Eval framework with LLM-as-judge and EvalStore persistence
- ✅ `rax` CLI (init, create, run, serve, discover), Starlight docs (28 pages), compiled ESM + DTS output
- ✅ A2A protocol: JSON-RPC 2.0, Agent Cards, SSE streaming, agent-as-tool
- ✅ Observability: console exporter (ANSI), file exporter (JSONL), tracer correlation, live streaming
- ✅ Real-time reasoning visibility: `┄ [thought/action/obs]` lines stream as agent thinks
- ✅ ThoughtTracer, WorkflowEngine approval gates, semantic cache embeddings, LLM-based compression
- ✅ Model-adaptive context profiles — 4 tiers (local/mid/large/frontier) with calibrated thresholds
- ✅ Structured tool observations — typed ObservationResult replaces string-prefix success checks
- ✅ Context budget system — per-section token allocation, adaptive compaction
- ✅ Real sub-agent delegation — .withAgentTool() spawns clean-context sub-runtimes (depth limited)
- ✅ Scratchpad built-in tool — persistent notes outside context window (7 total built-in tools)
- ✅ Progressive 4-level compaction — full/summary/grouped/dropped with preservation rules
- ✅ Tier-aware prompt templates — react-system/thought variants for local and frontier models

### What's Scaffolded / Incomplete

- ⚠️ MCP WebSocket transport (SSE done; WebSocket still spec'd only)
- ⚠️ Self-improvement learning loop (spec'd, not wired)
- ⚠️ Streaming service (spec'd, not wired)

---

## v0.5.0 — A2A Protocol, Agent Composition & Hardening ✅ Released (Feb 23, 2026)

See `spec/docs/14-v0.5-comprehensive-plan.md` for the full plan. All items shipped.

### Shipped: `@reactive-agents/a2a`

- **A2A Server**: JSON-RPC 2.0 over HTTP, Agent Cards at `.well-known/agent.json`, SSE task streaming
- **A2A Client**: Discover remote agents, send tasks, subscribe to updates
- **Agent-as-Tool**: Register local or remote agents as callable tools

### Shipped: MCP SSE Transport

- Full SSE transport for remote MCP servers (WebSocket deferred to v0.6.0)

### Shipped: Foundation Hardening

- ObservabilityService console + file exporters; tracer correlation IDs propagated across spans
- EventBus: `LLMRequestCompleted`, `ToolCallStarted/Completed`, `ExecutionPhaseCompleted`, `ReasoningStepCompleted`
- Semantic cache with optional embedding-based cosine similarity (>0.92 threshold)
- LLM-based prompt compression (heuristic first, LLM second pass)
- WorkflowEngine approval gates (`requiresApproval` on steps, `approveStep()`/`rejectStep()`)
- ThoughtTracer service — captures reasoning chain via EventBus subscription
- Live reasoning streaming: `withObservability({ verbosity: "verbose", live: true })`

### Shipped: Test Coverage

- 720 tests across 106 files (was 442/77 in v0.4.0)

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

### Programmatic Tool Calling + Docker Sandbox

The problem with the current ReAct loop (confirmed by debug traces)

Scenario 5 produced 7 round trips to accomplish: compute factorial → save to file.
Thought: I'll use code-execute... ← LLM call #1
Action: code-execute(...)
Obs: { executed: false } ← context bloat
Thought: stub returned nothing, so 7!... ← LLM call #2
Action: file-write({"path": ...})
Obs: { written: true, path: ... } ← more context
Thought: confirm done, FINAL ANSWER ← LLM call #3

With programmatic tool calling, the LLM writes one code block that does all of it:
const result = await tools.codeExecute({ code: "..." }); // real
const n = parseInt(result.output);
await tools.fileWrite({ path: "./factorial_7.txt", content: String(n) });
return `Computed factorial: ${n}, saved to ./factorial_7.txt`;
That's 1 LLM call → 1 sandbox execution → 1 observation back into context. The intermediate results live and die inside the container
scope.

---

Two distinct systems, both needed

System 1: Docker Code Sandbox (packages/tools/src/execution/docker-sandbox.ts)

Replaces the stub. All code-execute calls go through here. Security profile:

docker run --rm
--network none # no internet from container
--read-only # root fs immutable
--tmpfs /tmp:size=50m # writable memory-only scratch space
--cap-drop ALL # strip all Linux capabilities
--no-new-privileges # no setuid/sudo escalation
--memory 256m # hard memory cap
--memory-swap 256m # no swap to disk
--cpus 0.5 # CPU throttle
--pids-limit 50 # no fork bombs
--user 1000:1000 # non-root
ghcr.io/reactive-agents/code-runner:bun # minimal Bun image

Returns { stdout, stderr, exitCode, durationMs }. File I/O to the host goes through the tools bridge only (container has --network
none).

System 2: Tools Bridge + Programmatic Strategy

A thin HTTP server on a Unix socket that runs on the host, routing LLM-generated code's tool calls through ToolService. The container
gets --env TOOLS_BRIDGE_SOCKET=/run/bridge.sock and network access restricted to only that socket.

Container (isolated) Host
┌─────────────────────┐ ┌─────────────────────┐
│ LLM-generated code │ unix sock │ ToolsBridgeServer │
│ tools.webSearch() │────────────▶│ → ToolService │
│ tools.fileWrite() │────────────▶│ → validates + audits│
│ return finalResult │ │ → EventBus.publish() │
└─────────────────────┘ └─────────────────────┘
↓
ONE observation in context

The bridge enforces the same ToolService authorization model — riskLevel, requiresApproval, guardrails — so no bypass is possible.
The LLM can write loops, conditionals, intermediate filtering, all of which stay inside the container scope.

---

Phased plan

┌───────┬──────────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────────┐
│ Phase │ Deliverable │ Unlocks │
├───────┼──────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
│ 1 │ DockerSandboxService — real container execution, security hardening, image │ Real code-execute results in │
│ │ management │ existing tests │
├───────┼──────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
│ 2 │ ToolsBridgeServer — Unix socket server wrapping ToolService, injected into │ Multi-tool code in single container │
│ │ containers │ execution │
├───────┼──────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
│ 3 │ programmatic reasoning strategy — LLM outputs code blocks, one execution = one │ 30–50% token reduction on │
│ │ observation, compacted context │ multi-step tasks │
├───────┼──────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
│ 4 │ Prebuilt runner images (bun, python-slim, node) published to GHCR │ Multi-language support │
└───────┴──────────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────┘

Phase 1 is self-contained and immediately valuable — it fixes the code-execute stub and makes Scenario 5 in test.ts actually work.
Phases 2–3 are the novel contribution, and Phase 4 is operational hardening.

---

What's already in place

- ToolService.execute() — the authorization + audit path the bridge will call through
- execution/sandbox.ts — the timeout/defect wrapper stays, the Docker layer sits inside it
- ToolDefinition.riskLevel + requiresApproval — already the right fields for per-tool sandbox policy
- rax CLI structure — rax run is the natural entry point for --sandbox docker flag
- EventBus — every tool call through the bridge can publish ToolCallStarted/Completed events, giving full observability inside
  programmatic executions

---

Want to proceed with Phase 1 — the real Docker sandbox — as the first concrete deliverable? That's the foundation everything else
builds on, and it's independently shippable. Or if you want to design Phase 2–3 architecture first (the bridge + programmatic
strategy), we can spec those out before writing code.

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

| Milestone | Gap Closed                                                                             | Unique Advantage Added                                      |
| --------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| v0.1.0 ✅ | Node.js ESM output, Gemini, Reflexion                                                  | 4-strategy reasoning + compiled output day one              |
| v0.2.0 ✅ | Tools-in-ReAct, MCP stdio, Eval framework                                              | Eval backed by our 5-layer verification                     |
| v0.3.0 ✅ | **All services wired, 5 strategies, OpenAI tools, full docs**                          | **Adaptive meta-strategy + fully observable engine**        |
| v0.4.0 ✅ | Enhanced builder, structured tool results, EvalStore                                   | Composable builder options + persistent eval                |
| v0.5.0 ✅ | **A2A interop, agent-as-tool, MCP SSE, foundation hardening, real-time observability** | **First TS framework with A2A + live reasoning visibility** |
| v0.6.0    | Self-improvement, semantic caching, 40+ providers                                      | Cross-task learning + LiteLLM adapter                       |
| v0.7.0    | Voice, UI, Edge                                                                        | Full-stack agent runtime no competitor matches              |
| v1.0.0    | Stability, benchmarks                                                                  | Production-grade, proven, documented                        |
| v1.1.0+   | Evolutionary intelligence                                                              | GEA-inspired zero-cost genome evolution                     |

---

_Last updated: February 24, 2026 — v0.5.1 released, v0.6.0 planning_
_Grounded in: `spec/docs/12-market-validation-feb-2026.md`, `spec/docs/14-v0.5-comprehensive-plan.md`_
