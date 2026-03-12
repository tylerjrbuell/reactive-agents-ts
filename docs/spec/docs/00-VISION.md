# Reactive Agents: Vision & Philosophy

## Built for good, open source, and the betterment of the AI community — making AI agents more accessible, controllable, and trustworthy

> **The open-source agent framework built for control, not magic.**

---

## The Problem We're Solving

The current state of AI agent frameworks is broken for anyone who needs to understand, control, or trust what their agent is doing:

### The Current Framework Problem

```python
# Current frameworks: Black boxes you can't control
agent = create_react_agent(llm, tools, prompt)
result = await agent.invoke(input)

# What's wrong:
# ❌ Black box reasoning — you don't know what the agent is thinking
# ❌ Unpredictable outcomes — same input produces different results
# ❌ Poor observability — debugging failures is guesswork
# ❌ Context chaos — no control over what stays in memory
# ❌ Model lock-in — frameworks assume GPT-4, fall apart on smaller models
# ❌ One-size-fits-all — same approach for Claude and Llama-3-8B
# ❌ Poor DX — complex setup, unclear errors, hours to first working agent
# ❌ Hidden costs — no budget controls, no token visibility, surprise bills
```

### What Developers Actually Need

Whether you're building a production SaaS feature, a research prototype, or a personal automation:

- **Consistent, predictable results** — not random outputs
- **Full auditability** — explain every decision the agent made
- **Fine-grained control** — over reasoning, context, tools, and behavior
- **Observable systems** — see what's happening in real time
- **Model flexibility** — same framework, any model, optimized per tier
- **Cost efficiency** — budget controls, token tracking, smart routing
- **Reliability** — typed errors, circuit breakers, graceful degradation
- **Great developer experience** — minutes to first agent, not hours

**Current frameworks don't deliver this.**

---

## Our Solution: Control-First Architecture

Reactive Agents is built on three core principles:

> **1. Every decision an agent makes should be controllable, observable, and auditable.**
>
> **2. The right engineering makes any model production-capable — great agents aren't locked to flagship models.**
>
> **3. Great frameworks disappear — the DX should feel like building with superpowers, not fighting configuration.**

### Core Innovation: Two Pillars

```
┌─────────────────────────────────────────────────────────┐
│              REACTIVE AGENTS FRAMEWORK                  │
│        20 composable packages · TypeScript · Bun        │
└─────────────────────────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐
│   CONTROL-FIRST     │   │  MODEL-ADAPTIVE     │
│   ARCHITECTURE      │   │  INTELLIGENCE       │
│                     │   │                     │
│ 10-phase execution  │   │ Context profiles    │
│ 5 reasoning strats  │   │ Adaptive compaction │
│ Full EventBus       │   │ 4-layer memory      │
│ Composable layers   │   │ Smart tool routing  │
│ Type-safe errors    │   │ Budget enforcement  │
│ Observable by       │   │ Works on any model  │
│ default             │   │ from 8B to frontier │
└─────────────────────┘   └─────────────────────┘
```

**Pillar 1: Control-First Architecture** — Every phase of agent execution is explicit, hookable, and observable. No hidden reasoning loops. No magic prompt injection. You see exactly what your agent thinks, decides, and does.

**Pillar 2: Model-Adaptive Intelligence** — The framework adapts its behavior based on the model running it. Context profiles, prompt engineering, memory management, and tool result compression all tune automatically per model tier. The goal: make smaller, cheaper models perform far beyond what naive prompting achieves.

---

## Core Philosophy

### 1. Control Over Magic

```typescript
// Not this (magic black box):
const agent = createAgent({ model: "gpt-4" });

// This (explicit control):
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withMemory("my-agent")
  .withTools({ include: ["web-search", "file-write"] })
  .withContextProfile({ tier: "large", toolResultMaxChars: 2000 })
  .withObservability({ verbosity: "normal", live: true })
  .withCostTracking({ budget: { maxTokens: 50000 } })
  .withGuardrails()
  .build();
```

No black boxes. Every aspect is explicit and controllable. Enable exactly what you need — nothing more, nothing less.

### 2. Model-Adaptive Intelligence

