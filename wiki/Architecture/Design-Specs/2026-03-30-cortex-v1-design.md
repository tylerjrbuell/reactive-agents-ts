# Cortex v1 — Reactive Agents Companion Studio

**Date:** 2026-03-31 (revised)
**Status:** Approved
**Supersedes:** previous `2026-03-30-cortex-v1-design.md` and `2026-03-23-cortex-living-workshop-design.md`

---

## 1. Vision

Cortex is the companion studio for the Reactive Agents framework. It is the cherry on top of the DX story — an open-source local web app that makes every framework capability tangible without writing a line of code, while giving developers who are writing code a live window into what their agents are actually doing.

**The one-sentence description:** Cortex is where you come to understand what your agents are doing — and where you go when they surprise you.

**Two audiences, one tool:**
- **Explorers** — discovering the framework, want to play without code
- **Builders** — writing agents, want live visibility and debugging

**The foundational design rule:** If a UI element does not make an agent's cognitive state more understandable or give the user more control, it does not ship.

**The catalyst principle:** Cortex exists to flesh out the framework further. Every capability Cortex needs that the framework doesn't yet have gets built into the framework first, not compensated for in Cortex. The app drives framework completeness.

---

## 2. The Always-On Reporter Model

The single most important architectural decision: **Cortex is not a launcher, it is a listener.**

Agents connect to Cortex — Cortex does not launch agents. This means:

```bash
# Terminal 1: Cortex sits and waits
rax cortex

# Terminal 2: any agent, anywhere, reports to Cortex
CORTEX_URL=http://localhost:4321 rax run "research this topic"

# Or in code — one builder line
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCortex()          ← that's it
  .build();
```

Any agent with `CORTEX_URL` set or `.withCortex()` called automatically streams its EventBus events and AgentStreamEvents to Cortex. No migration, no refactor of existing agents. Just point them at it.

This is the OpenTelemetry exporter model applied to agents. Cortex is the collector. Agents are the instruments.

---

## 3. Framework Improvements Required

These must be built into the framework before or alongside Cortex. Cortex must not compensate for missing framework capabilities.

### 3.1 CortexReporterLayer — `@reactive-agents/observability` (NEW)

A new Effect-TS Layer that subscribes to the EventBus and WebSockets all events to a configured Cortex instance.

```typescript
export class CortexReporter extends Context.Tag("CortexReporter")<
  CortexReporter,
  {
    readonly connect: (url: string) => Effect.Effect<void, CortexReporterError>;
    readonly disconnect: () => Effect.Effect<void, never>;
    readonly isConnected: () => Effect.Effect<boolean, never>;
  }
>() {}

export const CortexReporterLive = (url: string) =>
  Layer.effect(CortexReporter, Effect.gen(function* () {
    const eventBus = yield* EventBus;
    // Subscribe to all AgentEvents, forward to Cortex WS endpoint
    // Reconnect with exponential backoff on disconnect
  }));
```

Resolution priority:
1. `.withCortex(url)` explicit URL on builder
2. `CORTEX_URL` environment variable
3. Default: `http://localhost:4321` if either is set

### 3.2 `.withCortex()` Builder Method — `@reactive-agents/runtime` (NEW)

```typescript
.withCortex(url?: string)  // defaults to CORTEX_URL env var or localhost:4321
```

Adds `CortexReporterLive` to the runtime Layer. No other effect on agent behavior.

### 3.3 `ReactiveDecisionRecorded` Event Enhancement — `@reactive-agents/core` (ENHANCE)

The existing `ReactiveDecision` event needs richer payload for Cortex to surface the "why":

```typescript
{
  _tag: "ReactiveDecisionRecorded";
  taskId: string;
  iteration: number;
  decision: "early-stop" | "compression" | "strategy-switch" | "temp-adjust" |
            "skill-activate" | "tool-inject" | "memory-boost" | "human-escalate";
  reason: string;          // human-readable explanation
  entropyBefore: number;
  entropyAfter?: number;   // if measurable
  triggered: boolean;      // was the decision acted on
}
```

### 3.4 `MemorySnapshot` Event — `@reactive-agents/core` (NEW)

Emitted periodically (every N iterations, configurable) and on memory flush. Lets Cortex show what's in the agent's memory right now.

