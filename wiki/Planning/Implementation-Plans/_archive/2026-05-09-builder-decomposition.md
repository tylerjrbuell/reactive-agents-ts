# builder.ts Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `packages/runtime/src/builder.ts` from 6,232 LOC to ≤600 LOC, with the runtime `ReactiveAgent` class extracted to `reactive-agent.ts` and all `buildEffect()` complexity decomposed into focused modules under `builder/`.

**Architecture:** `builder.ts` today conflates four concerns: (1) **type declarations** for option bags (~560 LOC), (2) **fluent builder methods** that just set fields (~1,480 LOC, 73 methods), (3) **runtime construction** via `buildEffect()` (~1,440 LOC of layer-assembly + tool registration + sub-agent executor), and (4) **the runtime `ReactiveAgent` class** with execution facade and gateway loop (~2,000 LOC). Each concern is independently extractable.

**Strategy:** Mirror the W23/W24 success pattern — extract closures into typed modules with explicit deps, replace inline blocks with single function calls, run tests after every step. Most tasks touch builder.ts directly so they sequentialize, but they're small and mechanical. Sub-agent executor and gateway loop are the two most complex extractions.

**Tech Stack:** TypeScript / Effect-TS / Bun. New modules under `packages/runtime/src/builder/` (build-time) and `packages/runtime/src/agent/` (runtime).

---

## Sequence labels

| Sequence | Concern | Tasks | Target Δ |
|---|---|---|---|
| **W25-A** (surface shrink) | Types, helpers, serialization moved out of builder.ts | T1, T2, T3 | -700 LOC |
| **W25-B** (buildEffect decomposition) | Layer assembly, tool registration, sub-agent executor | T4, T5, T6, T7, T8, T9, T10 | -1,200 LOC |
| **W25-C** (RI wiring) | RI hook subscription logic from build() | T11 | -100 LOC |
| **W25-D** (ReactiveAgent gateway extraction) | start() gateway loop into agent/ subdir | T12, T13, T14 | -600 LOC |
| **W25-E** (final separation) | Move ReactiveAgent class to its own file | T15, T16 | -2,000 LOC |

After W25-E, builder.ts contains only: factory + builder class + simple setters + delegating build/buildEffect.

---

## Closure-boundary inventory

Mapped from a structural audit of the current 6,232-LOC file. Line numbers will shift as tasks land — each task does its own pre-extraction `grep` to confirm boundaries.

| Block | Current line range | LOC | Closure deps |
|---|---|---|---|
| Option types (ToolsOptions, MemoryOptions, etc., 13 interfaces) | 99–662 | ~560 | none (pure types) |
| Result types (AgentResult, AgentResultMetadata) | 662–755 | ~90 | none (pure types) |
| `composePersonaToSystemPrompt`, `deriveGoalAchieved`, `defaultTracingConfig` | 29–35, 762–817 | ~50 | none (pure helpers) |
| `toConfig()` method body | 2576–2660 | ~85 | `this` (full builder state) |
| `buildSingleSubAgentTask` (sub-agent executor) | 3516–3862 | ~350 | parent ToolService ref, parent execution context ref, ReactiveAgents factory |
| `spawnHandler` + `spawnAgentsHandler` (spawn-agent tool handlers) | 3864–4045 | ~180 | parent context ref, agent-tools array, dynamic-sub-agent options |
| Tool/MCP/agent-tool registration block (`agentToolInitEffect`) | 4065–4128 | ~65 | registrations array, mcp servers list, runtime ref |
| Tool registration prep (remote A2A, agent tools, dynamic sub-agents) | 3213–4059 | ~850 | tied to spawn handlers + sub-agent executor |
| RAG document ingestion | 4131–4187 | ~57 | ragStore module-level Map, document specs |
| Health service layer composition | 4189–4202 | ~14 | runtime ref, config |
| Tracing layer composition | 4204–4224 | ~21 | runtime ref, tracingConfig |
| Base runtime + cortex layer composition | 2899–3107 | ~210 | full builder state passed to createRuntime |
| RI hook subscription wiring (in build() and post-build) | 2720–2779 | ~60 | _riHooks, EventBus |
| ReactiveAgent.start() gateway bootstrap | 5578–5767 | ~190 | runtime services (Gateway, EventBus, Observability), channels config |
| ReactiveAgent.start() executeEvent + policy | 5800–5900 | ~100 | gateway service, run-method, isExecuting closure |
| ReactiveAgent.start() main loop (heartbeat/cron/events/chat) | 5900–end-of-start | ~400+ | full gateway state machine |
| ReactiveAgent class body (run, subscribe, pause, etc.) | ~4271–end | ~2,000 | engine, runtime, agentId |