```typescript
// Same framework, different models, automatic optimization
const localAgent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("llama3.1:8b")
  .withContextProfile({ tier: "local" })  // Auto-tunes for 8B models
  .withReasoning()
  .withTools()
  .build();

const frontierAgent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withContextProfile({ tier: "frontier" })  // Full context utilization
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools()
  .build();

// The framework handles:
// ✅ Context budget tuning per model capacity
// ✅ Prompt density and compaction strategy
// ✅ Tool result compression (structured previews, not blind truncation)
// ✅ Reasoning strategy selection appropriate for model capability
// ✅ Memory system reduces context needs for smaller models
// ✅ Circuit breakers prevent wasted tokens on stuck loops
```

The insight: most of what makes agents "smart" isn't the model — it's the harness. Better prompts, better context management, better memory, better tool orchestration. Engineering bridges the gap between model tiers.

### 3. Observability as Foundation

```typescript
// Every execution produces a professional metrics dashboard — automatically
const result = await agent.run("Research TypeScript testing frameworks");

// Output includes:
// ┌─────────────────────────────────────────────────────────────┐
// │ ✅ Agent Execution Summary                                   │
// ├─────────────────────────────────────────────────────────────┤
// │ Status:    ✅ Success   Duration: 13.9s   Steps: 7          │
// │ Tokens:    1,963        Cost: ~$0.003     Model: claude-3.5 │
// └─────────────────────────────────────────────────────────────┘
//
// Every decision, tool call, and context change is traced.
// EventBus publishes 15+ event types for real-time monitoring.
// No manual instrumentation required.
```

### 4. Developer Experience First

```typescript
// 60 seconds to a working agent with tools
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .build();

const result = await agent.run("What's the weather in Portland?");
console.log(result.output);

// Streaming — tokens arrive as they're generated
for await (const event of agent.runStream("Write a haiku about TypeScript")) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
}

// Conversational — multi-turn with memory
const session = agent.session();
await session.chat("What's 2+2?");
await session.chat("Now multiply that by 10");

// Gateway — persistent autonomous agents
const handle = agent.start();  // Runs forever with heartbeats, crons, webhooks
```

The framework gets out of your way. Simple things are simple. Complex things are possible. You never fight the API.

### 5. Type Safety as Reliability

```typescript
// TypeScript + Effect-TS = Zero runtime surprises
import { Effect } from "effect";

// All errors are typed — no uncaught exceptions
type AgentError =
  | ToolExecutionError
  | ReasoningError
  | ContextOverflowError
  | BudgetExceededError
  | RateLimitError;

// All side effects are explicit
const execute: Effect.Effect<AgentResult, AgentError, AgentServices>;

// Compile-time safety catches bugs before production
// Effect-TS layers compose services with guaranteed dependency resolution
```

### 6. Composition Over Configuration

```typescript
// 20 independent packages — compose only what you need
import { ReactiveAgents } from "reactive-agents";

// Minimal agent (reasoning only)
const simple = await ReactiveAgents.create()
  .withProvider("ollama")
  .build();

// Full-featured production agent
const production = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({ include: ["web-search", "code-execute"] })
  .withMemory("production-agent")
  .withGuardrails()
  .withCostTracking({ budget: { maxTokens: 100000 } })
  .withObservability({ verbosity: "normal", live: true })
  .withIdentity()
  .withGateway({
    heartbeat: { intervalMs: 3600000, policy: "adaptive" },
    crons: [{ schedule: "0 9 * * MON", instruction: "Weekly report" }],
  })
  .build();

// Every .with*() adds one composable layer
// Skip what you don't need — no bloat, no overhead
```

---

## The Eight Core Pillars

### 1. Control

Fine-grained control over every aspect of agent behavior:

- **Reasoning:** 5 strategies (ReAct, Plan-Execute, Tree-of-Thought, Reflexion, Adaptive) — swap at runtime
- **Context:** Model-adaptive profiles, budget tracking, progressive compaction
- **Tools:** Selection, filtering, sandboxing, MCP integration, custom tools
- **Memory:** 4-layer system (working, episodic, semantic, procedural)
- **Execution:** 10-phase engine with hookable lifecycle events
- **Quality:** Verification layers, behavioral contracts, completion guards

