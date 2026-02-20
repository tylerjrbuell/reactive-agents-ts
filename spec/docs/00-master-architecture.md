# Reactive Agents: System Architecture

## AI-Agent Implementation Blueprint

---

## Executive Summary

TypeScript-first AI agent framework with a 10-layer architecture and 13 unique competitive advantages. Built on Effect-TS for type-safe composition, error handling, and dependency injection.

**13 Competitive Advantages (validated Feb 2026):**

1. Multi-strategy reasoning with AI selection (5 strategies)
2. 5-layer hallucination verification
3. Cost-first architecture (10x reduction target)
4. Agentic Zettelkasten memory
5. Certificate-based agent identity
6. Multi-modal adaptive interaction (5 modes)
7. Agent behavioral contracts & guardrails
8. Built-in evaluation & benchmarking
9. CLI, playground, and scaffolding
10. Versioned prompt engineering system
11. Cross-task self-improvement loop
12. Context window intelligence
13. Full-stack streaming architecture

**Stack:** TypeScript + Effect-TS + Bun | **Target:** Production-ready in 14 weeks

---

## 10-Layer + Enhancements Stack

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 10: INTERACTION (Multi-Modal Human-Agent Interface)   │
│ ├─ 5 Modes: Autonomous, Supervised, Collaborative,         │
│ │   Consultative, Interrogative + Adaptive switching        │
│ ├─ Checkpoint-based approval, preference learning           │
│ └─ Spec: layer-10-interaction-revolutionary-design.md       │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 9: OBSERVABILITY (OpenTelemetry)                      │
│ ├─ Distributed tracing (W3C), structured logging (JSON)     │
│ ├─ Metrics (cost, latency, accuracy), debugging             │
│ └─ Spec: 09-layer-observability.md                          │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 8: TOOLS & INTEGRATION (MCP Protocol)                 │
│ ├─ MCP client, function calling, skill bundles, registry    │
│ └─ Spec: 08-layer-tools.md                                  │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 7: ORCHESTRATION (Multi-Agent + A2A Protocol)         │
│ ├─ Workflows (6 Anthropic patterns), agent mesh, A2A       │
│ ├─ Durable execution (event sourcing), human-in-loop       │
│ └─ Spec: 07-layer-orchestration.md                          │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 6: IDENTITY (Security & Governance)                   │
│ ├─ Ed25519 certificates, RBAC, immutable audit logs         │
│ ├─ Delegation chains, credential rotation (7 days)          │
│ └─ Spec: 06-layer-identity.md                               │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 5: COST OPTIMIZATION (Multi-Layered)                  │
│ ├─ Complexity routing, semantic cache (95%), compression    │
│ ├─ Budget enforcement (hard limits), real-time analytics    │
│ └─ Spec: 05-layer-cost.md                                   │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: VERIFICATION (5-Layer Detection)                   │
│ ├─ Semantic entropy, fact decomposition, multi-source       │
│ ├─ Self-consistency (3x gen), NLI entailment, adaptive      │
│ └─ Spec: 04-layer-verification.md                           │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: REASONING (Multi-Strategy Engine)                  │
│ ├─ 5 pure Effect functions: Reactive, PlanExecuteReflect,   │
│ │   TreeOfThought, Reflexion, Adaptive                      │
│ ├─ StrategySelector (LLM-driven), EffectivenessTracker      │
│ └─ Spec: 03-layer-reasoning.md                              │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: MEMORY (SQLite-First System)                       │
│ ├─ 4 types: Semantic, Episodic, Procedural, Working (cap 7) │
│ ├─ Tier 1: bun:sqlite + FTS5 (zero external deps)          │
│ ├─ Tier 2: bun:sqlite + FTS5 + sqlite-vec (KNN search)     │
│ ├─ Zettelkasten link graph in SQLite, ZettelkastenService   │
│ └─ Spec: 02-layer-memory.md                                 │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 1.5: LLM PROVIDER (Abstraction Layer)                 │
│ ├─ Unified LLMService: complete/stream/structured/embed     │
│ ├─ AnthropicProvider, OpenAIProvider, TestLLMService        │
│ └─ Spec: 01.5-layer-llm-provider.md                        │
└─────────────────────────────────────────────────────────────┘
         ▲                    │
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: CORE (Effect-TS Foundation)                        │
│ ├─ Schema types, branded IDs, TaggedErrors, EventBus        │
│ ├─ AgentService, TaskService, ContextWindowManager          │
│ └─ Spec: layer-01-core-detailed-design.md                   │
└─────────────────────────────────────────────────────────────┘

