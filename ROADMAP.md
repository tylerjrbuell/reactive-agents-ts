# Reactive Agents — Roadmap

> **The open-source agent framework built for control, not magic.**
> Ordered by competitive impact and developer value. Items within each milestone are sequenced by dependency and urgency.

---

## Strategic Context

The agent framework landscape is crowded. TypeScript-first frameworks (Vercel AI SDK, Mastra, Google ADK, AWS Strands) are mainstream. Most optimize for the happy path — simple demos that work with frontier models. **We optimize for control.** The capabilities that set us apart:

1. **5 reasoning strategies** with adaptive selection — ReAct, Plan-Execute, Tree-of-Thought, Reflexion, Adaptive
2. **Model-adaptive context profiles** — 4 tiers (local/mid/large/frontier) with calibrated thresholds, so agents work well on local models, not just GPT-4
3. **Composable kernel SDK** — swappable reasoning algorithms, immutable state, universal hooks
4. **Professional observability** — auto-instrumented metrics dashboard, per-phase timing, EventBus-driven with zero manual wiring
5. **DX-first design** — every capability opt-in via `.withX()`, 10-phase engine invisible behind `ReactiveAgents.create().build()`
6. **Cost-first architecture** — semantic caching, complexity routing, prompt compression, budget enforcement
7. **Cryptographic agent identity** — real Ed25519 certificates, RBAC, behavioral contracts

The roadmap below is about two things: **closing the gaps** that currently block production adoption, and **proving our strengths with published benchmarks and real-world results**.

---

## Current State — v0.9.0 (published) / Unreleased on main — Apr 18, 2026

**25 packages, ~4,150 tests across ~460 files. v0.9.0 is published on npm. An `Unreleased` block on main contains: Agent-as-Data (`AgentConfig`), `agentFn`/`pipe`/`parallel`/`race` composition, dynamic tool registration, Living Intelligence Skills, Conductor's Suite meta-tools, web framework packages (`@reactive-agents/react`, `vue`, `svelte`), dynamic pricing, and CLI hardening — pending the next changeset release.**

### v0.6.3 → v0.7.0 (Shipped on main, pending npm)

- ✅ **ContextEngine** — per-iteration context scoring (recency decay, relevance, type weight, failure boost)
- ✅ **ExperienceStore** — cross-agent tool pattern and error recovery learning (SQLite-backed)
- ✅ **MemoryConsolidatorService** — background decay/replay/compress for episodic memory
- ✅ **Meta-tools** — `context-status` (always-on introspection) + `task-complete` (visibility-gated completion)
- ✅ **Parallel/chain tool execution** — multiple `ACTION:` lines or `THEN:` chaining from single thought
- ✅ **Required Tools Guard** — `.withRequiredTools()` ensures named tools called before completion
- ✅ **Adaptive LLM inference** — heuristic-first tool selection, LLM fallback only when needed
- ✅ **Circuit breaker** — exponential backoff, half-open probe for LLM provider resilience
- ✅ **Embedding cache** — LRU cache for vector embeddings
- ✅ **Budget persistence** — daily token budget survives process restarts
- ✅ **Docker sandbox** — code-execute runs in isolated container with resource limits
- ✅ **JSON repair** — malformed LLM outputs automatically repaired before parse
- ✅ **`@reactive-agents/benchmarks`** — 20-task × 5-tier benchmark suite, `rax bench` CLI command
- ✅ **ReAct quality sprint** — token budget increases, tier reclassification, anti-fabrication rules, heuristic tool inference

### v0.7.0 → v0.8.0 (Feature branch, pending merge + npm)

- ✅ **`final-answer` meta-tool** — hard-gates ReAct loop exit; replaces fragile text regex
- ✅ **DebriefSynthesizer** — post-run structured synthesis: tool history + one LLM call → `AgentDebrief`
- ✅ **DebriefStore** — SQLite persistence for run artifacts (`agent_debriefs` table in memory DB)
- ✅ **Enriched `AgentResult`** — `debrief?`, `format?`, `terminatedBy?` optional fields (backward compatible)
- ✅ **`agent.chat()`** — conversational Q&A with adaptive routing (direct LLM or ReAct loop)
- ✅ **`agent.session()`** — multi-turn conversation with managed history and debrief context injection