### 2. Observability

Complete visibility into agent operations:

- **EventBus:** 15+ event types published automatically (AgentStarted, ToolCallCompleted, FinalAnswerProduced, etc.)
- **Metrics Dashboard:** Professional CLI output with timing, token usage, cost, and alerts
- **Structured Logging:** Per-iteration progress with verbosity levels (minimal/normal/verbose/debug)
- **Real-time Streaming:** Live phase events during execution
- **Cost Attribution:** Track spending per agent, per task, per tool call
- **Execution Replay:** Full step history with context at each decision point

### 3. Flexibility

Adapt to any use case without fighting the framework:

- **Multiple Reasoning Strategies:** Choose or let the adaptive meta-strategy decide
- **Pluggable Components:** Swap any layer through Effect-TS service composition
- **Custom Tools:** Register tools with typed schemas, or connect MCP servers
- **Kernel SDK:** Register custom reasoning algorithms that integrate with all existing infrastructure
- **6 LLM Providers:** Anthropic, OpenAI, Google Gemini, Ollama, LiteLLM (40+ models), Test
- **Model Agnostic:** Same API regardless of provider

### 4. Scalability

Handle production workloads efficiently:

- **Concurrent Execution:** Effect-TS fibers for structured concurrency
- **Persistent Gateway:** Long-running agents with heartbeats, crons, webhooks, and policy enforcement
- **Multi-Agent Orchestration:** A2A protocol for typed agent-to-agent communication
- **Agent-as-Tool:** Delegate sub-tasks to specialized sub-agents
- **Resource Management:** Token budgets, iteration caps, timeout controls

### 5. Reliability

Graceful handling of failures:

- **Effect-TS:** Every error is typed — no uncaught exceptions, no mystery crashes
- **Circuit Breakers:** Detect stuck loops and break out automatically
- **Completion Guards:** Verify task coverage before accepting a final answer
- **Kill Switch:** Pause, resume, stop, or terminate agents at any time
- **HITL Escalation:** Human-in-the-loop checkpoints for critical decisions
- **Behavioral Contracts:** Define what agents can and cannot do

### 6. Efficiency

Optimize for performance and cost:

- **Model-Adaptive Context:** Profiles tune prompt density per model tier
- **Smart Token Budgeting:** Per-iteration tracking with budget enforcement
- **Tool Result Compression:** Structured previews instead of blind truncation
- **Semantic Caching:** Avoid redundant LLM calls for similar queries
- **Context Compaction:** LLM-based summarization when context grows large
- **Cost Routing:** Complexity analysis routes tasks to appropriate model tiers

### 7. Security

Production-grade security by default:

- **Agent Identity:** Real Ed25519 cryptographic certificates
- **Sandboxed Execution:** Subprocess isolation for code execution
- **Input/Output Sanitization:** Prompt injection detection, PII masking, toxicity filtering
- **Guardrails:** Configurable safety layers that run before and after each step
- **Audit Logging:** Full compliance trail via EventBus
- **Rate Limiting:** Budget enforcement prevents runaway costs

### 8. Speed

Built on modern, fast runtime:

- **Bun Runtime:** Native TypeScript, fast cold starts, built-in test runner
- **Effect-TS Fibers:** Structured concurrency without callback hell
- **Real-time Streaming:** Token-by-token output via FiberRef-based TextDelta propagation
- **SSE in One Line:** `AgentStream.toSSE(agent.runStream(prompt))` — instant HTTP streaming
- **Parallel Tool Execution:** Multiple tool calls run concurrently when independent

---

## What We've Shipped

An honest inventory of what's built, what's in progress, and what's planned:

| Capability | Status | Since |
|-----------|--------|-------|
| 5 reasoning strategies + adaptive meta-strategy | **Shipped** | v0.3 |
| 6 LLM providers (Anthropic, OpenAI, Gemini, Ollama, LiteLLM, Test) | **Shipped** | v0.5 |
| 4-layer memory system (working, episodic, semantic, procedural) | **Shipped** | v0.2 |
| Real-time token streaming + SSE adapters | **Shipped** | v0.6 |
| Persistent gateway (heartbeats, crons, webhooks, policies) | **Shipped** | v0.5.6 |
| Context engine with model-adaptive profiles (4 tiers) | **Shipped** | v0.7 |
| Agent debrief synthesis + SQLite persistence | **Shipped** | v0.8 |
| Conversational chat (`agent.chat()`, `agent.session()`) | **Shipped** | v0.8 |
| A2A multi-agent protocol (JSON-RPC 2.0, Agent Cards) | **Shipped** | v0.5 |
| Production guardrails (injection, PII, toxicity) | **Shipped** | v0.5 |
| Ed25519 agent identity + RBAC | **Shipped** | v0.5.2 |
| Cost tracking + budget enforcement | **Shipped** | v0.5 |
| Composable kernel SDK (custom reasoning algorithms) | **Shipped** | v0.7 |
| Professional metrics dashboard (EventBus-driven) | **Shipped** | v0.6 |
| Cross-agent experience learning (ExperienceStore) | **Shipped** | v0.7 |
| Memory consolidation + background decay | **Shipped** | v0.7 |
| Hallucination detection (semantic entropy, fact decomposition) | **Shipped** | v0.5 |
| CLI (`rax init`, `rax run`, `rax create`) | **Shipped** | v0.4 |
| Published benchmarks (SLM vs. frontier, 20 tasks) | **In Progress** | v0.9 |
| Docker code sandbox (full isolation) | **Planned** | v0.9 |
| Programmatic tool calling (token reduction) | **Planned** | v0.9 |
| React/UI integration (`useAgent()` hooks) | **Planned** | v1.0+ |

**1,773 tests across 217 files. 20 packages + 2 apps. MIT licensed.**

---

## What Makes Us Different

Honest comparison based on shipped features:

| Feature | LangChain JS | Vercel AI SDK | Mastra | **Reactive Agents** |
|---------|-------------|---------------|--------|---------------------|
| Reasoning strategies | 1 (ReAct) | 1 (generate) | 1 (step) | **5 + adaptive** |
| Model-adaptive context | No | No | No | **Yes (4 tiers)** |
| Type-safe errors | No | Partial (Zod) | Partial | **Effect-TS (full)** |
| Persistent gateway | No | No | Workflows | **Heartbeats + crons + webhooks** |
| Memory system | Vector only | None | Basic KV | **4-layer + Zettelkasten + FTS5** |
| Local model optimization | Basic | None | None | **Context profiles + compaction** |
| Observability | LangSmith (paid) | None built-in | Mastra Studio | **Built-in (EventBus + OTel)** |
| Agent identity | No | No | No | **Ed25519 crypto** |
| Multi-agent protocol | No | No | No | **A2A (JSON-RPC 2.0)** |
| Token streaming | Yes | Yes | Yes | **Yes (FiberRef-based)** |
| Cost tracking | No | No | Basic | **Budget enforcement + routing** |
| Guardrails | No | No | No | **Injection + PII + toxicity** |

Our real moat isn't any single feature — it's the **architectural philosophy**. Effect-TS composition, typed errors, a 10-phase execution engine, and model-adaptive intelligence. This appeals to engineers who want control over their agents, not a black box that works until it doesn't.

---

## Target Audience

### Primary: Developers Building with AI

**Anyone who wants to add AI agent capabilities to their applications:**

- Full-stack developers adding AI features
- Backend engineers building automation
- Startup teams shipping AI-first products
- Side project builders and indie hackers

**They need:** Quick setup, clear APIs, good docs, predictable behavior, reasonable costs.

**They get:** 60 seconds to first working agent. Builder API that reads like English. Observable execution. Works with their existing model provider.

### Secondary: Hobbyists & Researchers

**People exploring what agents can do:**

- AI enthusiasts running local models
- Researchers experimenting with reasoning strategies
- Open-source contributors
- Students learning agent architectures

**They need:** Flexibility, extensibility, local model support, good DX for experimentation.

**They get:** 5 swappable reasoning strategies. Kernel SDK for custom algorithms. Ollama + LiteLLM for local models. Composable architecture they can pull apart and study.

### Tertiary: Production Teams & Enterprise

**Teams deploying agents at scale:**

- SaaS companies with AI features
- Enterprise internal tooling teams
- DevOps teams automating operations