---

## Test strategy

**Pure refactors with no behavior change.** TDD here = re-run existing test suite at every checkpoint. Existing tests pin behavior; any deviation from baseline = abort.

### Verification protocol (run BOTH after every task)

The known `replayCommand --json` flake in the diagnose package can mask a regression: if a W25 task breaks something but the flake happens to pass that run, the orchestrator sees `5032 pass / 0 fail` and lets a real regression through. Pin the protocol:

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun test 2>&1 | tail -5
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun test packages/diagnose/tests/diagnose.test.ts 2>&1 | tail -5
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun run build 2>&1 | tail -10
```

**Acceptance criteria:**
- Full-suite total count must equal **baseline (`5031 pass / 1 fail`)** OR **baseline+1 flake-passes (`5032 pass / 0 fail`)**. Any other count = abort.
- Diagnose isolated test: must be `12 pass / 0 fail` (proves the only flake is the known one).
- DTS build: must show `Tasks: 33 successful, 33 total`. **DTS must pass — that's what caught the W24 EbLike/ReasoningServiceLike bugs that `bun test` alone missed.**

### Hazard: forbid local type aliases for service shapes

The W24 sequence broke the DTS build because subagents declared local `type X = {...}` aliases for `EbLike` and `ReasoningServiceLike` that subtly diverged from the canonical types. Every W25 task prompt MUST include this guard:

> **Do NOT create local `type X = {...}` aliases for service shapes.** If the extracted block uses an EventBus, ToolService, ChannelAdapter, GatewayService, or any other service type — search the codebase for the canonical type first and import it. If no canonical type exists, ASK before creating one. Common canonical sources: `engine/runtime-context.ts` (EbLike, ObsLike), `engine/types-reasoning.ts` (ReasoningServiceLike), `@reactive-agents/core` (AgentEvent, Task, TaskResult), `@reactive-agents/tools` (ToolService).

**Site-string discipline:** New `emitErrorSwallowed` calls must use semantic anchors at the new module path, e.g. `runtime/src/builder/build-effect/sub-agent-executor.ts:tool-proxy-init`. The structural test `tests/error-swallowed-wiring.test.ts` enforces uniqueness.

**Doc-comment policy:** When citing source location in extracted modules, use `Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).` not raw line numbers.

---

## Files

### Created

**Phase W25-A:**
- `packages/runtime/src/builder/types.ts` — T1 (all XOptions interfaces)
- `packages/runtime/src/builder/helpers.ts` — T2 (composePersona, deriveGoalAchieved, defaultTracingConfig)
- `packages/runtime/src/builder/to-config.ts` — T3 (toConfig serialization)

**Phase W25-B:**
- `packages/runtime/src/builder/build-effect/sub-agent-executor.ts` — T4
- `packages/runtime/src/builder/build-effect/spawn-handlers.ts` — T5
- `packages/runtime/src/builder/build-effect/tool-integration.ts` — T6
- `packages/runtime/src/builder/build-effect/rag-ingestion.ts` — T7
- `packages/runtime/src/builder/build-effect/health-layer.ts` — T8
- `packages/runtime/src/builder/build-effect/tracing-layer.ts` — T9
- `packages/runtime/src/builder/build-effect/runtime-construction.ts` — T10

**Phase W25-C:**
- `packages/runtime/src/builder/ri-wiring.ts` — T11

**Phase W25-D:**
- `packages/runtime/src/agent/gateway-bootstrap.ts` — T12
- `packages/runtime/src/agent/gateway-policy.ts` — T13
- `packages/runtime/src/agent/gateway-loop.ts` — T14

**Phase W25-E:**
- `packages/runtime/src/reactive-agent.ts` — T15 (new home for ReactiveAgent class)

### Modified

- `packages/runtime/src/builder.ts` — every task replaces an inline block with a function call

---

## Subagent execution model

Each task dispatched to a fresh subagent with:
1. **Full task prompt** — the task definition below + paths + closure-deps interface + verification commands
2. **Pre-extraction read** — subagent confirms boundaries via `grep` (line numbers will have shifted)
3. **Verification** — `bun test` AND `bun run build` before and after; abort on regression
4. **Single commit per task** — message format `refactor(runtime): <one-line> (W25-X step Tn)`
5. **Reports back** — LOC delta, test counts, commit SHA

Orchestrator runs `bun test` AND `bun run build` independently after every task before reviewing the diff. Trust but verify.

**Parallelism:** Most tasks touch builder.ts so they sequentialize. T1, T2, T3 can run sequentially in fast batch (each is small, mechanical, no overlap). T4–T10 must be strictly sequential (all touch buildEffect body). T12–T14 must be sequential (all touch start()). T15 is final separation.

---

## Tasks

### T1 (W25-A step 1): Extract option type declarations

**Files:**
- Create: `packages/runtime/src/builder/types.ts`
- Modify: `packages/runtime/src/builder.ts:99-755`

Move ALL of these interfaces out of builder.ts:
`ProviderName`, `AgentPersona`, `ToolsOptions`, `PromptsOptions`, `MemoryOptions`, `CostTrackingOptions`, `GuardrailsOptions`, `VerificationOptions`, `ObservabilityOptions`, `A2AOptions`, `GatewayOptions`, `GatewaySummary`, `GatewayHandle`, `AgentToolOptions`, `AgentResultMetadata`, `AgentResult`.

In builder.ts, replace the inline declarations with re-exports from `./builder/types.js` (so existing public-API consumers don't break). Pattern:
```typescript
export type { ProviderName, AgentPersona, /* ... */ } from "./builder/types.js";
```

**Why re-export:** These types are part of the public API surface (consumers `import { ToolsOptions } from "@reactive-agents/runtime"`). Moving them must preserve the import path.

Verify: `bun test` green, `bun run build` green. Expected LOC delta: builder.ts ~6,232 → ~5,650.

Commit: `refactor(runtime): extract builder option types to builder/types.ts (W25-A step 1)`

---

### T2 (W25-A step 2): Extract module-level helpers

**Files:**
- Create: `packages/runtime/src/builder/helpers.ts`
- Modify: `packages/runtime/src/builder.ts`

Move out of builder.ts:
- `defaultTracingConfig()` (line 29-35)
- `deriveGoalAchieved(terminatedBy)` (line 762-774)
- `composePersonaToSystemPrompt(persona, agentName)` (line 790-817)

In builder.ts, replace with imports. These helpers are pure — extraction is mechanical.

Expected LOC delta: builder.ts → ~5,600.

Commit: `refactor(runtime): extract builder helpers to builder/helpers.ts (W25-A step 2)`

---

### T3 (W25-A step 3): Extract toConfig() serialization

**Files:**
- Create: `packages/runtime/src/builder/to-config.ts`
- Modify: `packages/runtime/src/builder.ts:2576-2660`

The `toConfig()` method serializes the full builder state to a plain JSON `AgentConfig`. It's a long field-by-field map with no other dependencies on builder internals beyond reading the `_*` private fields.

**Pattern:** Export a free function `serializeBuilder(builder: ReactiveAgentBuilder): AgentConfig` that takes the builder instance and reads its fields. The class method becomes a 1-line delegate:
```typescript
toConfig(): AgentConfig {
  return serializeBuilder(this);
}
```

This requires `serializeBuilder` access to the builder's state fields. Pick approach (a): change the access modifier on the fields READ by `serializeBuilder` from implicit-private to `public readonly`. **Do NOT rename** — keep the underscore prefix (`_name`, `_provider`, etc.) so the public API surface and the diff stay minimal. Only widen access for fields the serializer actually reads. This makes the read coupling explicit and TypeScript-checkable, where a single `getState()` accessor would let the surface area grow silently.

Expected LOC delta: builder.ts → ~5,510.

Commit: `refactor(runtime): extract toConfig serialization to builder/to-config.ts (W25-A step 3)`

---

### T4 (W25-B step 1): Extract sub-agent executor

**Files:**
- Create: `packages/runtime/src/builder/build-effect/sub-agent-executor.ts`
- Modify: `packages/runtime/src/builder.ts` (inside `buildEffect()`, the `buildSingleSubAgentTask` block)

The `buildSingleSubAgentTask(t)` function (~340 LOC) is currently an inner closure of `buildEffect()`. It builds and runs a sub-agent task with:
- `createLightRuntime()` for an isolated sub-agent runtime
- Parent MCP tool proxy setup (forwards parent's MCP tools to child)
- Tool filtering and scoping (META_TOOL_NAMES set, allowedTools → required conversion)
- Persona composition (already calls `composePersonaToSystemPrompt`)
- Task result unwrapping and tool-usage extraction

**Closure deps to lift into the deps interface:**
- `parentExecutionContextRef` — Ref to parent context for forwarding
- `parentToolServiceRef` — Ref to parent ToolService for MCP proxy
- `ReactiveAgents` factory (top-level import)
- The agent-tools config + dynamic-sub-agent options (read from builder state at call time)

Module signature:
```typescript
export interface SubAgentExecutorDeps {
  readonly parentExecutionContextRef: Ref.Ref<ParentExecutionContext>;
  readonly parentToolServiceRef: Ref.Ref<ToolService | null>;
  readonly agentTools: readonly AgentToolOptions[];
  readonly dynamicSubAgentOptions: { maxIterations?: number } | undefined;
  readonly logger: ObservableLogger | null;
}

