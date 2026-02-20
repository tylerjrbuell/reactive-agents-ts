# Reactive Agents: Implementation Guide

## For AI Coding Agents

---

## Mission

Build a TypeScript-first AI agent framework with **10 layers + 3 enhancement packages** in 14 weeks.

**Stack:** TypeScript + Effect-TS + Bun
**Runtime:** Bun workspaces monorepo
**Key Pattern:** All services use `Context.Tag` + `Layer.effect`, all types use `Schema.Struct`, all errors use `Data.TaggedError`

**CRITICAL:** Every layer spec contains the exact code to implement. Do NOT invent your own patterns — copy from the specs.

---

## Package Map

### Core Layers (packages/)

| Package                          | Layer        | Spec File                                      | Phase                                            |
| -------------------------------- | ------------ | ---------------------------------------------- | ------------------------------------------------ |
| `@reactive-agents/core`          | Layer 1      | `layer-01-core-detailed-design.md`             | P1 W1-2                                          |
| `@reactive-agents/llm-provider`  | Layer 1.5    | `01.5-layer-llm-provider.md`                   | P1 W1-2                                          |
| `@reactive-agents/memory`        | Layer 2      | `02-layer-memory.md`                           | P1 W2-3                                          |
| `@reactive-agents/reasoning`     | Layer 3      | `03-layer-reasoning.md`                        | P1 W3-4                                          |
| `@reactive-agents/verification`  | Layer 4      | `04-layer-verification.md`                     | P2 W6-8                                          |
| `@reactive-agents/cost`          | Layer 5      | `05-layer-cost.md`                             | P2 W8-9                                          |
| `@reactive-agents/identity`      | Layer 6      | `06-layer-identity.md`                         | P3 W10-11                                        |
| `@reactive-agents/orchestration` | Layer 7      | `07-layer-orchestration.md`                    | P3 W11-13                                        |
| `@reactive-agents/tools`         | Layer 8      | `08-layer-tools.md`                            | P1 W3                                            |
| `@reactive-agents/observability` | Layer 9      | `09-layer-observability.md`                    | P3 W13                                           |
| `@reactive-agents/interaction`   | Layer 10     | `layer-10-interaction-revolutionary-design.md` | P1 W4 (Autonomous only); P3 W13-14 (all 5 modes) |
| `@reactive-agents/runtime`       | Orchestrator | `layer-01b-execution-engine.md`                | P1 W4                                            |

### Enhancement Packages (packages/)

| Package                       | Spec File                                            | Phase    |
| ----------------------------- | ---------------------------------------------------- | -------- |
| `@reactive-agents/guardrails` | `11-missing-capabilities-enhancement.md` (Package 1) | P2 W5-8  |
| `@reactive-agents/eval`       | `11-missing-capabilities-enhancement.md` (Package 2) | P2 W5-8  |
| `@reactive-agents/prompts`    | `11-missing-capabilities-enhancement.md` (Package 3) | P3 W9-12 |

### Apps (apps/)

| App                    | Spec File                                              | Phase    |
| ---------------------- | ------------------------------------------------------ | -------- |
| `@reactive-agents/cli` | `11-missing-capabilities-enhancement.md` (Extension 7) | P3 W9-12 |

---

## Implementation Order (Follow Exactly)

### Phase 1: Foundation (Weeks 1-4) — MVP

**Goal:** Single agent with ReAct reasoning, basic memory, basic tools

#### Week 1-2: Layer 1 Core + Layer 1.5 LLM Provider

```
├─ Setup monorepo (bun workspaces)
├─ Create packages/core/ from layer-01-core-detailed-design.md
│   └─ Follow Build Order (14 steps): types → errors → ids → EventBus → AgentService
│       → TaskService → ContextWindowManager (NEW, step 11) → CoreServicesLive → index
│   NOTE: ContextWindowManager was formerly deferred to Phase 3; it's now required in
│         Phase 1 because the ExecutionEngine uses it for message truncation.
├─ Create packages/llm-provider/ from 01.5-layer-llm-provider.md
│   └─ Follow Build Order: types (includes EmbeddingConfig + CacheableContentBlock)
│       → errors → LLMService Tag → AnthropicProvider (embed routes to OpenAI/Ollama)
│       → TestLLMService → runtime
│   NOTE: No NOMIC_API_KEY required. Set OPENAI_API_KEY for embeddings, or set
│         EMBEDDING_PROVIDER=ollama for fully local operation.
└─ ✅ All tests passing
```