```typescript
{
  _tag: "MemorySnapshot";
  taskId: string;
  iteration: number;
  working: ReadonlyArray<{ key: string; preview: string }>;
  episodicCount: number;
  semanticCount: number;
  skillsActive: ReadonlyArray<string>;
}
```

### 3.5 `ContextPressure` Event — `@reactive-agents/core` (NEW)

Emitted when context window utilization crosses thresholds (50%, 75%, 90%).

```typescript
{
  _tag: "ContextPressure";
  taskId: string;
  utilizationPct: number;   // 0–100
  tokensUsed: number;
  tokensAvailable: number;
  level: "low" | "medium" | "high" | "critical";
}
```

### 3.6 `ChatTurn` Event — `@reactive-agents/core` (NEW)

Emitted by `agent.chat()` for each user/assistant exchange. Lets Cortex display conversational sessions with full event context.

```typescript
{
  _tag: "ChatTurn";
  taskId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  routedVia: "direct-llm" | "react-loop";  // chat routing decision
  tokensUsed?: number;
}
```

### 3.7 `AgentHealthReport` Event — `@reactive-agents/health` (NEW)

Emitted on `agent.health()` calls and on periodic gateway heartbeats.

```typescript
{
  _tag: "AgentHealthReport";
  agentId: string;
  status: "healthy" | "degraded" | "unhealthy";
  checks: ReadonlyArray<{ name: string; status: string; message?: string }>;
  uptimeMs: number;
}
```

### 3.8 `ProviderFallbackActivated` Event — `@reactive-agents/llm-provider` (NEW)

`FallbackChain` is fully implemented but emits no `AgentEvent`. When a provider fails and the chain advances, Cortex has no visibility. This event closes that gap.

```typescript
{
  _tag: "ProviderFallbackActivated";
  taskId: string;
  fromProvider: string;
  toProvider: string;
  reason: string;        // "rate_limit" | "timeout" | "error" + message
  attemptNumber: number;
}
```

Emitted by `FallbackChain` before the retry attempt on the next provider.

### 3.9 `DebriefCompleted` Event — `@reactive-agents/runtime` (NEW)

`DebriefSynthesizer` produces a full `AgentDebrief` post-run but emits no event. Cortex needs to know when a debrief is ready to display the post-run card.

```typescript
{
  _tag: "DebriefCompleted";
  taskId: string;
  agentId: string;
  debrief: AgentDebrief;  // full debrief: summary, keyFindings, lessons, errors, metrics, markdown
}
```

Emitted by `ExecutionEngine` immediately after `synthesizeDebrief()` resolves.

### 3.10 `AgentConnected` / `AgentDisconnected` Events — `@reactive-agents/core` (NEW)

Emitted by `CortexReporterLive` when the WebSocket connection to Cortex is established or lost. Allows Cortex to animate node appearance and show connection state on Stage.

```typescript
{ _tag: "AgentConnected"; agentId: string; runId: string; cortexUrl: string }
{ _tag: "AgentDisconnected"; agentId: string; runId: string; reason: string }
```

### 3.11 `AgentEvent` Union — `@reactive-agents/core` (EXTEND)

Add all new event types (§3.1–§3.10) to the `AgentEvent` discriminated union. `CortexReporter` forwards all `AgentEvent` types — no Cortex-specific event format needed.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Any ReactiveAgent with .withCortex() or CORTEX_URL set         │
│                                                                 │
│  CortexReporterLayer  ──── WS ────▶  CortexServer              │
│  (in framework)                      (localhost:4321)           │
└─────────────────────────────────────────────────────────────────┘
                                            │