export const buildSubAgentTask = (
  task: SubAgentTask,
  deps: SubAgentExecutorDeps,
): Effect.Effect<SubAgentResult, SubAgentError>;
```

**Critical:** Verify that the META_TOOL_NAMES set, the allowedTools→requiredTools conversion logic, and the persona composition all transfer byte-for-byte. This is the most complex extraction in the W25 sequence.

Expected LOC delta: builder.ts → ~5,170.

Commit: `refactor(runtime): extract sub-agent executor to builder/build-effect/sub-agent-executor.ts (W25-B step 1)`

---

### T5 (W25-B step 2): Extract spawn-agent tool handlers

**Files:**
- Create: `packages/runtime/src/builder/build-effect/spawn-handlers.ts`
- Modify: `packages/runtime/src/builder.ts`

Two handlers: `spawnHandler(args)` (single sub-agent, ~35 LOC) and `spawnAgentsHandler(args)` (batch, ~80 LOC), both in buildEffect's tool-registration block.

These wrap the executor from T4. Module signature:
```typescript
export interface SpawnHandlerDeps {
  readonly buildSubAgentTask: (
    task: SubAgentTask,
  ) => Effect.Effect<SubAgentResult, SubAgentError>;
  readonly maxConcurrentSubAgents?: number;
}