---

## Historical State — v0.5.6 ✅ (Feb 28, 2026)

**18 packages, 1001 tests across 139 files, fully composable via Effect-TS.**

### v0.4.0 → v0.5.2 History

- **v0.4.0** (Feb 22): Enhanced builder API (ReasoningOptions, ToolsOptions, PromptsOptions), structured tool results across all 4 adapters, EvalStore persistence, 80+ new tests
- **v0.5.0 — A2A + Foundation Hardening** (Feb 23): Full A2A protocol (`@reactive-agents/a2a`), agent-as-tool, MCP SSE transport, ObservabilityService exporters (console/file), tracer correlation IDs, EventBus wiring for all phases, LLM request capture as episodic memory, semantic cache embeddings, LLM-based prompt compression, workflow approval gates, ThoughtTracer, real-time reasoning visibility (`live: true` streaming)
- **v0.5.1 — Context Engineering Revolution** (Feb 24): Model-adaptive context profiles (4 tiers), structured ObservationResult, context budget system, real sub-agent delegation, scratchpad built-in tool (7 total), progressive 4-level compaction, tier-aware prompt templates, full type safety
- **v0.5.2 — Trust Fixes + Differentiator Completion** (Feb 25): Real Ed25519 cryptography, LiteLLM provider (40+ models), kill switch + behavioral contracts, subprocess code sandbox, multi-source verification (LLM + Tavily), prompt A/B experiment framework, cross-task self-improvement loop, `rax serve --with-tools` builder fix
- **v0.5.5 — EventBus Groundwork + Metrics Dashboard** (Feb 27): Full EventBus coverage (10+ new events, taskId correlation), MetricsCollector auto-subscribed dashboard, reasoning strategy fixes, tool result compression, MCP streamable-http transport
- **v0.5.6 — Agent Gateway** (Feb 28): New `@reactive-agents/gateway` package — persistent autonomous harness with adaptive heartbeats, cron scheduling, webhook ingestion, composable policy engine, 10 new EventBus events

### What's Complete

- ✅ 10-phase execution engine fully wired — all phases call their respective services
- ✅ 5 reasoning strategies: ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive
- ✅ **6 LLM providers**: Anthropic, OpenAI, Gemini, Ollama, **LiteLLM** (40+ models via proxy), Test (deterministic mock)
- ✅ Full memory system (Working/Semantic/Episodic/Procedural, FTS5, Zettelkasten)
- ✅ Guardrails, verification, cost tracking, identity, interaction, orchestration
- ✅ MCP stdio + SSE + **WebSocket** transports, Tavily web search, built-in tools
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
- ✅ Dynamic sub-agent spawning via withDynamicSubAgents() — spawn-agent built-in tool, clean context windows, MAX_RECURSION_DEPTH=3 guard (8 total built-in tools)
- ✅ Progressive 4-level compaction — full/summary/grouped/dropped with preservation rules
- ✅ Tier-aware prompt templates — react-system/thought variants for local and frontier models
- ✅ **Real Ed25519 cryptography** — `crypto.subtle.generateKey("Ed25519")`, signature verification, SHA-256 fingerprints, certificate rotation/revocation
- ✅ **LiteLLM provider adapter** — unified access to 40+ LLM providers via configurable proxy, zero new dependencies
- ✅ **Kill switch** — per-agent + global halt at any phase boundary via `.withKillSwitch()`
- ✅ **Behavioral contracts** — enforce tool/output/iteration constraints via `.withBehavioralContracts()`
- ✅ **Code sandbox** — subprocess isolation via `Bun.spawn()` with minimal env (PATH/HOME only), no project secrets leaked
- ✅ **Multi-source verification** — LLM claim extraction + Tavily search corroboration (Tier 2), heuristic placeholder (Tier 1)
- ✅ **Prompt A/B experiment framework** — `ExperimentService` with deterministic cohort assignment, outcome recording, winner selection
- ✅ **Cross-task self-improvement** — episodic memory logs strategy outcomes; adaptive strategy queries past experience to bias selection
- ✅ **Professional metrics dashboard** — `MetricsCollector` auto-subscribes to EventBus, `formatMetricsDashboard()` renders header + timeline + tools + alerts
- ✅ **Agent Gateway** — `@reactive-agents/gateway` — persistent autonomous harness with adaptive heartbeats, cron scheduling, webhook ingestion (GitHub + generic adapters), composable policy engine (4 built-in policies)