┌──────────────────────────────────────────▼──────────────────────┐
│  CortexServer  (apps/cortex/server/)                            │
│  Bun + Elysia · Effect-TS services · CODING_STANDARDS.md        │
│                                                                 │
│  CortexIngestService   — receives agent events via WS           │
│  CortexRunnerService   — launches agents from UI (Playground)   │
│  CortexGatewayService  — persistent agent CRUD                  │
│  CortexStoreService    — reads framework SQLite stores          │
│  CortexEventBridge     — fan-out inbound events to UI clients   │
│                                                                 │
│  WS  /ws/ingest          ← agents report here                  │
│  WS  /ws/live/:agentId   → UI clients subscribe here           │
│  REST  /api/*            → CRUD for runs, agents, config        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket + REST
┌──────────────────────────▼──────────────────────────────────────┐
│  Cortex SPA  (apps/cortex/ui/)                                  │
│  SvelteKit · Tailwind · D3 · Svelte Flow · design tokens        │
│                                                                 │
│  Three views: Stage · Run · Workshop                            │
│  Global command palette (Cmd+K)                                 │
│  Svelte store composables (reused by Dispatch)                  │
└─────────────────────────────────────────────────────────────────┘
```

### Boundary Rule

The server speaks Effect-TS (CODING_STANDARDS.md). The client speaks Svelte stores. The WebSocket protocol is the only interface. The client has zero knowledge of Effect, Layers, or framework internals.

### Two WebSocket Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `/ws/ingest` | Agent → Server | Agents push `AgentEvent` objects here |
| `/ws/live/:agentId` | Server → UI | UI clients subscribe to a specific agent's event stream |

The `CortexIngestService` receives on `/ws/ingest`, persists events to SQLite, and fans out to all UI clients subscribed to that `agentId` via `/ws/live/:agentId`.

### Static Asset Bundling

Svelte SPA compiled to static assets by `bun run build` in `apps/cortex`. Bundled into the `rax` npm package (not committed to git). `rax cortex` works immediately after install — no separate setup, works offline.

---

## 5. Three Views

### 5.1 Stage (Default View)

The home. Where you live. Shows all agents — running, scheduled, completed, idle — as a living canvas. Cognitive state is the primary signal. The Stage is never empty: the empty state is onboarding.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ◈ CORTEX          Stage   Run   Workshop         ⌘K    ⚙      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [Agent nodes — see below]                                     │
│                                                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  ▸  What should your agent do?                          [Run]  │
└─────────────────────────────────────────────────────────────────┘
```

**The persistent input bar** at the bottom is always present on Stage. Type a prompt, hit Run — Cortex builds a default agent, runs it, and transitions to the Run view. This is the fastest path from zero to running agent.

**Agent nodes** — each connected agent appears as a node. Visual state:
- **Idle / scheduled**: dim, small, grey-violet
- **Running**: pulsing violet glow, size grows with iteration count
- **High entropy**: color shifts amber → red based on `EntropyScored` events
- **Completed (success)**: settles to cyan
- **Error**: red, static, no pulse

Clicking any node navigates to the Run view for that agent.

**The connection moment** — this is the product's most important UX event. When `AgentConnected` is received:
1. A new node materializes on Stage with a brief expand animation (scales up from 0, violet burst)
2. A non-blocking toast appears bottom-right: `◈ research-task-42 connected` with a dim violet border
3. If Cortex was launched via `rax run --cortex` (i.e., no other agents are connected and this is the first), automatically navigate to the Run view for that run — don't stay on Stage
4. If other agents are already on Stage, stay on Stage and let the user choose

**Empty state (first launch):**
Center-canvas message in muted monospace:
```
No agents connected yet.

Start one: rax run "your prompt" --cortex
Or type below ↓
```
The input bar at the bottom is already focused and ready.

### 5.2 Run View

The execution window. Shows everything happening inside one agent run. Accessed by clicking an agent node on Stage or navigating directly to `/run/:runId`.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ← Stage   research-task-42   ● LIVE   iter 04/10   η 0.71    │
├──────────────────────────────────────┬──────────────────────────┤
│                                      │                          │
│   SIGNAL MONITOR                     │   TRACE PANEL            │
│   (entropy / tokens / tools /        │   (selected iteration)   │
│    latency tracks — D3)              │                          │
│                                      │   THOUGHT                │
│                                      │   ACTION                 │
│                                      │   OBSERVATION            │
│                                      │                          │
├──────────────────────────────────────┴──────────────────────────┤
│   [Reactive Decisions]  [Memory]  [Context]    [Pause] [Stop]  │
└─────────────────────────────────────────────────────────────────┘
```

**Signal Monitor** — four D3 tracks sharing a time axis:
1. `ENTROPY` — continuous line, color shifts violet→amber→red with score
2. `TOKENS` — bar per iteration, height = tokens consumed
3. `TOOLS` — spans: amber while executing, cyan on return, width = latency
4. `LATENCY` — area chart, LLM round-trip time per iteration

Click any point across any track → selects that iteration, highlights it in all tracks simultaneously, loads it in the Trace Panel.

**Trace Panel** — selected iteration detail:
- THOUGHT: full reasoning text
- ACTION: tool name + args (or "direct response" for non-tool iterations)
- OBSERVATION: tool result preview + expand
- Raw LLM exchange (collapsed disclosure)

**Bottom info bar** — three toggleable panels:
- **Reactive Decisions**: log of `ReactiveDecisionRecorded` events — when the controller adapted and why
- **Memory**: latest `MemorySnapshot` — what's in working/episodic/semantic memory right now
- **Context**: `ContextPressure` gauge — utilization %, tokens remaining

**Chat mode** — if the run is a `agent.chat()` session, the Signal Monitor is replaced by a split view: chat transcript on the left (with `ChatTurn` events), signal monitor on the right. EventBus events stream alongside the conversation in real time.

**Replay** — past runs rebuild from persisted events at 0.5×/1×/2×/instant speed.

**Debrief card** — when `DebriefCompleted` is received (or on load for past runs), the Run view appends a post-run card below the signal monitor. This is the "what just happened" summary using the fully-built `AgentDebrief` from `DebriefStore`:

```
┌─────────────────────────────────────────────────────────────────┐
│  ◈ RUN DEBRIEF                              ✓ SUCCESS  42.1s   │
├─────────────────────────────────────────────────────────────────┤
│  SUMMARY                                                        │
│  "The agent successfully researched 3 TypeScript agent          │
│   frameworks, comparing benchmarks and community sentiment."    │
│                                                                 │
│  KEY FINDINGS                    LESSONS LEARNED               │
│  • LangGraph leads Python        • web-search before analysis  │
│  • Mastra leads TypeScript       • 3 searches sufficient        │
│  • CLI tools gaining traction    • Plan-execute more efficient  │
│                                                                 │
│  METRICS: 7 iter · 8,240 tok · $0.011 · 42.1s · 4 tool calls  │
│                                                [Copy Markdown]  │
└─────────────────────────────────────────────────────────────────┘
```

The "Copy Markdown" button copies `debrief.markdown` — the pre-rendered full report. High value for sharing run results.

For runs that error, the debrief card shows `outcome: "failure"` with the error log and any partial findings.

**Provider fallback indicator** — if `ProviderFallbackActivated` events are present in the run, a small badge appears in the vitals strip: `⚡ anthropic → openai` in amber. Clicking it opens a popover showing the full fallback log.

### 5.3 Workshop View

Where you create, configure, and explore. Accessed from the top nav or from Stage's empty state. Three tabs within Workshop:

**Builder tab** — progressive disclosure agent configuration with three entry points:

```
[ New Agent ]  [ Load Config ▾ ]  [ Import JSON ]

Provider + Model    [anthropic ▾]  [claude-sonnet-4-6 ▾]
Prompt              [ textarea ]
+ Add capability ▾
  Reasoning · Tools · Guardrails · Memory · Harness Controls
  Streaming · Health Check · Skills · Gateway Schedule

[▶ Run]    [Save as Gateway Agent]    [Export Config ›]
```

**Load Config** entry points:
- `From Gateway Agent` — dropdown of saved Gateway agents, loads their `AgentConfig` into the builder for editing
- `From Run` — dropdown/search of past runs, loads the config that produced that run
- `Import JSON` — paste or drag-drop an `AgentConfig` JSON file

When a config is loaded the builder populates all sections from the schema. The loaded source is shown as a chip at the top: `Loaded from: github-monitor` with an `×` to clear. Saving creates a new agent — never silently overwrites the source.

Capability list driven by `AgentConfig` schema — new builder methods appear automatically.

**Skills tab** — browse `SkillStoreService` contents. View skill content, version history, activation count. Trigger evolution with a reason.

**Tools tab** — browse tool registry. View schema, test in isolation with sample args, see usage stats from run history.

---

## 6. Command Palette (Cmd+K)

Present on all views. A global search + action interface. Required from day one — not a V2 feature.

Registered commands include:
- `Run agent...` → focuses Stage input bar
- `View last run` → navigates to most recent Run view
- `New agent` → opens Workshop > Builder (blank)
- `Load config from run...` → opens Workshop > Builder pre-loaded from a run
- `Connect agent` → shows `.withCortex()` + `CORTEX_URL` snippet to copy
- `Open run <id>` → deep link to any run
- `Copy debrief` → copies `debrief.markdown` for the currently viewed run
- `Browse skills` → Workshop > Skills
- `Test tool <name>` → Workshop > Tools
- `Export config` → exports current agent's `AgentConfig` JSON

Each view registers its own contextual commands. The palette aggregates all registered commands and filters by typed text.

---

## 7. Server-Side Effect-TS Services

All server code follows `CODING_STANDARDS.md` exactly.

### 7.1 CortexIngestService

Receives `AgentEvent` objects from connected agents via `/ws/ingest`. Persists to SQLite. Fans out to UI subscribers.

```typescript
export class CortexIngestService extends Context.Tag("CortexIngestService")<
  CortexIngestService,
  {
    readonly handleEvent: (agentId: string, event: AgentEvent) =>
      Effect.Effect<void, CortexError>;
    readonly getSubscriberCount: (agentId: string) =>
      Effect.Effect<number, never>;
  }
>() {}
```

### 7.2 CortexRunnerService

Launches agents from the Playground (Stage input bar + Workshop Builder). Wraps `ReactiveAgents.create()` with `CortexReporterLayer` pre-wired so all Playground runs appear on Stage automatically.

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

### 7.3 CortexGatewayService

Wraps `@reactive-agents/gateway` for persistent agent CRUD. Gateway agents auto-wire `CortexReporterLayer`.

### 7.4 CortexStoreService

Read-only access to framework SQLite stores (debriefs, sessions, plans, skills). All reads via `Effect.sync(() => db.query(...).all())`.

### 7.5 CortexEventBridge

Fans inbound events from `CortexIngestService` out to WebSocket clients subscribed to `/ws/live/:agentId`. Persists all events to `cortex_events` table for replay.

### 7.6 Error Types

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

### 7.7 Layer Factory

```typescript
export const createCortexLayer = (config: CortexConfig) =>
  Layer.mergeAll(
    CortexStoreServiceLive(config.dbPath),
    CortexEventBridgeLive,
  ).pipe(
    Layer.provideMerge(CortexIngestServiceLive),
    Layer.provideMerge(CortexRunnerServiceLive),
    Layer.provideMerge(CortexGatewayServiceLive),
  );
```

---

## 8. WebSocket Protocol

### Ingest (Agent → Server): `/ws/ingest`

```typescript
interface CortexIngestMessage {
  readonly v: 1;
  readonly agentId: string;
  readonly runId: string;
  readonly sessionId?: string;
  readonly event: AgentEvent;   // any member of the AgentEvent union
}
```

### Live (Server → UI): `/ws/live/:agentId`

```typescript
interface CortexLiveMessage {
  readonly v: 1;
  readonly ts: number;
  readonly agentId: string;
  readonly runId: string;
  readonly source: "eventbus" | "stream";
  readonly type: string;                      // AgentEvent _tag
  readonly payload: Record<string, unknown>;
}
```

Unknown `type` values are logged and ignored on both sides. Forward compatible by design.

**Event persistence:** All `CortexLiveMessage` objects persisted to `cortex_events (agentId, runId, seq, ts, source, type, payload_json)`. Default retention: 50 most recent runs per agent. Powers replay on reconnect and Run view scrubbing.

---

## 9. Svelte Store Composables

SvelteKit (not plain Svelte) — enables deep-linking to specific runs and agents. Client-side routing only; no SSR needed.

### Pattern

```typescript
export function createXxxStore(deps: XxxDeps): XxxStore {
  const state = writable<XxxState>(initialState);
  return {
    subscribe: state.subscribe,
    // actions...
    destroy: () => { /* cleanup subscriptions */ },
  };
}
```

### Store Inventory

| Store | Purpose |
|-------|---------|
| `createAgentStore()` | All connected agents, their current cognitive state, live updates |
| `createRunStore(runId)` | Full event log for one run, structured per-iteration frames |
| `createSignalStore(runId)` | Transforms run events into D3-ready track data |
| `createTraceStore(runId)` | Structured iteration objects for Trace Panel |
| `createGatewayStore()` | Persistent Gateway agents: CRUD, health, sparkline history |
| `createWorkshopStore()` | Builder form state, capability config, runs from Workshop |
| `createChatStore(sessionId)` | Chat turn history + routing events for chat-mode runs |
| `createMemoryStore(runId)` | Latest MemorySnapshot, history of snapshots |
| `createCommandPalette()` | Global command registry, fuzzy search, keyboard binding |
| `createWebSocketClient(url)` | Shared WS with reconnection, exponential backoff, replay |

All stores exported from `apps/cortex/ui/src/lib/stores/index.ts`. Dispatch imports these directly — no duplicated state logic.

---

## 10. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Server runtime | Bun + Elysia | Matches framework runtime. Native WebSocket. Fast. |
| Server logic | Effect-TS | CODING_STANDARDS.md required. |
| Frontend framework | SvelteKit | Deep links, client-side routing, reactive by design. |
| Styling | Tailwind | Utility-first, fast iteration, consistent with docs. |
| Charts / signal monitor | D3.js | Correct tool for data-driven SVG visualization. |
| Node graph (Stage view) | Svelte Flow | Interactive pan/zoom/click nodes. Better than D3 force for this. |
| Command palette | Custom Svelte | ~200 lines, no mature Svelte equivalent of cmdk. |
| Design tokens | Inherited from `apps/docs` | `--ra-violet`, `--ra-cyan`, Geist Variable font, `ra-panel` glow. |

**Future IDE direction (not MVP):** If prompt-to-build-agent or code editing surfaces become real, Monaco Editor integration is the path. React would be considered at that point. For now, SvelteKit handles everything in scope.

---

## 11. Package Structure

```
apps/cortex/
  server/
    index.ts                    # Elysia app entry point
    api/
      runs.ts                   # /api/runs CRUD
      agents.ts                 # /api/agents CRUD
      tools.ts                  # /api/tools + test endpoint
      skills.ts                 # /api/skills
    ws/
      ingest.ts                 # /ws/ingest — agent event receiver
      live.ts                   # /ws/live/:agentId — UI subscriber
    services/
      ingest-service.ts         # CortexIngestService
      runner-service.ts         # CortexRunnerService
      gateway-service.ts        # CortexGatewayService
      store-service.ts          # CortexStoreService
      event-bridge.ts           # CortexEventBridge
    types.ts
    errors.ts
    runtime.ts                  # createCortexLayer()

  ui/
    src/
      routes/
        +layout.svelte           # Top nav, command palette mount
        +page.svelte             # Stage view (default)
        run/[runId]/+page.svelte # Run view
        workshop/+page.svelte    # Workshop view
      lib/
        stores/
          agent-store.ts
          run-store.ts
          signal-store.ts
          trace-store.ts
          gateway-store.ts
          workshop-store.ts
          chat-store.ts
          memory-store.ts
          command-palette.ts
          ws-client.ts
          index.ts
        components/
          AgentNode.svelte        # Stage node (Svelte Flow node type)
          SignalMonitor.svelte    # D3 four-track visualization
          TracePanel.svelte       # Iteration detail
          VitalsStrip.svelte      # Entropy EKG + metrics
          DecisionLog.svelte      # ReactiveDecision events
          MemoryPanel.svelte      # MemorySnapshot display
          ContextGauge.svelte     # ContextPressure indicator
          BuilderForm.svelte      # Progressive capability builder
          CommandPalette.svelte   # Cmd+K interface
          ChatView.svelte         # Chat session transcript
      app.css                    # Design token imports + ra-panel extension