export const makeSpawnHandlers = (deps: SpawnHandlerDeps): {
  spawnHandler: (args: SpawnArgs) => Promise<unknown>;
  spawnAgentsHandler: (args: SpawnAgentsArgs) => Promise<unknown>;
};
```

Expected LOC delta: builder.ts → ~5,050.

Commit: `refactor(runtime): extract spawn-agent tool handlers to spawn-handlers.ts (W25-B step 2)`

---

### T6 (W25-B step 3): Extract tool integration — split into 3 sub-tasks

The tool integration block is ~900 LOC which is too large for a single subagent extraction (W24's biggest extraction was ~290 LOC). Split into three sequential sub-tasks. Each sub-task ~250-350 LOC, mechanical, sequential.

**T6a: Extract remote A2A client creation**
- Create: `packages/runtime/src/builder/build-effect/remote-agent-tools.ts`
- The block that creates JSON-RPC clients for `withRemoteAgent()` registrations (~300 LOC).
- Module signature returns `readonly ToolRegistration[]` from a deps interface containing the agent-tools config.

Commit: `refactor(runtime): extract remote A2A client tools (W25-B step 3a)`

**T6b: Extract local agent-tool registration + sub-agent wiring**
- Create: `packages/runtime/src/builder/build-effect/local-agent-tools.ts`
- The block that wires `withAgentTool()` registrations + dynamic spawn-agent tool (~350 LOC). Uses sub-agent executor from T4 and spawn handlers from T5.

Commit: `refactor(runtime): extract local agent-tool registration (W25-B step 3b)`

**T6c: Extract `agentToolInitEffect` + `Layer.effectDiscard` wrapping**
- Create: `packages/runtime/src/builder/build-effect/tool-init-layer.ts`
- The final ~250 LOC: combine all tool registrations (custom from T6 callers + remote from T6a + local from T6b + MCP) and wrap in `Layer.effectDiscard().pipe(Layer.provide())` for memoization.

Module signature:
```typescript
export interface ToolInitLayerDeps {
  readonly remoteToolRegistrations: readonly ToolRegistration[];
  readonly localToolRegistrations: readonly ToolRegistration[];
  readonly customTools: readonly ToolSpec[];
  readonly mcpServers: readonly MCPServerConfig[];
}

