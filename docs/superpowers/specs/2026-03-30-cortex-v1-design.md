# Cortex v1 — Reactive Agents Control Center

**Date:** 2026-03-30
**Status:** Approved
**Supersedes:** `2026-03-23-cortex-living-workshop-design.md` (v1 scope only — that spec remains the v2+ roadmap)

---

## 1. Vision

`rax cortex` opens a local web app at `localhost:4321` that is simultaneously:

- **A no-code experience layer** — create, run, schedule, and observe agents without writing a line of TypeScript
- **A debugging and inspection tool** — developers working with Reactive Agents code get structured visibility into what their agent is actually doing

It is not a demo. It is not decorative. Every visual element encodes real framework data. It proves the framework by making its differentiators — entropy sensing, reactive intelligence, living skills, Gateway persistence — tangible and interactive.

**Design rule:** If a UI element does not help someone understand or control an agent, it does not ship.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  rax CLI  (apps/cli)                                            │
│  rax cortex → spawns CortexServer, opens browser               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ localhost:4321
┌──────────────────────────▼──────────────────────────────────────┐
│  CortexServer  (apps/cortex/server/)                            │
│  Bun + Elysia · Effect-TS services · CODING_STANDARDS.md        │
│                                                                 │
│  CortexRunnerService    — agent execution pool (runStream)      │
│  CortexGatewayService   — persistent agent CRUD + IPC bridge    │
│  CortexEventBridge      — EventBus + stream → WebSocket fan-out │
│  CortexStoreService     — reads framework SQLite stores         │
│  CortexConfigService    — AgentConfig CRUD                      │
│                                                                 │
│  REST  /api/runs  /api/agents  /api/tools  /api/skills          │
│  WS    /ws/runs/:runId                                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket + REST
┌──────────────────────────▼──────────────────────────────────────┐
│  Cortex SPA  (apps/cortex/ui/)                                  │
│  Svelte · Tailwind · D3.js · framework design tokens            │
│                                                                 │
│  Svelte stores as composables (see §6)                          │
│  Five sections: Runs · Agents · Playground · Tools · Skills     │
└─────────────────────────────────────────────────────────────────┘
```

### Boundary Rule

The server speaks Effect-TS. The client speaks Svelte stores. The WebSocket protocol is the only interface between them. The client has zero knowledge of Effect, Layers, or framework internals.

### Static Asset Bundling

The Svelte SPA is compiled to static assets at build time. The `rax` CLI bundles these assets and serves them from the CortexServer. `rax cortex` works immediately after `npm install reactive-agents` — no separate install, no external dependencies, works offline.

---

## 3. Layout

Top navigation bar with five sections. Content area fills the remaining viewport. Optional detail panel slides in from the right when an item is selected.

```
┌─────────────────────────────────────────────────────────────────┐
│  ◈ CORTEX        RUNS  AGENTS  PLAYGROUND  TOOLS  SKILLS    ⚙  │
├────────────────────────────────────────────┬────────────────────┤
│                                            │                    │
│            MAIN CONTENT                    │   DETAIL PANEL     │
│         (section-dependent)                │   (slide-in)       │
│                                            │                    │
└────────────────────────────────────────────┴────────────────────┘
```

**Design tokens** — inherited directly from `apps/docs/src/styles/custom.css`:

| Token | Value | Use |
|-------|-------|-----|
| `--ra-violet` | `#8b5cf6` | Reasoning, agent activity, primary accent |
| `--ra-cyan` | `#06b6d4` | Observations, tool returns, success |
| amber | `#eab308` | Tool calls, action, external reach |
| red | `#ef4444` | Errors, high entropy, failure |
| green | `#22c55e` | Completion, health |
| background | `#12131a` | Panel inner (matches `.ra-panel-inner`) |
| font | Geist Variable | All UI labels |
| data/trace | JetBrains Mono | Trace log, thought text, raw values |

Panel borders use the `ra-panel` animated gradient-border treatment (violet → cyan glow). Cards lift on hover. Scrollbar gradient violet → cyan. Dark mode default, light mode available.

---

## 4. Five Sections

### 4.1 Runs

Default view. Shows live and past executions.

