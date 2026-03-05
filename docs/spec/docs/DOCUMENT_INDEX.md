# Reactive Agents: Document Index

## Reading Order for AI Agents

Read in this exact order:

### 1. Entry Points (read first)

| #   | File                               | Purpose                                                 |
| --- | ---------------------------------- | ------------------------------------------------------- |
| 0   | `00-monorepo-setup.md`             | **Run first:** Workspace scaffolding, root configs, package templates, dependency map |
| 1   | `START_HERE_AI_AGENTS.md`          | **Entry point:** Solo + Agent Team build modes, phase launch prompts, build order, checklists |
| 2   | `00-master-architecture.md`        | System overview, layer diagram, data flow, dependencies |
| 3   | `implementation-guide-complete.md` | 14-week build plan, Effect-TS patterns, troubleshooting |
| 4   | `FRAMEWORK_USAGE_GUIDE.md`         | **Public API usage guide**: createRuntime() builder, agent creation, task execution, LLM/memory/tools/interaction configuration, lifecycle hooks, multi-agent orchestration, testing patterns, complete examples |

### 2. Layer Specs (read when implementing each layer)

| #   | File                                           | Layer            | Package                          | Description                                                                                                                                                                                        |
| --- | ---------------------------------------------- | ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | `layer-01-core-detailed-design.md`             | L1 Core          | `@reactive-agents/core`          | Schema types, branded IDs, EventBus, AgentService, TaskService, CoreServicesLive. Build Order: 14 steps.                                                                                           |
| 6   | `01.5-layer-llm-provider.md`                   | L1.5 LLM         | `@reactive-agents/llm-provider`  | Unified LLMService (complete/stream/structured/embed), AnthropicProvider, OpenAIProvider, TestLLMService, retry + circuit breaker. Build Order: 13 steps.                                          |
| 7   | `02-layer-memory.md`                           | L2 Memory        | `@reactive-agents/memory`        | Working memory (7 items FIFO), Semantic (SQLite + memory.md), Episodic (daily logs + snapshots), Zettelkasten auto-linking. Tier 1 (FTS5) / Tier 2 (sqlite-vec). Build Order: 17 steps.           |
| 8   | `03-layer-reasoning.md`                        | L3 Reasoning     | `@reactive-agents/reasoning`     | 5 pure Effect strategy functions (Reactive, PlanExecuteReflect, TreeOfThought, Reflexion, Adaptive), StrategySelector, EffectivenessTracker. Build Order: 17 steps.                                |
| 9   | `04-layer-verification.md`                     | L4 Verification  | `@reactive-agents/verification`  | 5-layer hallucination detection (semantic entropy, fact decomposition, multi-source, self-consistency, NLI), adaptive risk selection. Gold standard format.                                        |
| 10  | `05-layer-cost.md`                             | L5 Cost          | `@reactive-agents/cost`          | Complexity-based model routing, semantic cache (95% threshold), prompt compression (60% target), budget enforcement, real-time analytics.                                                          |
| 11  | `06-layer-identity.md`                         | L6 Identity      | `@reactive-agents/identity`      | Ed25519 certificate-based auth, RBAC, immutable audit logs, delegation chains, credential rotation (7 days).                                                                                       |
| 12  | `07-layer-orchestration.md`                    | L7 Orchestration | `@reactive-agents/orchestration` | 6 Anthropic workflow patterns, agent mesh, durable execution (event sourcing), human-in-loop, A2A protocol support.                                                                                |
| 13  | `08-layer-tools.md`                            | L8 Tools         | `@reactive-agents/tools`         | MCP client (protocol v1.0), OpenAI-compatible function calling, skill bundles, tool registry with dynamic discovery.                                                                               |
| 14  | `09-layer-observability.md`                    | L9 Observability | `@reactive-agents/observability` | OpenTelemetry integration, W3C distributed tracing, structured JSON logging, cost/latency/accuracy metrics.                                                                                        |
| 15  | `layer-10-interaction-revolutionary-design.md` | L10 Interaction  | `@reactive-agents/interaction`   | 5 interaction modes (autonomous → interrogative), adaptive switching with escalation/de-escalation rules, checkpoint approval, preference learning, collaboration sessions. Build Order: 17 steps. |

### 3. Enhancement Specs

| #   | File                                     | Packages                               | Description                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16  | `11-missing-capabilities-enhancement.md` | `guardrails`, `eval`, `prompts`, `cli` | **Package 1:** Agent contracts, PII detection, prompt injection defense, `guarded()` wrapper. **Package 2:** LLM-as-judge eval, regression detection, benchmarking. **Package 3:** Prompt templates, versioning, composition. **Extension 4-6:** AgentLearningService (→reasoning), ContextWindowManager (→core), StreamingService (→core). **Extension 7:** CLI scaffolding, dev server, playground. |

### 4. Context Documents (reference only)

| #   | File                                                    | Purpose                                                                                    |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 17  | `12-market-validation-feb-2026.md`                      | Feb 2026 market research: 13 competitors analyzed, 3-tier competitive advantage validation |
| 18  | `reactive-agents-complete-competitive-analysis-2026.md` | Detailed competitive analysis                                                              |
| 19  | `implementation-ready-summary.md`                       | Design decisions and competitive edge summary                                              |
| 20  | `PLAN_REVIEW.md`                                        | Original spec review with identified improvements (historical)                             |

---

## Spec Format

All layer specs (items 4-15) follow the same structure:

1. **Overview** — purpose, responsibilities
2. **Package Structure** — directory layout
3. **Build Order** — numbered implementation steps (follow exactly)
4. **Types** — `Schema.Struct` definitions with full code
5. **Errors** — `Data.TaggedError` definitions with full code
6. **Services** — `Context.Tag` + `Layer.effect` implementations with full code
7. **Runtime** — `createXxxLayer()` factory function
8. **Tests** — test patterns with vitest
9. **Package.json** — exact dependencies

---

## Total Packages

| Category             | Count  | Packages                                                                                                              |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Core layers          | 11     | core, llm-provider, memory, reasoning, verification, cost, identity, orchestration, tools, observability, interaction |
| Enhancement packages | 3      | guardrails, eval, prompts                                                                                             |
| Apps                 | 1      | cli                                                                                                                   |
| **Total**            | **15** |                                                                                                                       |