#### Week 2-3: Layer 2 Memory (SQLite Tier 1 — zero external deps)

```
├─ Create packages/memory/ from 02-layer-memory.md
│   └─ Follow Build Order (17 steps):
│       1. types.ts — all Schema types (SemanticEntry, DailyLogEntry, SessionSnapshot, ProceduralEntry, ZettelLink, ...)
│       2. errors.ts — all TaggedErrors
│       3. database.ts — MemoryDatabase (bun:sqlite, WAL mode, FTS5 schema migration)
│       4. search.ts — MemorySearchService (FTS5 BM25 search; no vec in Tier 1)
│       5. services/working-memory.ts — WorkingMemoryService (Ref, capacity 7)
│       6. services/semantic-memory.ts — SemanticMemoryService (SQLite read/write)
│       7. services/episodic-memory.ts — EpisodicMemoryService (daily logs + session snapshots)
│       8. services/procedural-memory.ts — ProceduralMemoryService (workflows + patterns)
│       9. fs/memory-file-system.ts — MemoryFileSystem (markdown export/import)
│       10. compaction/compaction-service.ts — CompactionService (4 strategies)
│       11. extraction/memory-extractor.ts — MemoryExtractor (LLM-driven, optional dep)
│       12. extraction/memory-consolidator.ts — MemoryConsolidator (merge/decay cycles)
│       13. indexing/zettelkasten.ts — ZettelkastenService (SQLite link graph, FTS2 similarity)
│       14. services/memory-service.ts — MemoryService orchestrator (bootstrap, flush, snapshot)
│       15. runtime.ts — createMemoryLayer("1") for Tier 1 (zero deps)
│       16. index.ts — public re-exports
│       17. Tests for each module
│   NOTE: NO LanceDB. NO Nomic API. bun:sqlite is built-in — no npm install needed.
│         Zettelkasten is included in Phase 1 (no longer deferred to Phase 2).
│         Tier 2 (sqlite-vec KNN) is added in Phase 2 Week 8-9.
└─ ✅ All tests passing
```

#### Week 3: Layer 8 Tools (Basic)

```
├─ Create packages/tools/ from 08-layer-tools.md
│   └─ Follow Build Order: types → errors → MCPClient → ToolRegistry → FunctionCalling → runtime
└─ ✅ All tests passing
```

#### Week 3-4: Layer 3 Reasoning (Reactive Only)

```
├─ Create packages/reasoning/ from 03-layer-reasoning.md
│   └─ Follow Build Order (17 steps): types → errors → executeReactive function → StrategyRegistry → ReasoningService → runtime
├─ Implement ONLY executeReactive strategy; skip other 4 strategies
└─ ✅ All tests passing
```

#### Week 4: Layer 10 Interaction (Autonomous) + Runtime (ExecutionEngine)

```
├─ Create packages/interaction/ from layer-10-interaction-revolutionary-design.md
│   └─ Implement only: NotificationService, ModeSwitcher (autonomous mode only), InteractionManager
│
├─ Create packages/runtime/ from layer-01b-execution-engine.md
│   └─ Follow Build Order (7 steps):
│       1. src/types.ts — ExecutionContext, LifecyclePhase, HookTiming, AgentState, ReactiveAgentsConfig
│       2. src/errors.ts — ExecutionError, HookError, RuntimeError
│       3. src/hooks.ts — LifecycleHookRegistry (register + run hooks per phase/timing)
│       4. src/execution-engine.ts — ExecutionEngine Context.Tag + ExecutionEngineLive (the 10-phase loop)
│       5. src/runtime.ts — createRuntime() factory (composes ALL package layers)
│       6. src/index.ts — public re-exports
│       7. Tests for ExecutionEngine (use TestLLMService, in-memory layers)
│   NOTE: ExecutionEngine is the ONLY place that orchestrates all 10 phases. No other
│         package should import from @reactive-agents/runtime (dependency inversion).
└─ ✅ All tests passing
```

**P1 Deliverable:** Single agent executes tasks end-to-end via ExecutionEngine with ReAct reasoning, SQLite memory, MCP tools, autonomous mode. createRuntime() works.

---

### Phase 2: Differentiation (Weeks 5-9) — Unique Features

**Goal:** Activate all competitive advantages

#### Week 5-6: Layer 3 All Strategies + Guardrails