export const buildToolInitLayer = (
  baseRuntime: Layer.Layer<unknown>,
  deps: ToolInitLayerDeps,
): Layer.Layer<unknown>;
```

Commit: `refactor(runtime): extract tool init layer wrapper (W25-B step 3c)`

Expected cumulative LOC delta after T6a/b/c: builder.ts → ~4,150.

---

### T7 (W25-B step 4): Extract RAG document ingestion

**Files:**
- Create: `packages/runtime/src/builder/build-effect/rag-ingestion.ts`
- Modify: `packages/runtime/src/builder.ts`

The RAG ingestion block (~57 LOC) populates the shared module-level `ragStore` Map with `.withDocuments()` specs and back-fills meta-tools `staticBriefInfo` with indexed document metadata.

Module signature:
```typescript
export interface RagIngestionDeps {
  readonly documents: readonly DocumentSpec[];
  readonly logger: ObservableLogger | null;
}

export const ingestDocuments = (
  deps: RagIngestionDeps,
): Effect.Effect<void, never>;
```

The shared `ragStore` Map at module level should stay where it is — the handler in `tools` package needs that exact reference. The ingestion module just calls `ragStore.set(...)` for each spec.

Expected LOC delta: builder.ts → ~4,100.

Commit: `refactor(runtime): extract RAG document ingestion to rag-ingestion.ts (W25-B step 4)`

---

### T8 (W25-B step 5): Extract health service layer composition

**Files:**
- Create: `packages/runtime/src/builder/build-effect/health-layer.ts`
- Modify: `packages/runtime/src/builder.ts`

The conditional health layer composition (~14 LOC) wraps the runtime with the `Health` service if `.withHealthCheck()` was called. Trivial extraction.

Expected LOC delta: builder.ts → ~4,090.

Commit: `refactor(runtime): extract health service layer to health-layer.ts (W25-B step 5)`

---

### T9 (W25-B step 6): Extract tracing layer composition

**Files:**
- Create: `packages/runtime/src/builder/build-effect/tracing-layer.ts`
- Modify: `packages/runtime/src/builder.ts`

The tracing layer composition (~21 LOC) wraps the runtime with `TraceRecorderServiceLive` and `TraceBridgeLayer` if tracing is enabled. Trivial extraction.

Expected LOC delta: builder.ts → ~4,070.

Commit: `refactor(runtime): extract tracing layer to tracing-layer.ts (W25-B step 6)`

---

### T10 (W25-B step 7): Extract base runtime + cortex layer composition

**Files:**
- Create: `packages/runtime/src/builder/build-effect/runtime-construction.ts`
- Modify: `packages/runtime/src/builder.ts`

The base runtime construction block (lines ~2899–3107 currently, ~210 LOC) is the call to `createRuntime()` with all 40+ config fields, then conditional Cortex reporter layer wrapping.

Module signature:
```typescript
export interface RuntimeConstructionDeps {
  readonly state: BuilderState;  // typed view of the builder fields
  readonly composedSystemPrompt: string;
  readonly cortexReporterLayer: Layer.Layer<unknown> | null;
}