**They need:** Reliability, observability, security, cost controls, compliance.

**They get:** Effect-TS typed errors. Full EventBus tracing. Ed25519 identity. Budget enforcement. Guardrails. Kill switch. Behavioral contracts.

---

## DX Philosophy

### The 60-Second Experience

A developer should go from zero to working agent in under a minute:

```bash
npx rax init my-agent
cd my-agent
# Edit .env with your API key
bun run start
```

That's it. A working agent with tools and observability, ready to extend.

### Progressive Disclosure

The API reveals complexity only when you need it:

```typescript
// Level 1: Just works
const agent = await ReactiveAgents.create().withProvider("anthropic").build();
await agent.run("Hello");

// Level 2: Add capabilities as needed
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .build();

// Level 3: Full production configuration
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({ include: ["web-search"], custom: [myTool] })
  .withMemory("my-agent")
  .withGuardrails()
  .withCostTracking({ budget: { maxTokens: 50000 } })
  .withObservability({ verbosity: "normal", live: true })
  .withGateway({ heartbeat: { intervalMs: 3600000 } })
  .build();
```

Each `.with*()` adds one concern. Skip what you don't need. No framework tax.

### Error Messages That Help

When something goes wrong, the framework tells you what happened *and* what to do about it:

- Effect-TS typed errors mean every failure mode is documented at compile time
- Observability dashboard highlights bottlenecks and suggests optimizations
- Circuit breakers explain why they tripped, not just that they did

### No Vendor Lock-In

Switch LLM providers by changing one line. Switch from cloud to local with one line. The framework adapts — your code doesn't change.

---

## Future Vision

What we're building next — features that excite us and will make the framework even more powerful:

### Programmatic Tool Calling (v0.9)

LLM generates executable code blocks instead of verbose tool call chains. 30-50% token reduction, especially impactful for local models where every token counts.

### Published Benchmark Suite (v0.9)

20-task benchmark across 5 model tiers (local 8B through frontier). Public, reproducible results showing how model-adaptive engineering narrows the performance gap between small and large models.

### Docker Code Sandbox (v0.9)

Full container isolation for code execution tools. Network controls, memory limits, and time limits. Safe enough for production code generation agents.

### React/UI Integration (v1.0+)

`useAgent()`, `useAgentStream()`, `useAgentMemory()` — React hooks that make building agent-powered UIs trivial. Server-side streaming to client components.

### Strategy Evolution (v1.1+)

Agents that improve their own reasoning approach over time. The ExperienceStore already captures cross-agent tool patterns — the next step is feeding that back into strategy selection and prompt optimization automatically.

### Expanded Local Model Optimization (Ongoing)

This is a core research direction, not a one-time feature. Quantization-aware context tuning, speculative tool calling, model-specific prompt templates, and aggressive caching strategies that make 8B models increasingly capable.

---

## Design Principles

### 1. Explicit Over Implicit

Every behavior should be visible and controllable. No hidden magic.

### 2. Composable Over Monolithic

Build complex capabilities from simple, reusable layers. 20 packages, each with one job.

### 3. Observable Over Opaque

Full visibility into what agents are doing and why. If you can't see it, you can't fix it.

### 4. Testable Over Clever

Every component should be independently testable with clear contracts. 1,773 tests prove this works.

### 5. Efficient Over Wasteful

Optimize for token usage, latency, and cost by default. Especially for smaller models where waste compounds.

### 6. Secure Over Convenient

Security and isolation as first-class concerns. Ed25519 identity, sandboxed execution, guardrails.

### 7. Production-First

Built for scale, reliability, and real-world deployment from day one. Not a research toy.

### 8. Local-First

Optimize for local and edge models. Cloud is an option, not a requirement.

---

## Adoption-First Strategy

Monetization follows adoption. The priority order is clear:

**Phase 1: Build the community (Now → v1.0)**
- Ship fast, ship often. Get the framework into developers' hands.
- Polish the 60-second experience. README, examples, `rax init`.
- Publish benchmarks that demonstrate the model-adaptive advantage.
- Show HN, Reddit, awesome-list submissions, dev.to articles.
- Discord community for support and feedback.