```
├─ Add remaining strategies to packages/reasoning/:
│   ├─ executePlanExecuteReflect
│   ├─ executeTreeOfThought
│   ├─ executeReflexion
│   └─ executeAdaptive
├─ Add StrategySelector, EffectivenessTracker services
├─ Create packages/guardrails/ from 11-missing-capabilities-enhancement.md (Package 1)
│   └─ Follow Build Order (15 steps): types → errors → detectors → PolicyEngine → GuardrailService → runtime
└─ ✅ All strategies work, guardrails enforce contracts
```

#### Week 6-8: Layer 4 Verification + Eval

```
├─ Create packages/verification/ from 04-layer-verification.md
│   └─ Follow Build Order: types → errors → all 5 verification layers → AdaptiveSelector → VerificationService → runtime
├─ Create packages/eval/ from 11-missing-capabilities-enhancement.md (Package 2)
│   └─ Follow Build Order (14 steps): types → errors → dimension scorers → EvalService → runtime
└─ ✅ 95%+ hallucination detection, eval suites runnable
```

#### Week 8-9: Layer 5 Cost + Memory Tier 2 (sqlite-vec KNN)

```
├─ Create packages/cost/ from 05-layer-cost.md
│   └─ Follow Build Order: types → errors → ComplexityRouter → SemanticCache → Compression → BudgetEnforcer → runtime
├─ Upgrade packages/memory/ to Tier 2 (add sqlite-vec KNN search)
│   └─ Install sqlite-vec as optional dependency
│   └─ Update database.ts: create vec0 virtual tables for semantic_vec, episodic_vec, procedural_vec
│   └─ Update search.ts: add knn() method (sqlite-vec KNN alongside existing FTS5 BM25)
│   └─ Update runtime.ts: createMemoryLayer("2") factory with LLMService optional dep
│   NOTE: Zettelkasten was built in Phase 1 — it is NOT deferred. Only vec KNN is added here.
└─ ✅ 10x cost reduction, Tier 2 KNN search, all memory types working
```

**P2 Deliverable:** All 5 reasoning strategies, verification, cost optimization, guardrails, eval, memory Tier 2 KNN.

---

### Phase 3: Production-Ready (Weeks 10-14) — Enterprise Features

#### Week 10-11: Layer 6 Identity

```
├─ Create packages/identity/ from 06-layer-identity.md
│   └─ Follow Build Order: types → errors → CertificateService → AuthService → AuditService → DelegationService → runtime
└─ ✅ Certificate auth, audit logs, permission scoping
```

#### Week 11-13: Layer 7 Orchestration

```
├─ Create packages/orchestration/ from 07-layer-orchestration.md
│   └─ Follow Build Order: types → errors → WorkflowEngine → AgentMesh → DurableExecution → A2AService → runtime
└─ ✅ Multi-agent coordination, durable execution, A2A protocol
```

#### Week 13: Layer 9 Observability + Prompts

```
├─ Create packages/observability/ from 09-layer-observability.md
│   └─ Follow Build Order: types → errors → TracingService → MetricsService → LoggingService → runtime
├─ Create packages/prompts/ from 11-missing-capabilities-enhancement.md (Package 3)
│   └─ Follow Build Order (12 steps): types → errors → templates → PromptService → runtime
└─ ✅ OpenTelemetry tracing, prompt versioning
```

#### Week 13-14: Layer 10 All Modes + CLI + Integration Extensions

```
├─ Complete packages/interaction/ (all 5 modes, adaptive switching, preference learning)
│   └─ Add: CheckpointService, PreferenceLearner, CollaborationService
├─ Create apps/cli/ from 11-missing-capabilities-enhancement.md (Extension 7)
├─ Add AgentLearningService to packages/reasoning/ (Extension 4 from 11-spec)
│   NOTE: ContextWindowManager (formerly Extension 5) was built in Phase 1 Week 1-2.
│   NOTE: StreamingService (formerly Extension 6) — add to packages/core/ here if needed.
└─ ✅ All features complete, production ready
```

**P3 Deliverable:** Full production system with all 10 layers + 3 enhancement packages + CLI.

---

## Monorepo Structure