**Live run card** (while executing):
```
┌──────────────────────────────────────────────────────────────┐
│ ● LIVE  research-task                          iter 3/10     │
│ η 0.62 EXPLORING  ·  1,240 tokens  ·  $0.004  ·  8.2s      │
│ ──────────────────────────────────────────────────────────── │
│  [Signal Monitor — see §5]                                   │
│ ──────────────────────────────────────────────────────────── │
│                                           [Pause] [Stop]     │
└──────────────────────────────────────────────────────────────┘
```

**Past run card** (collapsed):
```
┌──────────────────────────────────────────────────────────────┐
│ ✓  research-task          3h ago  · 7 iter · $0.011 · 42.1s │
│ ~~entropy sparkline (mini signal track)~~        [Inspect ›] │
└──────────────────────────────────────────────────────────────┘
```

Clicking "Inspect" opens the detail panel with the full signal monitor replay + debrief card + expandable trace.

### 4.2 Agents

Persistent agents backed by `GatewayService`. Create, schedule, monitor, pause, stop.

**Agent card:**
```
┌──────────────────────────────────────────────────────────────┐
│ ◈  GitHub Monitor                           ● ACTIVE         │
│ Daily at 09:00  ·  14 runs  ·  $0.18 total                  │
│ Last: 2h ago · 3 iter · ✓ completed                         │
│ ~~entropy sparkline across last 14 runs~~                    │
│                              [Pause]  [Runs ›]  [Edit ›]    │
└──────────────────────────────────────────────────────────────┘
```

The entropy sparkline across all past runs is the visual health indicator — flat = reliable, spiky = investigate.

Create flow: name → provider/model → tools → schedule (cron picker or webhook) → harness controls → Save. No code required. Saved agent is immediately managed by GatewayService.

### 4.3 Playground

Two modes toggled at the top of the section.

**Quick Run** — prompt textarea, provider/model dropdowns, tool multi-select. Hit Run. Signal monitor renders inline as the agent executes.

**Builder** — progressive disclosure form backed by `AgentConfig` schema:

```
PROVIDER          [anthropic ▾]  [claude-sonnet-4-6 ▾]

PROMPT            ┌────────────────────────────────────┐
                  │ Your task here...                  │
                  └────────────────────────────────────┘

+ Add capability ▾
  ├─ Reasoning         → strategy picker + options
  ├─ Tools             → tool multi-select with search
  ├─ Guardrails        → threshold sliders
  ├─ Memory            → enable working/episodic/semantic
  ├─ Harness Controls  → minIterations, verificationStep,
  │                       outputValidator, taskContext
  ├─ Streaming         → enable runStream
  └─ Health Check      → enable agent.health()

[▶ Run]   [Save as Agent]
```

"Save as Agent" promotes the config into the Agents section with a schedule picker.

The capability list is driven by `AgentConfig` schema fields. New builder methods added to the framework appear automatically when they are added to the schema — no Cortex code changes.

### 4.4 Tools

Browse all registered tools. Shows name, description, schema, and source (built-in / MCP / custom).

Detail panel for a selected tool:
- Full input/output schema
- "Test" form — enter args as JSON, hit Run, see raw response
- Usage stats from run history (call count, avg duration, error rate)

Read-only in v1. Tool creation is Playground territory.

### 4.5 Skills

Browse all living skills from `SkillStoreService`. Shows name, description, tier, version, last evolved.

Detail panel:
- Full skill content (rendered markdown)
- Version history (list of past versions with diff)
- "Trigger Evolution" button → fires `SkillEvolutionService.refine()` with a reason input (v1 stretch)

Read-only browsing ships in v1. Evolution trigger is v1 stretch.

---

## 5. Signal Monitor — The Run Visualization

Four tracks rendered with D3.js, scrolling right-to-left as the agent runs. Each track is a horizontal lane sharing the same time axis.

```
  ENTROPY    ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿
             violet ────── amber ────── red
             (continuous line, color = entropy magnitude)

  TOKENS     ▁▁▂▂▁▁▃▃▃▃▁▁▂▂▂▂▁▁▄▄▄▄▁▁▂▂▁▁▂▂▂▂▁▁
             (bar per iteration, height = tokens consumed)

  TOOLS      ·  · ┃web-search 240ms┃  · ┃file-write 80ms┃
             (amber rect on call → cyan on return, width = latency)

  LATENCY    ▔▔▔▔▂▂▂▂▃▃▃▃▃▂▂▂▁▁▁▁▁▁▂▂▁▁▁▃▃▃▂▂▁
             (filled area, height = LLM round-trip ms)
```

**Track data sources:**