```

---

## 12. How It Ships with `rax`

```bash
rax cortex                      # Start on :4321, open browser
rax cortex --port 5000
rax cortex --no-open
rax cortex --attach <agentId>   # Open directly to that agent's Run view
rax run "prompt" --cortex       # Run with CortexReporterLayer auto-wired
```

The `--cortex` flag on `rax run` is equivalent to setting `CORTEX_URL=http://localhost:4321`. If Cortex isn't running, the flag is silently ignored (reporter fails to connect, agent runs normally).

---

## 13. V1 Scope

### Must Ship

**Framework prerequisites (build first):**
- [ ] `CortexReporterLayer` + `.withCortex()` — `@reactive-agents/observability` + `@reactive-agents/runtime`
- [ ] `DebriefCompleted` event — `@reactive-agents/runtime`
- [ ] `ProviderFallbackActivated` event — `@reactive-agents/llm-provider`
- [ ] `AgentConnected` / `AgentDisconnected` events — `@reactive-agents/core`
- [ ] `ReactiveDecisionRecorded` enhancement — `@reactive-agents/core`
- [ ] `MemorySnapshot` event — `@reactive-agents/core`
- [ ] `ContextPressure` event — `@reactive-agents/core`
- [ ] `ChatTurn` event — `@reactive-agents/core`
- [ ] `AgentHealthReport` event — `@reactive-agents/health`