```
reactive-agents/
├── packages/
│   ├── core/                    # Layer 1 — Foundation types, EventBus, AgentService, TaskService, ContextWindowManager
│   ├── llm-provider/            # Layer 1.5 — LLM abstraction (Anthropic, OpenAI, Test; embed via OpenAI/Ollama)
│   ├── memory/                  # Layer 2 — 4 types (Semantic/Episodic/Procedural/Working), bun:sqlite, Zettelkasten
│   ├── reasoning/               # Layer 3 — 5 strategies, selector, effectiveness tracker
│   ├── verification/            # Layer 4 — 5-layer hallucination detection
│   ├── cost/                    # Layer 5 — Router, cache, compression, budgets
│   ├── identity/                # Layer 6 — Certificates, auth, audit, delegation
│   ├── orchestration/           # Layer 7 — Workflows, agent mesh, durable exec, A2A
│   ├── tools/                   # Layer 8 — MCP client, function calling, tool registry
│   ├── observability/           # Layer 9 — OpenTelemetry, tracing, metrics, logging
│   ├── interaction/             # Layer 10 — 5 modes, adaptive switching, collaboration
│   ├── runtime/                 # Orchestrator — ExecutionEngine (10-phase loop), createRuntime()
│   ├── guardrails/              # Enhancement — Contracts, PII, injection detection
│   ├── eval/                    # Enhancement — LLM-as-judge, regression, benchmarks
│   └── prompts/                 # Enhancement — Templates, versioning, A/B testing
├── apps/
│   ├── cli/                     # CLI tool (init, create, dev, eval, playground)
│   ├── dashboard/               # Web dashboard (Phase 3+)
│   └── examples/                # Example applications
├── package.json                 # Workspace root
├── tsconfig.json                # Shared TS config
└── bun.lockb
```

### Root `package.json`

```json
{
  "name": "reactive-agents",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  }
}
```

### Root `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

## Effect-TS Core Patterns

**CRITICAL: Use ONLY these patterns. Every spec follows them exactly.**

### 1. Types — Use Schema.Struct (NOT interfaces)

```typescript
import { Schema } from "effect";

// ✅ CORRECT: Schema.Struct
export const AgentSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.brand("AgentId")),
  name: Schema.String,
  status: Schema.Literal("idle", "running", "completed", "failed"),
});
export type Agent = typeof AgentSchema.Type;

// ❌ WRONG: Plain interface
export interface Agent {
  id: string;
  name: string;
}
```

### 2. Errors — Use Data.TaggedError (NOT throw)

```typescript
import { Data } from "effect";

// ✅ CORRECT: Data.TaggedError
export class AgentError extends Data.TaggedError("AgentError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ❌ WRONG: throw new Error()
throw new Error("Something failed");
```

### 3. Services — Use Context.Tag + Layer.effect (NOT classes)

```typescript
import { Context, Effect, Layer, Ref } from "effect";

// ✅ CORRECT: Context.Tag
export class MyService extends Context.Tag("MyService")<
  MyService,
  {
    readonly doWork: (input: string) => Effect.Effect<Result, MyError>;
  }
>() {}

// ✅ CORRECT: Layer.effect implementation
export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const dep = yield* DependencyService;
    const stateRef = yield* Ref.make<Map<string, Data>>(new Map());

    return {
      doWork: (input) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const result = yield* dep.process(input);
          yield* Ref.update(stateRef, (m) => {
            const n = new Map(m);
            n.set(input, result);
            return n;
          });
          return result;
        }),
    };
  }),
);

// ❌ WRONG: OOP class
export class MyServiceImpl {
  constructor(private dep: Dep) {}
}
```

### 4. Composition — Use Layer.mergeAll + Layer.provide

```typescript
// ✅ CORRECT: Layer composition
export const createMyLayer = () => {
  const ServiceA = ServiceALive;
  const ServiceB = ServiceBLive.pipe(Layer.provide(ServiceA));
  return Layer.mergeAll(ServiceA, ServiceB);
};
```

### 5. Async — Use Effect.tryPromise (NOT await)

```typescript
// ✅ CORRECT: Effect.tryPromise
const fetchData = Effect.tryPromise({
  try: () => fetch(url).then((r) => r.json()),
  catch: (err) => new MyError({ message: "Fetch failed", cause: err }),
});

// ❌ WRONG: async/await
const data = await fetch(url);
```

### 6. Testing — Provide real or test layers

```typescript
import { describe, it, expect } from "vitest";
import { Effect } from "effect";

describe("MyService", () => {
  it("should do work", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* MyService;
      return yield* svc.doWork("input");
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(MyServiceLive)),
    );

    expect(result).toBeDefined();
  });
});
```