Runtime Package (top-level orchestrator):
┌─────────────────────────────────────────────────────────────┐
│ @reactive-agents/runtime — ExecutionEngine (agent loop)     │
│ ├─ 10-phase execution: bootstrap → guardrail → cost-route   │
│ │   → strategy-select → think/act/observe → verify          │
│ │   → memory-flush → cost-track → audit → complete          │
│ ├─ LifecycleHooks (before/after/on-error per phase)         │
│ ├─ Agent State Machine (IDLE→RUNNING→COMPLETED/FAILED)      │
│ ├─ createRuntime() factory (composes ALL package layers)     │
│ └─ Spec: layer-01b-execution-engine.md                      │
└─────────────────────────────────────────────────────────────┘

Enhancement Packages:
┌─────────────────────────────────────────────────────────────┐
│ @reactive-agents/guardrails — Contracts, PII, injection     │
│ @reactive-agents/eval — LLM-as-judge, regression, benchmarks│
│ @reactive-agents/prompts — Templates, versioning, A/B       │
│ @reactive-agents/cli — Scaffolding, dev server, playground  │
│ Spec: 11-missing-capabilities-enhancement.md                │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Agent Execution Lifecycle

The `ExecutionEngine` (in `@reactive-agents/runtime`) runs the 10-phase agent loop.
Each phase maps to a lifecycle hook (before/after/on-error). See `layer-01b-execution-engine.md`.

### Example: Research Task with Adaptive Interaction

```
User Request (Layer 10)
    │
    ├─ InteractionManager.getMode() → "autonomous"
    │
    ▼
Task Creation (Layer 1)                          [ExecutionEngine Phase: —]
    │
    ├─ TaskService.create(task)
    ├─ TaskId: AgentId branded string
    │
    ▼
Phase 1: BOOTSTRAP (ExecutionEngine)             [ExecutionEngine Phase: bootstrap]
    │
    ├─ MemoryService.bootstrap(agentId)
    ├─ Loads: memory.md (semantic) + recent episodes + active workflows
    ├─ Returns: MemoryBootstrapResult → injected into system prompt
    │   (Memory context wrapped in cache_control if supportsPromptCaching)
    │
    ▼
Phase 2: GUARDRAIL CHECK (Guardrails Package)    [ExecutionEngine Phase: guardrail]
    │
    ├─ GuardrailService.checkInput(input, { agentId })
    ├─ Decision: "allow" (no policy violations)
    │
    ▼
Phase 3: COST ROUTE (Layer 5)                    [ExecutionEngine Phase: cost-route]
    │
    ├─ CostRouter.selectModel(task)
    ├─ Selected model: claude-sonnet-4-5
    │
    ▼
Phase 4: STRATEGY SELECT (Layer 3)               [ExecutionEngine Phase: strategy-select]
    │
    ├─ StrategySelector.select(selectionContext, memoryContext)
    ├─ Selected: "plan-execute-reflect" (confidence: 0.92)
    │
    ▼
Phase 5: AGENT LOOP — repeats until isComplete   [ExecutionEngine Phase: think/act/observe]
    │
    ├─ THINK: LLMService.complete(messages + memory context)
    ├─   → ReActAction: { thought, action, isComplete }
    ├─ ACT:   ToolService.execute(toolCall) → observation
    ├─   MCPClient.callTool("web-search", { query }) → 10 URLs
    ├─ OBSERVE: append observation to messages
    └─ LOOP CHECK: isComplete → exit loop
    │
    ▼
Phase 6: VERIFY (Layer 4)                        [ExecutionEngine Phase: verify]
    │
    ├─ VerificationService.verify(result, { riskLevel: "medium" })
    ├─ Layers used: semantic-entropy, multi-source
    ├─ Confidence: 0.91 → PASSED
    │
    ▼
Phase 7: MEMORY FLUSH (Layer 2)                  [ExecutionEngine Phase: memory-flush]
    │
    ├─ MemoryExtractor.evaluate(conversation) → conditionally writes to SQLite
    ├─ MemoryService.snapshot(sessionId, messages) → session snapshot
    ├─ ZettelkastenService.autoLink(newEntries) → link graph updated
    │
    ▼
Phase 8: COST TRACK (Layer 5)                    [ExecutionEngine Phase: cost-track]
    │
    ├─ CostTracker.record({ tokens: 1247, cost: 0.0062 })
    ├─ Cache hits saved $0.0023
    │
    ▼
Phase 9: AUDIT (Layer 6)                         [ExecutionEngine Phase: audit]
    │
    ├─ AuditService.log({ agentId, action: "research-complete", cost })
    │
    ▼
Phase 10: COMPLETE                               [ExecutionEngine Phase: complete]
    │
    ├─ Observability: TracingService span completed (12.3s)
    ├─ MetricsService: cost=$0.0039, accuracy=0.91
    ├─ EventBus.publish({ type: "task.completed", taskId, result })
    ├─ NotificationService.send({ title: "Research complete", priority: "low" })
    │
    ▼
Result Delivered
```