**Phase 2: Prove value (v1.0 → v1.2)**
- 1,000+ active developers using the framework.
- Case studies from real production deployments.
- Published benchmark results comparing model tiers.
- Community contributions and ecosystem growth.

**Phase 3: Sustainable revenue (v1.2+)**
- Open-core model: framework stays MIT, commercial layer optional.
- Hosted observability dashboard and visual debugger.
- Premium agent templates and production recipes.
- Cloud deployment (`rax deploy`) for managed agent hosting.
- Enterprise features (SSO, audit, compliance) when demand exists.
- Consulting and optimization services.

The framework will always be free and open source. Commercial features serve teams who need more — they don't gate the core experience.

---

## Success Metrics

### Adoption (Year 1)

- **1,000+ GitHub stars**
- **500+ npm weekly downloads**
- **50+ production deployments**
- **20+ community contributors**
- **Active Discord** with weekly engagement

### Technical Performance

- **<100ms** agent creation time
- **<50ms** per reasoning step overhead
- **<15 iterations** for standard tasks (shipped: 10 avg)
- **100% tool success rate** (shipped: 100% after v0.8 fixes)
- **Competitive benchmark results** across model tiers

### Community Health

- **Responsive issue resolution** (<48hr first response)
- **Regular releases** (bi-weekly cadence)
- **Growing contributor base**
- **Positive developer sentiment**

### Business (When Applicable)

- **$35K MRR** quit-job threshold (12-18 months post-adoption)
- **Sustainable open-core model** that doesn't compromise the community

---

## What We're Building

### We ARE

- An open-source, composable agent orchestration framework
- A TypeScript/Bun library with Effect-TS type safety
- A production-grade toolkit for building reliable AI agents
- A model-adaptive system that makes any LLM more capable
- A community-driven project that ships fast and iterates on feedback

### We're NOT

- A black-box "just add API key" magic solution
- A low-code/no-code platform
- A replacement for LLM APIs
- A data pipeline or ML training tool
- A framework that only works with expensive frontier models

---

## The Promise

**Reactive Agents proves that production AI agents don't require magic — they require engineering.**

Not bigger models. Not black boxes. But:

- **Control** over every decision
- **Observability** into every action
- **Intelligence** through model-adaptive engineering
- **Reliability** through type safety and composable architecture
- **Performance** via modern runtimes
- **Efficiency** that makes smaller models punch above their weight
- **DX** that makes building agents genuinely enjoyable

**Other frameworks:**
```
Deploy → Hope → Fail → Debug → Repeat
Locked to frontier models for decent results
```

**Reactive Agents:**
```
Configure → Observe → Control → Deploy → Trust
Any model, optimized for its tier, observable end-to-end
```

---

## Guiding Quotes

> "Make it work, make it right, make it fast."
> — Kent Beck

> "Simplicity is prerequisite for reliability."
> — Edsger Dijkstra

> "The best way to predict the future is to invent it."
> — Alan Kay

> "If you can't explain it simply, you don't understand it well enough."
> — Richard Feynman

---

## Let's Build The Future

**Reactive Agents is the framework that makes AI agents:**

1. **Controllable** — every decision visible and steerable
2. **Reliable** — typed errors, circuit breakers, completion guards
3. **Efficient** — model-adaptive engineering, not brute-force tokens
4. **Observable** — know what your agent is doing and why
5. **Accessible** — great DX from first minute to production deployment

**The open-source agent framework built for control, not magic.**

---

_Version: 3.0.0_
_Last Updated: 2026-03-11_
_Status: FOUNDATION DOCUMENT_
_Authors: Tyler Buell, Community Contributors_
_License: MIT_

---

## Related Documents

- **Core Pillars:** See `02-CORE-PILLARS.md`
- **Business Model:** See `REACTIVE_AGENTS_BUSINESS_MODEL.md` *(needs update to match this vision)*
- **Technical Specs:** See `REACTIVE_AGENTS_TECHNICAL_SPECS.md`
- **Architecture:** See `architecture-reference` skill
- **Adoption Strategy:** See `docs/plans/2026-03-05-adoption-strategy.md`
- **Roadmap:** See `ROADMAP.md`