### What's Scaffolded / Incomplete

- ⚠️ Docker container sandbox (subprocess done; full Docker isolation with network/memory limits deferred)
- ⚠️ Programmatic tool calling strategy (spec'd, depends on Docker sandbox)
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

## v0.6.0 — Docker Sandbox & Trust Layer ✅ (Shipped early in v0.5.2–v0.5.6)

### ✅ Shipped Early (in v0.5.2)

- ✅ **LiteLLM Provider Adapter** — configurable via `LITELLM_BASE_URL`, covers 40+ providers
- ✅ **Ed25519 Agent Certificates** — real `crypto.subtle.generateKey("Ed25519")`, signature verification, rotation/revocation
- ✅ **Kill Switch + Behavioral Contracts** — per-agent + global halt, tool/output/iteration constraints
- ✅ **Multi-source verification** — LLM claim extraction + Tavily search corroboration
- ✅ **Prompt A/B experiments** — deterministic cohort assignment, outcome recording, winner selection
- ✅ **Cross-task self-improvement** — episodic memory logs strategy outcomes, adaptive strategy queries past experience
- ✅ **Code sandbox (subprocess)** — `Bun.spawn()` isolation with minimal env, no secrets leaked

---

## v0.9.0 — Native FC Harness, Skills System, Cortex Studio ✅ Released (Apr 2026)

**What shipped:** Native function-calling harness across all providers, provider adapter hooks (7/7), Living Skills system with SKILL.md compatibility, Conductor's Suite meta-tools, Cortex local studio (Beacon view, Run details, debrief UI), Cortex Lab skill authoring, `@reactive-agents/react`/`vue`/`svelte` web hook packages, Agent-as-Data config, adaptive calibration with drift detection, agent.chat()/session() with SQLite persistence.

**Remaining original v0.9.0 targets (moved to v1.0.0 or later):**

### Published Benchmarks

- 20-task x 5-model-tier benchmark suite with public results
- Comparison against LangChain, Vercel AI SDK, Mastra on token efficiency, latency, and correctness
- Per-strategy breakdown (ReAct vs Plan-Execute vs ToT) across model tiers
- Results published to docs site and GitHub README

### Docker Code Sandbox (Full Isolation)

- `DockerSandboxService` — real container execution with security hardening (network isolation, read-only rootfs, resource limits)
- Replaces subprocess sandbox for `code-execute` tool
- `--sandbox docker` flag on `rax run`

### Programmatic Tool Calling

- LLM outputs code blocks that call tools programmatically inside the sandbox
- `ToolsBridgeServer` on Unix socket routes container tool calls through ToolService (same auth/audit path)
- 1 LLM call + 1 sandbox execution = 1 observation — 30-50% token reduction on multi-step tasks
- See `spec/docs/` for detailed architecture

### README & Docs Polish

- Getting started guide rewritten for new users
- Real-world example apps (researcher, code reviewer, data analyst)
- API reference generated from TypeDoc
- Docs site updated with benchmark results

---

## v1.0.0 — Stable Release

**Focus: stable API, proven benchmarks, and migration paths for adoption.**

- Semantic versioning commitment — no breaking changes without major version
- Compiled output stable across all packages
- A2A Protocol at spec v1.0
- Published benchmark comparison against LangChain, Vercel AI SDK, Mastra
- Migration guides from LangChain and Vercel AI SDK
- Community growth targets: 1K GitHub stars, 500 npm weekly downloads

### `@reactive-agents/react` — UI Framework Integration ✅ Shipped in v0.8.5

**Already shipped — see `packages/react/`, `packages/vue/`, `packages/svelte/`. Listed here for historical roadmap context.**


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

---

## v1.1.0+ — Strategy Evolution & Platform Expansion

### Strategy Evolution

- Agents improve their own reasoning approach over time based on task outcomes
- `AgentGenome` — serializable strategy configuration evolved through fitness evaluation
- `FitnessEvaluator` — drives `@reactive-agents/eval` to score genome fitness
- Evolved strategies baked into config — no extra LLM calls at runtime

### Expanded Local Model Optimization

- Model-specific prompt tuning profiles (Llama, Mistral, Qwen, Gemma families)
- Automatic tier detection from model name/size
- Local model benchmark suite with optimization recommendations

### Plugin Marketplace

- Community-contributed tool adapters, reasoning kernels, and memory backends
- `rax install <plugin>` for one-command setup
- Published plugin SDK with validation and testing helpers

### Node.js Runtime Compatibility & Browser Execution

Make the framework runnable on Node.js (not just Bun) and browser environments (WebContainers/StackBlitz):

- **Lazy memory layer** — `createRuntime()` currently initializes `memoryLayer` unconditionally even when `enableMemory: false`; make it truly lazy/optional so runtimes without SQLite can start cleanly
- **SQLite abstraction** — replace direct `bun:sqlite` dependency with a backend interface that supports `better-sqlite3` (Node.js) and `sql.js` (WASM/browser)
- **Runtime-guarded Bun APIs** — audit all `Bun.spawn`, `Bun.file`, `Bun.serve` usage; add runtime detection with Node.js fallbacks (`child_process`, `fs`, `http`)
- **WebContainer demo** — `npx reactive-agents demo` runs in StackBlitz/WebContainers for embedded docs playground and zero-install onboarding

**Impact:** Unlocks Node.js users, StackBlitz/CodeSandbox embeds, and browser-based interactive docs — removes the single biggest adoption barrier for teams not on Bun.

### Messaging Channel Integrations

- Discord, Signal, Telegram agent frontends via MCP transports
- `@reactive-agents/channels` package with adapter pattern
- Persistent sessions across messaging platforms using existing `agent.session()` API

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
| v0.5.2 ✅ | **Ed25519 crypto, LiteLLM, kill switch, contracts, sandbox, self-improvement**         | **Control-first architecture — no competitor matches**      |
| v0.5.6 ✅ | **Agent Gateway: heartbeats, crons, webhooks, policy engine**                          | **Persistent autonomous agents with deterministic infrastructure** |
| v0.7.0 ✅ | Required tools guard, circuit breaker, benchmarks, Docker sandbox, ContextEngine, ExperienceStore | Cross-agent learning + adaptive tool inference |
| v0.8.0 ✅ | Final-answer hard gate, structured debriefs, agent.chat() + agent.session()           | Self-reporting agents with conversational Q&A |
| v0.9.0 ✅ | Native FC harness, Skills system, Cortex Studio, react/vue/svelte hooks                | 7/7 adapter hooks + live agent canvas in a local studio     |
| v1.0.0*   | Published benchmarks, programmatic tool calling, Docker sandbox (full)                 | 30-50% token reduction, proven public results               |
| v1.0.0    | Stable API, migration guides, React hooks                                              | Production-grade with UI integration                        |
| v1.1.0+   | Strategy evolution, local model optimization, plugin marketplace                       | Self-improving agents + community ecosystem                 |

---

_Last updated: April 18, 2026 — v0.9.0 published on npm; 25 packages, ~4,150 tests across ~460 files; Unreleased block on main includes Living Skills, Conductor's Suite, Agent-as-Data, web framework hooks_
_Grounded in: `spec/docs/12-market-validation-feb-2026.md`, `spec/docs/14-v0.5-comprehensive-plan.md`_