---

## Inter-Layer Dependencies

```
Layer 10 (Interaction)
  ├─ requires: Layer 1 (Core: EventBus)
  ├─ requires: Layer 3 (Reasoning: confidence metadata)
  ├─ requires: Layer 9 (Observability)
  └─ provides: InteractionManager, ModeSwitcher, NotificationService

Layer 9 (Observability)
  ├─ requires: Layer 1 (Core: base types)
  └─ provides: TracingService, MetricsService, LoggingService

Layer 8 (Tools)
  ├─ requires: Layer 1 (Core)
  ├─ requires: Layer 6 (Identity: authorization)
  └─ provides: MCPClient, ToolRegistry, FunctionCallingService

Layer 7 (Orchestration)
  ├─ requires: Layer 1 (Core), Layer 1.5 (LLM)
  ├─ requires: Layer 6 (Identity), Layer 8 (Tools)
  └─ provides: WorkflowEngine, AgentMesh, DurableExecution, A2AService

Layer 6 (Identity)
  ├─ requires: Layer 1 (Core)
  └─ provides: CertificateService, AuthService, AuditService, DelegationService

Layer 5 (Cost)
  ├─ requires: Layer 1 (Core), Layer 1.5 (LLM)
  └─ provides: CostRouter, SemanticCache, BudgetEnforcer, CostTracker

Layer 4 (Verification)
  ├─ requires: Layer 1 (Core), Layer 1.5 (LLM), Layer 2 (Memory)
  └─ provides: VerificationService, 5 verification layers

Layer 3 (Reasoning)
  ├─ requires: Layer 1 (Core), Layer 1.5 (LLM), Layer 2 (Memory)
  └─ provides: ReasoningService, StrategySelector, StrategyRegistry

Layer 2 (Memory)
  ├─ requires: Layer 1 (Core)
  ├─ optional: Layer 1.5 (LLM) — embed() for Tier 2 KNN; Tier 1 (FTS5-only) does not need LLM
  └─ provides: MemoryService, WorkingMemoryService, SemanticMemoryService,
               EpisodicMemoryService, ProceduralMemoryService, ZettelkastenService

Layer 1.5 (LLM Provider)
  ├─ requires: Layer 1 (Core)
  └─ provides: LLMService (complete, stream, structured, embed), LLMConfig, EmbeddingConfig

Layer 1 (Core)
  ├─ requires: effect (npm)
  └─ provides: EventBus, AgentService, TaskService, ContextWindowManager, CoreServicesLive

@reactive-agents/runtime (ExecutionEngine — top-level orchestrator)
  ├─ requires: ALL layers (Layer 1 through Layer 10 + Guardrails)
  ├─ NOTE: All other packages have zero upward dependencies. Runtime is the sole top.
  └─ provides: ExecutionEngine, LifecycleHookRegistry, createRuntime()

Guardrails
  ├─ requires: Layer 1 (Core)
  └─ provides: GuardrailService, PolicyEngine

Eval
  ├─ requires: Layer 1 (Core), Layer 1.5 (LLM)
  └─ provides: EvalService

Prompts
  ├─ requires: Layer 1 (Core)
  └─ provides: PromptService
```