| Track | EventBus Event | Field |
|-------|---------------|-------|
| Entropy | `EntropyScored` | `score`, `trajectory` |
| Tokens | `LLMRequestCompleted` | `tokensUsed.total` |
| Tools | `ToolCallStarted` + `ToolCallCompleted` | `toolName`, `durationMs` |
| Latency | `LLMRequestStarted` + `LLMRequestCompleted` | wall-clock delta |

**Interaction:**
- Click any point on any track → selects that iteration, highlights it across all tracks simultaneously
- Hover a tool rect → tooltip with tool name, args preview, result preview, duration
- Selected iteration → Trace panel on the right shows full thought, action, observation, entropy value, token count, raw LLM exchange (expandable)

**Replay:** Past runs rebuild from persisted `CortexEvent` rows at adjustable speed (0.5×, 1×, 2×, instant). Same interaction model as live.

**Vitals strip** above the monitor:
```
η 0.62 [EXPLORING ▾]    TOKENS 12,420    COST $0.018    ITER 04 / 10
~~EKG entropy heartbeat line (last 20 samples)~~
```

The EKG line is a live sparkline using the entropy track's last N values. The trajectory badge (CONVERGING / EXPLORING / STRESSED / DIVERGING) updates from `EntropyScored.trajectory`.

---

## 6. Server-Side Effect-TS Services

All server code follows `CODING_STANDARDS.md` exactly.

### 6.1 CortexRunnerService

Manages a pool of active agent executions.

```typescript
export class CortexRunnerService extends Context.Tag("CortexRunnerService")<
  CortexRunnerService,
  {
    readonly start: (config: AgentConfig, prompt: string) =>
      Effect.Effect<RunId, CortexError>;
    readonly pause: (runId: RunId) =>
      Effect.Effect<void, CortexError>;
    readonly stop: (runId: RunId) =>
      Effect.Effect<void, CortexError>;
    readonly getActive: () =>
      Effect.Effect<ReadonlyMap<RunId, RunContext>, never>;
  }
>() {}
```

Each `RunContext` holds the `ReactiveAgent` instance, an `AbortController`, and the set of connected WebSocket client IDs. Stored in a `Ref<Map<RunId, RunContext>>`.

### 6.2 CortexGatewayService

Thin wrapper over `@reactive-agents/gateway` for persistent agent CRUD.

```typescript
export class CortexGatewayService extends Context.Tag("CortexGatewayService")<
  CortexGatewayService,
  {
    readonly create: (config: PersistentAgentConfig) =>
      Effect.Effect<AgentId, CortexError>;
    readonly pause: (agentId: AgentId) =>
      Effect.Effect<void, CortexError>;
    readonly resume: (agentId: AgentId) =>
      Effect.Effect<void, CortexError>;
    readonly stop: (agentId: AgentId) =>
      Effect.Effect<void, CortexError>;
    readonly list: () =>
      Effect.Effect<ReadonlyArray<PersistentAgentSummary>, CortexError>;
    readonly getRuns: (agentId: AgentId) =>
      Effect.Effect<ReadonlyArray<RunSummary>, CortexError>;
  }
>() {}
```

### 6.3 CortexEventBridge

Merges EventBus events and `AgentStreamEvent` into a single `CortexEvent` stream, persists to SQLite, and fans out to connected WebSocket clients.

```typescript
export class CortexEventBridge extends Context.Tag("CortexEventBridge")<
  CortexEventBridge,
  {
    readonly attach: (runId: RunId, ws: ServerWebSocket) =>
      Effect.Effect<void, never>;
    readonly detach: (runId: RunId, ws: ServerWebSocket) =>
      Effect.Effect<void, never>;
    readonly replay: (runId: RunId, ws: ServerWebSocket) =>
      Effect.Effect<void, CortexError>;
  }
>() {}
```

Events are persisted to `cortex_events (runId, seq, ts, source, type, payload_json)`. Default retention: 50 most recent runs per agent. On client reconnect, `replay()` delivers missed events from SQLite before resuming live stream.

### 6.4 CortexStoreService

Read-only access to existing framework SQLite stores.