**Stage view:**
- [ ] Agent nodes with cognitive state (idle/running/entropy/completed/error)
- [ ] Connection moment: node appear animation + toast + auto-navigate on first connect
- [ ] Persistent input bar (always visible, focused on empty state)
- [ ] Empty state onboarding with connection snippet

**Run view:**
- [ ] Signal monitor (4 D3 tracks: entropy, tokens, tools, latency)
- [ ] Trace panel (thought/action/observation per iteration)
- [ ] Vitals strip with EKG entropy heartbeat
- [ ] Reactive decisions log (bottom bar)
- [ ] Memory panel (bottom bar)
- [ ] Context pressure gauge (bottom bar)
- [ ] Debrief card (post-run, from `DebriefCompleted` event)
- [ ] Provider fallback badge in vitals strip
- [ ] Chat mode for `agent.chat()` sessions
- [ ] Replay mode (past runs, adjustable speed)
- [ ] Deep link `/run/:runId`

**Workshop view:**
- [ ] Builder tab: progressive disclosure, core capabilities
- [ ] Builder tab: Load Config (from Gateway agent, from run, from JSON import)
- [ ] Builder tab: Export Config
- [ ] Skills tab: browse + view + version history
- [ ] Tools tab: browse + isolation test

**Infrastructure:**
- [ ] Command palette (Cmd+K) with all registered commands
- [ ] `rax cortex` CLI command + static asset bundling
- [ ] `rax run --cortex` flag
- [ ] WebSocket reconnection with event replay from SQLite
- [ ] Desktop notifications (tab badge + browser notification API)
- [ ] Svelte store composables exported for Dispatch reuse
- [ ] Deep links: `/run/:runId`, `/workshop`