---

## Package Structure (Monorepo)

```
reactive-agents/
├── packages/
│   ├── core/                    # Layer 1
│   ├── llm-provider/            # Layer 1.5
│   ├── memory/                  # Layer 2
│   ├── reasoning/               # Layer 3
│   ├── verification/            # Layer 4
│   ├── cost/                    # Layer 5
│   ├── identity/                # Layer 6
│   ├── orchestration/           # Layer 7
│   ├── tools/                   # Layer 8
│   ├── observability/           # Layer 9
│   ├── interaction/             # Layer 10
│   ├── runtime/                 # ExecutionEngine (top-level orchestrator)
│   ├── guardrails/              # Enhancement: safety contracts
│   ├── eval/                    # Enhancement: benchmarking
│   └── prompts/                 # Enhancement: prompt templates
├── apps/
│   ├── cli/                     # CLI tool
│   ├── dashboard/               # Web dashboard
│   └── examples/                # Example apps
├── package.json                 # Workspace root (bun workspaces)
├── tsconfig.json                # Shared TypeScript config
└── bun.lockb
```

---

## Event Bus Contract

All layers communicate via a typed EventBus (defined in Layer 1 Core spec). Key event types:

```typescript
type SystemEvent =
  // Layer 1
  | { type: "agent.created"; agentId: AgentId }
  | { type: "task.started"; taskId: TaskId; agentId: AgentId }
  | { type: "task.completed"; taskId: TaskId; result: TaskResult }
  // Layer 2
  | { type: "memory.stored"; entry: MemoryEntry }
  | { type: "memory.linked"; sourceId: string; targetId: string }
  // Layer 3
  | { type: "reasoning.strategy-selected"; strategy: ReasoningStrategy }
  | { type: "reasoning.step-completed"; step: ReasoningStep }
  // Layer 4
  | { type: "verification.completed"; passed: boolean; confidence: number }
  // Layer 5
  | { type: "cost.tracked"; cost: number; tokens: number }
  | { type: "cost.budget-exceeded"; limit: number; actual: number }
  // Layer 6
  | { type: "identity.authenticated"; agentId: AgentId }
  | { type: "identity.audit-logged"; entry: AuditEntry }
  // Layer 7
  | { type: "orchestration.workflow-started"; workflowId: string }
  | { type: "orchestration.agent-spawned"; parentId: AgentId; childId: AgentId }
  // Layer 8
  | { type: "tools.called"; tool: string; input: unknown }
  | { type: "tools.completed"; tool: string; result: unknown }
  // Layer 9
  | { type: "observability.trace-started"; traceId: string }
  // Layer 10
  | { type: "interaction.mode-changed"; mode: InteractionModeType }
  | { type: "interaction.checkpoint-created"; checkpointId: string };
```

The `EventBus` is a `Context.Tag` service with `publish` and `subscribe` methods, implemented via `Layer.effect` with a `Ref`-based subscriber map. See `layer-01-core-detailed-design.md` for full implementation.

---

## Configuration System

All configuration is defined via `Schema.Struct` in each layer's spec. Key defaults:

| Config                      | Value                                  | Layer            |
| --------------------------- | -------------------------------------- | ---------------- |
| Working memory capacity     | 7 items (FIFO/LRU/importance)          | L2 Memory        |
| Zettelkasten link threshold | 0.85 similarity                        | L2 Memory        |
| Semantic memory importance  | 0.7 threshold                          | L2 Memory        |
| Memory storage              | bun:sqlite (WAL mode, single .db file) | L2 Memory        |
| Embedding (Tier 2 only)     | text-embedding-3-small (1536 dims)     | L2 Memory / L1.5 |
| Vector search               | sqlite-vec (KNN, Tier 2 only)          | L2 Memory        |
| Max agent loop iterations   | 10                                     | Runtime          |
| Max reactive thoughts       | 10                                     | L3 Reasoning     |
| Verification layers         | 5 (adaptive selection)                 | L4 Verification  |
| Semantic cache threshold    | 0.95 similarity                        | L5 Cost          |
| Prompt compression          | 0.6 target ratio                       | L5 Cost          |
| Certificate rotation        | 7 days                                 | L6 Identity      |
| Audit retention             | 90 days                                | L6 Identity      |
| Checkpoint interval         | 30000ms                                | L7 Orchestration |
| MCP protocol                | v1.0                                   | L8 Tools         |
| Trace sample rate           | 1.0 (100%)                             | L9 Observability |
| Default interaction mode    | autonomous                             | L10 Interaction  |

---

## Performance Targets

| Layer            | Metric             | Target     |
| ---------------- | ------------------ | ---------- |
| L1 Core          | Agent creation     | <10ms p95  |
| L1.5 LLM         | Provider switch    | <5ms p95   |
| L2 Memory        | Bootstrap (Tier 1) | <2ms p95   |
| L2 Memory        | Bootstrap (Tier 2) | <10ms p95  |
| L2 Memory        | FTS5 search        | <5ms p95   |
| L3 Reasoning     | Strategy selection | <100ms p95 |
| L4 Verification  | 5-layer check      | <2s p95    |
| L5 Cost          | Cache hit rate     | >80%       |
| L6 Identity      | Auth check         | <5ms p95   |
| L7 Orchestration | Agent spawn        | <50ms p95  |
| L8 Tools         | Tool call          | <500ms p95 |
| L9 Observability | Tracing overhead   | <1%        |
| L10 Interaction  | Mode switch        | <10ms p95  |

---

## Implementation Sequence

See `implementation-guide-complete.md` for the detailed 14-week phased build order.

**Phase 1 (Weeks 1-4):** L1 Core + L1.5 LLM → L2 Memory (SQLite Tier 1) → L8 Tools → L3 Reasoning (Reactive) → L10 Interaction (Autonomous) → `@reactive-agents/runtime` (ExecutionEngine)
**Phase 2 (Weeks 5-9):** L3 All Strategies + Guardrails → L4 Verification + Eval → L5 Cost → L2 Memory Tier 2 (sqlite-vec)
**Phase 3 (Weeks 10-14):** L6 Identity → L7 Orchestration → L9 Observability + Prompts → L10 All Modes + CLI

---

## Document Map

| Document                                       | Purpose                                    |
| ---------------------------------------------- | ------------------------------------------ |
| `START_HERE_AI_AGENTS.md`                      | Entry point — reading order + quick start  |
| `00-master-architecture.md`                    | This file — system overview                |
| `implementation-guide-complete.md`             | 14-week build plan + patterns              |
| `layer-01-core-detailed-design.md`             | Layer 1 spec (foundation)                  |
| `layer-01b-execution-engine.md`                | Runtime spec (ExecutionEngine, agent loop) |
| `01.5-layer-llm-provider.md`                   | Layer 1.5 spec (LLM abstraction)           |
| `02-layer-memory.md`                           | Layer 2 spec (memory system)               |
| `03-layer-reasoning.md`                        | Layer 3 spec (reasoning engine)            |
| `04-layer-verification.md`                     | Layer 4 spec (verification)                |
| `05-layer-cost.md`                             | Layer 5 spec (cost optimization)           |
| `06-layer-identity.md`                         | Layer 6 spec (identity & auth)             |
| `07-layer-orchestration.md`                    | Layer 7 spec (multi-agent + A2A)           |
| `08-layer-tools.md`                            | Layer 8 spec (MCP tools)                   |
| `09-layer-observability.md`                    | Layer 9 spec (observability)               |
| `layer-10-interaction-revolutionary-design.md` | Layer 10 spec (interaction)                |
| `11-missing-capabilities-enhancement.md`       | Enhancement packages spec                  |
| `12-market-validation-feb-2026.md`             | Market research validation                 |