```typescript
export class CortexStoreService extends Context.Tag("CortexStoreService")<
  CortexStoreService,
  {
    readonly getRuns: (limit: number) =>
      Effect.Effect<ReadonlyArray<RunSummary>, CortexError>;
    readonly getDebrief: (runId: RunId) =>
      Effect.Effect<Option.Option<AgentDebrief>, CortexError>;
    readonly getSkills: () =>
      Effect.Effect<ReadonlyArray<SkillRecord>, CortexError>;
    readonly getTools: () =>
      Effect.Effect<ReadonlyArray<ToolRecord>, CortexError>;
  }
>() {}
```

All reads use `Effect.sync(() => db.query(...).all())` — bun:sqlite is synchronous.

### 6.5 Error Types

```typescript
export class CortexError extends Data.TaggedError("CortexError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CortexNotFoundError extends Data.TaggedError("CortexNotFoundError")<{
  readonly id: string;
  readonly resource: string;
}> {}

export type CortexErrors = CortexError | CortexNotFoundError;
```

### 6.6 Layer Factory

```typescript
export const createCortexLayer = (config: CortexConfig) =>
  Layer.mergeAll(
    CortexStoreServiceLive(config.dbPath),
    CortexEventBridgeLive,
  ).pipe(
    Layer.provideMerge(CortexRunnerServiceLive),
    Layer.provideMerge(CortexGatewayServiceLive),
  );
```

---

## 7. WebSocket Protocol

Versioned envelope for forward compatibility:

```typescript
// Server → Client
interface CortexEvent {
  readonly v: 1;
  readonly ts: number;
  readonly runId: string;
  readonly agentId: string;
  readonly source: "eventbus" | "stream";
  readonly type: string;                       // AgentEvent _tag
  readonly payload: Record<string, unknown>;   // Event-specific fields
}

// Client → Server
type CortexCommand =
  | { readonly type: "subscribe"; readonly runId: string }
  | { readonly type: "unsubscribe"; readonly runId: string }
  | { readonly type: "pause"; readonly runId: string }
  | { readonly type: "stop"; readonly runId: string };
```

Unknown `type` values are logged and ignored on both sides — forward compatible by design.

**Dual-source merge:** `CortexEventBridge` subscribes to the EventBus (filtered by `taskId`) and consumes the `AsyncGenerator<AgentStreamEvent>` from `agent.runStream()` concurrently. Both write to the same WebSocket connection. Client-side event store buffers with a 50ms window and sorts by `ts` before rendering.

---

## 8. Svelte Store Composables

The client-side architecture is composable Svelte stores. Each store is a factory function returning a typed store object — the pattern that assists future builders extending Cortex or Dispatch.

### 8.1 Core Pattern

```typescript
// Every composable follows this shape
export function createXxxStore(deps: XxxDeps): XxxStore {
  const state = writable<XxxState>(initialState);
  // ... setup subscriptions, derived stores
  return {
    subscribe: state.subscribe,
    // ... actions
    destroy: () => { /* cleanup */ },
  };
}
```

### 8.2 Store Inventory

**`createRunStore(runId: string)`**
Primary store for a single run. Subscribes to the WebSocket, processes `CortexEvent` objects, maintains:
- `events: CortexEvent[]` — full event log
- `iterations: IterationFrame[]` — structured per-iteration data
- `vitals: VitalsState` — current entropy, tokens, cost, iteration count
- `status: RunStatus` — live / paused / completed / failed

Exposes: `pause()`, `stop()`, `selectIteration(n)`.

**`createSignalStore(runId: string)`**
Derived from `createRunStore`. Transforms raw events into D3-renderable track data:
- `entropyTrack: TrackPoint[]` — `{ t, value, color }`
- `tokenTrack: BarPoint[]` — `{ iteration, tokens }`
- `toolTrack: ToolSpan[]` — `{ t_start, t_end, name, status }`
- `latencyTrack: TrackPoint[]` — `{ t, ms }`

Consumers pass this directly to D3 — zero transformation needed in components.

**`createAgentStore()`**
Manages the Agents section. Fetches from `GET /api/agents`, holds `PersistentAgentSummary[]`. Exposes: `create(config)`, `pause(id)`, `resume(id)`, `stop(id)`, `refresh()`.

**`createPlaygroundStore()`**
Holds current builder state: selected provider, model, prompt, enabled capabilities, capability configs. Exposes: `run()` → returns a `RunStore`, `saveAsAgent()` → delegates to `AgentStore`.

**`createToolStore()`**
Fetches tool registry from `GET /api/tools`. Holds `ToolRecord[]`. Exposes: `test(toolName, args)` → returns raw response.