export const buildBaseRuntime = (
  deps: RuntimeConstructionDeps,
): Layer.Layer<unknown>;
```

`BuilderState` should be a narrow interface with only the fields createRuntime actually reads — not a full snapshot of every builder field.

Expected LOC delta: builder.ts → ~3,860.

Commit: `refactor(runtime): extract base runtime + cortex layer composition (W25-B step 7)`

---

### T11 (W25-C step 1): Extract RI hook subscription wiring

**Files:**
- Create: `packages/runtime/src/builder/ri-wiring.ts`
- Modify: `packages/runtime/src/builder.ts:2720-2779` (in `build()`)

The RI hook subscription block (~60 LOC) takes the builder's `_riHooks` config and subscribes each callback to its corresponding EventBus event tag (e.g., `onEntropyScored` → `EntropyScored` event).

Module signature:
```typescript
export interface RiWiringDeps {
  readonly riHooks: RiHooksConfig | undefined;
  readonly eventBus: EventBus;
}

export const wireRiHooks = (
  deps: RiWiringDeps,
): Effect.Effect<void, never>;
```

Expected LOC delta: builder.ts → ~3,800.

Commit: `refactor(runtime): extract RI hook subscription wiring (W25-C step 1)`

---

### T12 (W25-D step 1): Extract gateway service bootstrap

**Files:**
- Create: `packages/runtime/src/agent/gateway-bootstrap.ts`
- Modify: `packages/runtime/src/builder.ts:5578-5767` (in `ReactiveAgent.start()`)

The gateway bootstrap block (~190 LOC) resolves Gateway, EventBus, ObservabilityService, and channels config, then sets up channel adapters (webhooks, bots) before the main loop starts.

Module signature:
```typescript
export interface GatewayBootstrapDeps {
  readonly runtime: ManagedRuntime.ManagedRuntime<unknown, unknown>;
  readonly gatewayOptions: GatewayOptions;
  readonly channelsConfig: ChannelsConfig | undefined;
}

export interface GatewayBootstrapResult {
  readonly gateway: GatewayService;
  readonly eventBus: EventBus;
  readonly observability: ObservableLogger;
  readonly channelAdapters: readonly ChannelAdapter[];
}

export const bootstrapGateway = (
  deps: GatewayBootstrapDeps,
): Effect.Effect<GatewayBootstrapResult, GatewayBootstrapError>;
```

Expected LOC delta: builder.ts → ~3,610.

Commit: `refactor(runtime): extract gateway bootstrap to agent/gateway-bootstrap.ts (W25-D step 1)`

---

### T13 (W25-D step 2): Extract executeEvent + gateway policy

**Files:**
- Create: `packages/runtime/src/agent/gateway-policy.ts`
- Modify: `packages/runtime/src/builder.ts`

The `executeEvent(event, source, instruction)` closure (~100 LOC) handles a single event arriving via the gateway: applies policy filtering, runs the agent, manages the `isExecuting` lock, handles result reporting.

Module signature:
```typescript
export interface GatewayPolicyDeps {
  readonly runAgent: (input: AgentInput) => Promise<AgentResult>;
  readonly gatewayOptions: GatewayOptions;
  readonly eventBus: EventBus;
  readonly observability: ObservableLogger;
}

export interface GatewayExecutor {
  readonly executeEvent: (
    event: GatewayEvent,
    source: string,
    instruction?: string,
  ) => Promise<void>;
  readonly isExecuting: () => boolean;
}

export const makeGatewayExecutor = (
  deps: GatewayPolicyDeps,
): GatewayExecutor;
```

Expected LOC delta: builder.ts → ~3,510.

Commit: `refactor(runtime): extract gateway executeEvent policy (W25-D step 2)`

---

### T14 (W25-D step 3): Extract main gateway loop body

**Files:**
- Create: `packages/runtime/src/agent/gateway-loop.ts`
- Modify: `packages/runtime/src/builder.ts`

The main gateway loop (~400+ LOC) handles heartbeat, cron, event polling, chat manager integration. This is the core control flow of `ReactiveAgent.start()`.

Module signature:
```typescript
export interface GatewayLoopDeps {
  readonly executor: GatewayExecutor;
  readonly bootstrap: GatewayBootstrapResult;
  readonly gatewayOptions: GatewayOptions;
  readonly chatManager: GatewayChatManager | null;
  readonly stopSignal: AbortSignal;
}

export interface GatewayLoopHandle {
  readonly summary: Promise<GatewaySummary>;
  readonly stop: () => void;
}