---

## Inter-Layer Dependency Graph

```
@reactive-agents/runtime (ExecutionEngine) ← ALL layers + Guardrails
  NOTE: All other packages have zero upward deps. Runtime is the sole top-level package.

Layer 10 (Interaction) ← L1 Core, L3 Reasoning, L9 Observability
Layer 9  (Observability) ← L1 Core
Layer 8  (Tools) ← L1 Core, L6 Identity
Layer 7  (Orchestration) ← L1 Core, L6 Identity, L8 Tools, L1.5 LLM
Layer 6  (Identity) ← L1 Core
Layer 5  (Cost) ← L1 Core, L1.5 LLM
Layer 4  (Verification) ← L1 Core, L1.5 LLM, L2 Memory
Layer 3  (Reasoning) ← L1 Core, L1.5 LLM, L2 Memory
Layer 2  (Memory) ← L1 Core; OPTIONAL: L1.5 LLM (embed() for Tier 2 KNN only)
Layer 1.5 (LLM Provider) ← L1 Core
Layer 1  (Core) ← effect (no internal deps)

Guardrails ← L1 Core
Eval ← L1 Core, L1.5 LLM
Prompts ← L1 Core
CLI ← All packages (scaffolding)
```

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

## Success Criteria

### Phase 1 (Week 4)

- ExecutionEngine runs tasks end-to-end (10-phase loop)
- Single agent executes tasks with ReAct reasoning
- Memory stores/retrieves via bun:sqlite (Tier 1, FTS5); Zettelkasten link graph in SQLite
- MCP tools callable
- Autonomous mode works
- createRuntime() factory composes all Phase 1 layers
- 80%+ test coverage

### Phase 2 (Week 9)

- All 5 reasoning strategies + adaptive selection
- 95%+ hallucination detection via 5-layer verification
- 10x cost reduction vs naive (cache + routing + compression)
- Memory Tier 2 (sqlite-vec KNN) working alongside Tier 1 FTS5
- Guardrails enforce agent contracts
- Eval suites runnable

### Phase 3 (Week 14)

- Certificate-based auth + audit logs
- Multi-agent coordination + durable execution
- A2A protocol interoperability
- OpenTelemetry traces collected
- All 5 interaction modes + adaptive switching
- CLI scaffolding works
- Prompt versioning + A/B testing
- Production deployment successful

---

## Troubleshooting

### "Effect runtime not working"

→ `import { Effect, Context, Layer } from "effect"` (single import)
→ Use `Effect.gen(function* () { ... })` pattern
→ Provide all services: `effect.pipe(Effect.provide(layer))`

### "Service not found"

→ Every service needs `Context.Tag` definition + `Layer.effect` implementation
→ Use `Layer.mergeAll()` to compose multiple services
→ Check dependency chain: if Service B needs Service A, use `ServiceBLive.pipe(Layer.provide(ServiceALive))`

### "SQLite database error"

→ Path must be writable: `.reactive-agents/memory/{agentId}/memory.db`
→ Use `Layer.scoped` for MemoryDatabase (runs `db.close()` as finalizer)
→ All SQLite calls are synchronous (bun:sqlite); wrap in `Effect.sync`, not `Effect.tryPromise`
→ FTS5 triggers must exist before insert: run schema migration in `MemoryDatabase.initialize()`

### "Tests failing"

→ Provide all dependencies: `Effect.provide(AllServicesLive)`
→ Use `Effect.runPromise()` (not `await program()`)
→ For unit tests, use `TestLLMService` from `@reactive-agents/llm-provider`

---

## How to Read a Layer Spec

Every layer spec follows the same structure. When implementing a layer:

1. **Read the Overview** — understand purpose and responsibilities
2. **Read Package Structure** — create all directories first
3. **Follow Build Order** — implement files in EXACT numbered order
4. **Copy Types** — use `Schema.Struct` definitions from the spec verbatim
5. **Copy Errors** — use `Data.TaggedError` definitions from the spec verbatim
6. **Copy Services** — use `Context.Tag` + `Layer.effect` from the spec verbatim
7. **Create Runtime** — compose layers using the `createXxxLayer()` factory from the spec
8. **Create index.ts** — re-export public API
9. **Write Tests** — use test patterns from the spec
10. **Create package.json** — use exact dependencies from the spec