**`createSkillStore()`**
Fetches from `GET /api/skills`. Holds `SkillRecord[]`. Exposes: `triggerEvolution(skillId, reason)` (v1 stretch).

**`createWebSocketClient(url: string)`**
Low-level shared WebSocket wrapper. Handles reconnection with exponential backoff (1s → 2s → 4s → 30s max), replays missed events from server on reconnect. All stores consume this — never create raw WebSocket connections in components.

### 8.3 Component Consumption Pattern

```svelte
<script lang="ts">
  import { createRunStore, createSignalStore } from "$lib/stores";
  import SignalMonitor from "$lib/components/SignalMonitor.svelte";

  export let runId: string;

  const run = createRunStore(runId);
  const signal = createSignalStore(runId);

  onDestroy(() => {
    run.destroy();
    signal.destroy();
  });
</script>

<SignalMonitor tracks={$signal} vitals={$run.vitals} on:select={handleSelect} />
```

Stores are created in components, not in a global singleton. This means two `RunStore` instances for the same `runId` share the WebSocket connection (via `createWebSocketClient` which deduplicates by URL) but maintain independent reactive state trees. Safe for A/B views in v2.

---

## 9. Package Structure

```
apps/cortex/
  server/
    index.ts                # Entry point — Elysia app + Effect runtime
    api/
      runs.ts               # GET /api/runs, POST /api/runs
      agents.ts             # GET/POST/PATCH/DELETE /api/agents
      tools.ts              # GET /api/tools, POST /api/tools/:name/test
      skills.ts             # GET /api/skills
    ws/
      bridge.ts             # WS /ws/runs/:runId — CortexEventBridge glue
    services/
      runner-service.ts     # CortexRunnerService
      gateway-service.ts    # CortexGatewayService
      event-bridge.ts       # CortexEventBridge
      store-service.ts      # CortexStoreService
    types.ts                # CortexEvent, CortexCommand, shared server types
    errors.ts               # CortexError, CortexNotFoundError
    runtime.ts              # createCortexLayer()

  ui/
    src/
      App.svelte            # Root — top nav, section routing
      lib/
        stores/
          run-store.ts
          signal-store.ts
          agent-store.ts
          playground-store.ts
          tool-store.ts
          skill-store.ts
          ws-client.ts      # Shared WebSocket client with reconnection
          index.ts          # Re-exports all composables
        components/
          SignalMonitor.svelte   # D3 four-track visualization
          TracePanel.svelte     # Expandable iteration cards
          RunCard.svelte        # Live + past run cards
          AgentCard.svelte      # Gateway agent card with sparkline
          VitalsStrip.svelte    # Entropy EKG + metrics header
          BuilderForm.svelte    # Progressive disclosure agent builder
          ToolTester.svelte     # Tool isolation test form
        views/
          Runs.svelte
          Agents.svelte
          Playground.svelte
          Tools.svelte
          Skills.svelte
      app.css               # Imports design tokens, extends ra-panel treatment
    public/
      fonts/                # Geist Variable + JetBrains Mono
```

File size target: 100–300 lines per file. `SignalMonitor.svelte` owns the D3 rendering loop and may approach 300 lines — split at `engine.ts` (D3 setup) and `tracks.ts` (per-track draw functions) if it exceeds this.

---

## 10. How It Ships with `rax`

```
apps/cli/
  src/
    commands/
      cortex.ts    # `rax cortex` command — new
  assets/
    cortex/        # Compiled Svelte SPA static assets (generated by `bun run build` in apps/cortex, bundled into rax npm package — not committed to git)
```

`rax cortex` command:
1. Resolves `assets/cortex/` relative to CLI package
2. Starts CortexServer (Bun + Elysia) serving static assets + API + WS
3. Opens `http://localhost:4321` in the default browser
4. Prints: `Cortex running at http://localhost:4321 — Press Ctrl+C to stop`