export const runGatewayLoop = (
  deps: GatewayLoopDeps,
): GatewayLoopHandle;
```

After this, `ReactiveAgent.start()` should be ~30-50 LOC of orchestration: bootstrap → make executor → run loop → return handle.

Expected LOC delta: builder.ts → ~3,100.

Commit: `refactor(runtime): extract main gateway loop body (W25-D step 3)`

---

### T15 (W25-E step 1): Move ReactiveAgent class to its own file

**Files:**
- Create: `packages/runtime/src/reactive-agent.ts`
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/index.ts` (re-export from new location)

After T14, the `ReactiveAgent` class still has ~2,000 LOC of facade methods (`run()`, `subscribe()`, `pause()`, `resume()`, `stop()`, `cancel()`, `dispose()`, etc.) and the `refineSkills()` learning method. Move the entire class to `reactive-agent.ts`.

In builder.ts, leave only:
1. `ReactiveAgents` factory at the top
2. `ReactiveAgentBuilder` class with its `with*` methods
3. `build()` and `buildEffect()` methods (which now mostly delegate to extracted modules)
4. Re-export of `ReactiveAgent` from `./reactive-agent.js`

Expected LOC delta: builder.ts → ~600 (target).

Commit: `refactor(runtime): move ReactiveAgent class to reactive-agent.ts (W25-E step 1)`

---

### T16 (W25-E step 2): Final cleanup pass

**Files:** various

After T15 lands, do a final cleanup pass:
1. Run `wc -l packages/runtime/src/builder.ts` — should be ≤600.
2. Scan for stale imports (extracted symbols still imported but unused).
3. Run `bun run typecheck` to catch any leaked type-error.
4. Update `.agents/MEMORY.md` Phase A status to mark W25 done.
5. Save a memory entry summarizing the W25 sequence.

Commit: `chore(runtime): W25 final cleanup + memory sync (W25-E step 2)`

---

## Risk register

| Risk | Mitigation |
|---|---|
| **T4 (sub-agent executor) has many closure deps and state mutations** | Read the full ~340 LOC block before writing. Treat as a checkpoint extraction — if the deps interface gets unwieldy (>10 fields), split into 2 modules. |
| **T6 (tool integration) is the largest single extraction (~900 LOC)** | Don't try to slice it further inside the task. Move the whole block as one module. Subsequent improvement passes can refine. |
| **T15 (ReactiveAgent move) is a public API surface change** | The class is re-exported from `builder.ts` as before, so consumers don't break. Update `index.ts` to also export from new location for direct imports. |
| **DTS build catches type errors that bun test misses** | Run `bun run build` AFTER every task, not just `bun test`. The W24 EbLike/ReasoningServiceLike fixes were caught only by DTS. |
| **A subagent claims green tests but build is red** | Orchestrator runs BOTH `bun test` and `bun run build` independently after each task. |
| **Test count regresses** | Any task that drops `5031 pass` or breaks the build is rejected immediately. Full session abort if 2+ tasks regress (assume systemic). |

---

## Why this plan

**Mirrors the proven W23/W24 pattern.** Each task is small (~5-30 minutes), has explicit closure-deps, and verifies test parity. The orchestrator validates each commit independently before proceeding.

**Phased for risk.** Phase A (types/helpers) is mechanical and low-risk — gets fast wins. Phase B (buildEffect decomposition) is the heart of the work. Phases C/D/E are riskier but only proceed after B has shrunk the file substantially.

**Architectural rather than mechanical.** The new directory structure (`builder/`, `agent/`) maps to clear concerns: `builder/` is build-time, `agent/` is runtime. This makes future work (Phase B Compose API) much cleaner.

---

## Post-extraction review pass

After all 16 tasks committed:

- [ ] **R1: Final test pass** — `bun test` green
- [ ] **R2: Final DTS build** — `bun run build` green
- [ ] **R3: Final LOC** — `wc -l packages/runtime/src/builder.ts` ≤ 600
- [ ] **R4: Diff review** — `git log --oneline main..HEAD` shows 16 commits, each tagged `(W25-X step Tn)`
- [ ] **R5: Stale doc-comment scan** — `grep -rn "builder.ts:[0-9]" packages/runtime/src/builder/ packages/runtime/src/agent/` should be zero
- [ ] **R6: Update wiki + memory** — mark Phase A complete in `.agents/MEMORY.md` if both builder.ts and execution-engine.ts are below targets