### V1 Stretch

- [ ] Gateway agent management in Workshop (create, pause, resume, stop)
- [ ] Export AgentConfig JSON from Run view
- [ ] Skills: trigger evolution from Workshop UI
- [ ] Replay speed controls (0.5×/1×/2×/instant)
- [ ] Desktop notifications for gateway agent events

### V2

- [ ] Svelte Flow node graph upgrade for Stage (interactive pan/zoom)
- [ ] A/B run comparison
- [ ] Fork from any iteration
- [ ] Full dynamic capability dropdown from AgentConfig schema introspection
- [ ] ExperienceStore cross-agent learning visualization
- [ ] `rax cortex --attach` live attachment to running gateway agents
- [ ] Prompt-to-build-agent (DispatchAgent embedded)

---

## 14. Notifications and Interrupts

Browsers support the Notification API for desktop notifications. When a gateway agent completes, errors, or has an entropy spike while Cortex is in a background tab:

- Tab badge: unread event count in the page title
- Desktop notification (with user permission): agent name + event summary
- Notification click: deep links to the relevant Run view

Permission requested once on first Cortex launch.

---

## 15. Success Criteria

1. **The connection test** — a developer running an existing agent adds `.withCortex()`, runs it, and sees it appear in Cortex with zero other changes.
2. **The screenshot test** — a screenshot of Stage with two running agents makes a developer stop scrolling on HN.
3. **The debugging test** — a developer identifies why their agent used 3× more tokens than expected in under 60 seconds without reading raw logs.
4. **The no-code test** — someone with no TypeScript experience creates and runs a research agent from the Stage input bar in under 2 minutes.
5. **The framework-proof test** — every feature visible in Cortex is powered by a real framework capability. Nothing is mocked.
6. **The catalyst test** — at least 3 framework improvements (§3) are built as direct prerequisites of Cortex, making the framework more capable for all users.