Options: `--port <n>`, `--no-open`, `--attach <agentId>` (opens directly to that agent's Runs view).

Integration with other commands:
```bash
rax run "prompt" --cortex    # Run agent and auto-open Cortex for this execution
```

---

## 11. V1 Scope

### Ships in V1

- [ ] All five sections (Runs, Agents, Playground, Tools, Skills)
- [ ] Signal monitor: all four tracks (entropy, tokens, tools, latency)
- [ ] Vitals strip with EKG entropy heartbeat
- [ ] Trace panel: expandable iteration cards, click-to-inspect
- [ ] Live run streaming via WebSocket
- [ ] Replay mode for past runs (from persisted `CortexEvent` rows)
- [ ] Run history with debrief cards
- [ ] Agents section: full Gateway CRUD (create, pause, resume, stop)
- [ ] Agent card entropy sparkline
- [ ] Playground: Quick Run + Builder (provider, model, tools, core harness controls)
- [ ] "Save as Agent" flow from Playground to Agents
- [ ] Tools: browse + isolation test
- [ ] Skills: browse + view (read-only)
- [ ] `rax cortex` CLI command + static asset bundling
- [ ] `rax run --cortex` flag
- [ ] All Svelte store composables exported for reuse by Dispatch
- [ ] WebSocket reconnection with event replay

### V1 Stretch (ship if time allows)

- [ ] Skills: trigger evolution in UI
- [ ] Pause/resume live run from command bar
- [ ] Agent config inline edit in Agents detail panel

### V2 (natural roadmap — Cortex spec §11)

- [ ] Full 2D force-directed neural canvas (upgrade from signal monitor)
- [ ] A/B split run comparison
- [ ] Fork from any iteration
- [ ] Full dynamic capability dropdown driven by AgentConfig schema introspection
- [ ] Export: AgentConfig JSON + TypeScript builder code
- [ ] Batch run / eval suite
- [ ] Whisper (inject context into running agent)
- [ ] Cortex Cloud (hosted, multi-user)

---

## 12. Testing Strategy

### Server Tests (bun:test, Effect-TS pattern)

```typescript
describe("CortexRunnerService", () => {
  const mockAgent = Layer.succeed(AgentService, { /* mock */ });

  it("should emit RunStarted event when execution begins", async () => {
    const program = Effect.gen(function* () {
      const runner = yield* CortexRunnerService;
      const runId = yield* runner.start(testConfig, "test prompt");
      expect(runId).toBeDefined();
    });
    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });
});
```

- `CortexRunnerService`: start/pause/stop lifecycle, concurrent run isolation
- `CortexEventBridge`: EventBus → WS fan-out, dual-source merge, reconnect replay
- `CortexStoreService`: read round-trips, retention enforcement
- REST API: standard endpoint tests via Elysia's test client

### Client Tests (bun:test + @testing-library/svelte)

- `createSignalStore`: event sequence → correct track data transformation
- `createWebSocketClient`: reconnection logic, backoff timing, replay on reconnect
- `SignalMonitor`: snapshot at known track states
- `BuilderForm`: capability add/remove, AgentConfig assembly

### Integration Test

Launch `rax cortex` in test mode, execute a `withTestScenario` agent, assert WebSocket delivers expected `CortexEvent` sequence, assert replay from SQLite produces identical sequence.

---

## 13. Relationship to Dispatch and Full Cortex

**Cortex v1 proves the patterns. Dispatch and full Cortex build on them.**

| Component | Cortex V1 | Dispatch | Full Cortex V2 |
|-----------|-----------|---------|----------------|
| Svelte store composables | ✓ defined | reuses | reuses |
| Elysia server patterns | ✓ defined | reuses + extends | reuses |
| Signal monitor | ✓ ships | embeds as runner view | upgrades to 2D canvas |
| Agent builder form | basic | full NL DispatchAgent | full dynamic dropdown |
| Design system | ✓ inherits docs tokens | ✓ same | ✓ same |
| WebSocket protocol | ✓ defined | extends | extends |
| SQLite patterns | ✓ reads existing | adds runners/runs tables | ✓ same |

The Svelte stores in `apps/cortex/ui/src/lib/stores/` are the shared component library. Dispatch imports them. Full Cortex upgrades the visualization without touching the store contracts.

---

## 14. Success Criteria

1. **The screenshot test** — a screenshot of the signal monitor during a live run makes a developer stop scrolling.
2. **The debugging test** — a developer can identify why an agent used 3× more tokens than expected in under 60 seconds, without reading raw logs.
3. **The no-code test** — a non-developer can create a scheduled Gateway agent and see it run unattended, without writing any TypeScript.
4. **The zero-overhead test** — Cortex adds less than 5% to agent execution time (event bridge cost only).
5. **The framework-proof test** — every feature visible in Cortex is powered by a real framework capability: entropy sensor, Gateway, SkillStore, MetricsCollector, EventBus. Nothing is mocked or faked.
