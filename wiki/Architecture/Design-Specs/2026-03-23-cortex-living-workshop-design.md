# Cortex — The Living Workshop for Reactive Agents

**Date:** 2026-03-23
**Status:** Draft
**Author:** Tyler Buell + Claude

---

## 1. Vision

Cortex is a neural-themed cognitive interface for the Reactive Agents runtime — a living window into synthetic thinking organisms. It is not a studio, not a devtools panel, not a log viewer. It is a **first-class extension of the intelligent runtime harness** that lets developers observe, debug, experiment with, and deploy agents through an interface modeled on the human brain.

**Core metaphor:** Agents are synthetic neural organisms. Their execution is visible as neural pathways firing, synapses connecting, impulses traveling. The interface shows *how the agent thinks*, not just what it did.

**Product positioning:** The tool that makes people say "wow." Screenshots of Neural Path on HN/Reddit. The visualization that no other framework can build because no other framework has entropy sensing, strategy switching, and reactive intelligence baked into the runtime.

---

## 2. Architectural Principles

### 2.1 Event-Driven Decoupling (Critical)

Cortex MUST NOT hardcode knowledge of specific reasoning strategies, tool names, event payloads, or framework internals. The framework is a living project — strategies may be added or removed, kernel algorithms may change, new event types will appear.

**The contract between Cortex and the runtime is the event stream.**

The runtime produces two distinct event sources: the **EventBus** (lifecycle, reasoning, tool, entropy, and strategy events) and the **AgentStreamEvent** channel (per-token `TextDelta` events from `agent.runStream()`). Cortex subscribes to both and renders them through a unified WebSocket protocol. It does not import framework internals. It does not switch on strategy names. If a new kernel algorithm emits `ExecutionPhaseEntered`, `ReasoningStepCompleted`, `ToolCallStarted`, and `EntropyScored` events, Cortex visualizes them automatically — no Cortex code changes required.

**Decoupling rules:**
1. **Event-driven rendering** — Cortex consumes a stream of typed events over WebSocket. The event schema is the API contract. New event types are either rendered generically or ignored gracefully.
2. **No strategy-specific rendering** — The canvas does not have a "ReAct mode" and a "Plan-Execute mode." It renders *events* — thoughts produce thought nodes, tool calls produce synapse connections, observations produce return pulses. The visual shape emerges from the event pattern, not from Cortex knowing which strategy is running.
3. **Metadata-driven labels** — Event payloads carry their own labels (phase names, tool names, strategy names). Cortex displays what the event tells it. If a strategy is renamed or a new one added, the label updates automatically.
4. **Plugin points for custom visualization** — If a future kernel wants a specific visual treatment, it can register a Cortex renderer plugin. But the default renderer handles any event stream.
5. **Schema evolution** — The WebSocket protocol uses a versioned event envelope. New fields are additive. Cortex ignores unknown fields. Old Cortex versions work with new runtimes (degraded but functional).

### 2.2 First-Class Runtime Extension

Cortex is not a separate product bolted on. It ships inside the `@reactive-agents/cortex` package and is launched via `rax cortex`. It uses the same SQLite stores, the same EventBus, the same agent runner. It is the framework's face.

### 2.3 Scales with the Framework

As the framework adds capabilities, Cortex gains them automatically through the event stream. Specific enhancements (new visualizations for new features) are additive — they never require rewriting existing Cortex code.

---

## 3. Interface Architecture

### 3.1 Three Primary Views

**NEURAL PATH** (default) — Live execution visualization. The hero view. Shows the agent's cognition as a growing neural network in real-time. Every visual element is interactive and maps to real debugging data.

**LOGIC FLUX** — The workshop. Agent configuration editor, A/B experimentation, tool management, prompt laboratory. Where you tune an agent until it's dialed in.

**ENTROPY** — The observatory. Execution history, cross-run analytics, evolution tracking, aggregate entropy patterns. Hindsight and learning.

### 3.2 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  CORTEX | RUNTIME_V4.2    NEURAL PATH  LOGIC FLUX  ENTROPY  ⚙ 👤│
├────┬─────────────────────────────────────┬───────────────────────┤
│ 🧠 │                                     │ VITALS: COGNITIVE_    │
│ 🔌 │                                     │ ENTROPY  [CONVERGING] │
│ 〰️ │        NEURAL CANVAS                │                       │
│ ⚙  │        (65% width)                  │ ~~~EKG heartbeat~~~   │
│    │                                     │                       │
│    │    [nucleus] ── [tool] ── [tool]    │ COST  TOKENS  ITER    │
│    │        │                            │ $0.42  12.4k  04/07   │
│    │    [sub-agent]                      │                       │
│    │                                     │ TRACE: LOGICAL_OPS    │
│    │                                     │ [08:42:11] INITIATING │
│    │                                     │ [08:42:15] CALL: ...  │
│    │                                     │ [08:42:18] SUCCESS    │
├────┴─────────────────────────────────────┴───────────────────────┤
│  [whisper] [redirect] [THROTTLE ====88%====] [⏸] [⑂] [✕]       │
├──────────────────────────────────────────────────────────────────┤
│  T_01 ████  T_02 ██████  T_03 ████  T_04 ████████  ACTIVE  04/07│
│  ~~~~~~~~~~~~~~~~entropy curve~~~~~~~~~~~~~~~~                    │
└──────────────────────────────────────────────────────────────────┘
```

**Left sidebar** (icon navigation):
- Neural network icon → Agent selector (switch between agents)
- Circuit board icon → Topology view (multi-agent relationships)
- Waveform icon → Signal inspector (raw EventBus event stream)
- Gear icon → Runtime settings

**Right panel** (context-sensitive):
- Default: Vitals (entropy heartbeat, cost, tokens, iteration) + Trace log
- Node selected: Full data for that node (thought, tool args/response, entropy, timing)
- Workshop mode: Config editor

**Bottom timeline rail:**
- Iteration blocks sized proportionally to duration
- Color-coded by dominant activity (thinking vs tool-calling)
- Entropy curve overlaid as continuous gold line
- Scrubable — drag to any past iteration
- Step counter

**Floating command bar:**
- Whisper (inject context into running agent)
- Redirect (trigger strategy evaluation)
- Throttle slider (remaining budget as percentage)
- Pause / Fork / Kill buttons

---

## 4. NEURAL PATH — The Living Canvas

### 4.1 Visual Elements

**Nucleus (agent core):**
- Central glowing node showing agent name and current state
- Pulses with each iteration — the agent's heartbeat
- Size scales slightly with context window utilization
- Border color reflects entropy state (violet=calm, amber=exploring, red=stressed)

**Pathways (reasoning chains):**
- Each iteration extends the neural network with a new pathway segment
- Pathways grow outward from the nucleus, direction influenced by the type of activity
- Completed pathways are solid lines with soft glow
- Active pathway pulses with a traveling impulse
- Failed pathways dim and show a red break point
- The overall shape emerges organically — dense branching means heavy tool use, long straight paths mean confident reasoning, loops mean the agent is circling

**Synapses (tool connections):**
- When a tool is called, a synapse line fires from the current pathway node to a tool node at the periphery
- Tool nodes sit on the canvas edge — each unique tool gets a persistent position
- The synapse pulses amber while the tool executes (visual tension for slow tools)
- Returns pulse cyan (success) or flash red (error)
- Line thickness encodes result size
- Parallel tool calls show as simultaneous synapses firing

**Sub-agent nuclei:**
- Spawn as smaller nuclei budding off the parent, connected by a thick axon
- Grow their own pathway structure independently
- Results flow back along the axon when complete
- Visually nested — you can see the delegation hierarchy

**Memory flashes:**
- When the agent accesses memory (episodic recall, semantic lookup), a brief glow appears at the nucleus — a hippocampal flash
- Different memory types have subtle color variations

### 4.2 How Events Map to Visuals

This is the decoupling layer. Cortex does not know about strategies. It knows about **event types** and renders them:

| EventBus Event | Visual Effect |
|---|---|
| `ExecutionPhaseEntered` | Phase indicator updates, canvas color subtly shifts |
| `ReasoningStepCompleted` | New pathway node appears with thought text |
| `ToolCallStarted` | Synapse fires outward to tool node (amber pulse) |
| `ToolCallCompleted` | Synapse returns (cyan=success, red=error) |
| `LLMRequestStarted` | Nucleus glows brighter (thinking). `contextSize` field drives nucleus size scaling. |
| `LLMRequestCompleted` | Nucleus dims, token/cost counters update from `tokensUsed` and `estimatedCost` |
| `EntropyScored` | Heartbeat updates, canvas color temperature shifts |
| `StrategySwitched` | Brief reorganization animation, strategy label updates |
| `AgentStarted` | Nucleus appears |
| `AgentCompleted` | All pathways pulse green, heartbeat settles |
| `TextDelta` (stream source) | Streaming text in trace panel (per-token, preferred for live rendering) |
| `TextDeltaReceived` (EventBus) | Ignored when stream source is active; used as LLM-call-complete signal in non-streaming replay |
| `ContextWindowWarning` | Neural field boundary flashes warning |
| `ReactiveDecision` | Small indicator icon appears on the pathway |
| Any unknown event | Logged in Signal Inspector, not rendered on canvas |

**Key principle:** A new event type added to the framework in the future will either match an existing visual pattern (e.g., a new `CustomKernelStep` event could be rendered as a pathway node if it carries `thought` and `action` fields) or will appear only in the Signal Inspector until a Cortex renderer is optionally registered.

### 4.3 Interactivity

| Action | Result |
|---|---|
| Click any pathway node | Right panel shows: full thought text, action taken, observation received, entropy at that point, tokens consumed, duration, raw LLM exchange (expandable) |
| Click any tool node | Shows: all calls to this tool, success rate, avg duration, last args/response |
| Click the nucleus | Shows: agent config summary, current strategy, total cost/tokens, context window utilization |
| Hover a synapse | Tooltip: tool name, duration, result preview |
| Right-click any node | Context menu: "Fork from here", "Replay from here", "Copy trace JSON", "Compare with..." |
| Scroll wheel | Zoom in/out — zoom out for high-level shape, zoom in for individual nodes |
| Drag canvas | Pan |
| Double-click empty space | Reset view, center on nucleus |

### 4.4 Replay Mode

Activated by: clicking a past execution in history, or scrubbing the timeline past the current position.

- Neural network rebuilds step by step at adjustable speed (0.5x, 1x, 2x, 5x, instant)
- Pause at any iteration to inspect full state
- **Fork**: right-click any node → "Fork from here" → opens split view with same state up to that point, new execution with modified parameters
- **Diff overlay**: ghost the alternate execution's neural network over the current one, see where they diverged

---

## 5. LOGIC FLUX — The Workshop

### 5.1 Agent DNA Editor

The agent's configuration displayed as an interactive tree:

```
AGENT: research-assistant
├─ PROVIDER: anthropic / claude-sonnet-4-20250514
├─ REASONING
│   ├─ strategy: react
│   ├─ maxIterations: 10
│   ├─ strategySwitching: enabled
│   └─ fallback: plan-execute-reflect
├─ TOOLS [4 active]
│   ├─ web-search     ✓
│   ├─ file-write     ✓
│   ├─ code-execute   ✓
│   └─ summarize      ○
├─ GUARDRAILS
│   ├─ injection: 0.8
│   ├─ pii: 0.9
│   └─ toxicity: 0.7
├─ COST
│   ├─ budget: $5.00
│   └─ pricing: dynamic
└─ PERSONA
    ├─ name: "Atlas"
    └─ traits: [analytical, thorough]
```

**Every value is inline-editable.** Changes are staged (yellow indicator) until the agent is re-run.

**Dynamic config discovery:** The editor does NOT hardcode which config fields exist. It renders whatever fields are present in the `AgentConfig` schema. When new builder methods add new config sections, they appear in the editor automatically (provided they're part of `AgentConfig`).

### 5.2 Experiment Runner

- **Prompt input** — enter or paste the task prompt
- **Run** — execute with current config, results appear in Neural Path
- **A/B Run** — split canvas: two executions side by side, same prompt, different configs. Two neural networks grow simultaneously. Real-time metric comparison.
- **Batch Run** — run a prompt suite (eval set), see aggregate results
- **Snapshots** — save named config versions, revert to any snapshot
- **Diff snapshots** — visual diff between two configs

### 5.3 Tool Workshop

- Browse available tools with descriptions and schemas
- Enable/disable with toggle
- Test a tool in isolation — call with sample args, inspect response
- Add MCP server connections
- Create custom tools (name, description, JSON schema, handler code)
- Import tools from MCP registries

### 5.4 Prompt Laboratory

- System prompt editor with syntax highlighting
- Persona builder (structured fields or freeform)
- Template variables: define `{{variables}}`, supply different values per run
- Side-by-side prompt comparison

---

## 6. ENTROPY — The Observatory

### 6.1 Execution History

Past executions displayed as a collection — each run is a card showing:
- Agent name, timestamp, prompt preview
- Outcome (success/partial/failed) with color coding
- Key metrics: cost, tokens, iterations, duration
- Entropy trajectory mini-sparkline
- Strategy used

Sortable/filterable by any field. Search by prompt text.

### 6.2 Evolution View

For a specific agent config, see performance over time:
- Line charts: cost, success rate, iterations, entropy trajectory across runs
- Identify regressions: "after changing the model, entropy increased by 30%"
- Compare before/after config changes

### 6.3 Aggregate Analytics

- Total cost across all runs
- Most-used tools and their success rates
- Common failure patterns (extracted from debriefs)
- Strategy distribution
- Entropy heatmap: which prompts cause the most cognitive strain

---

## 7. DEPLOY — Export & Deploy

### 7.1 Export Formats

| Target | Output |
|---|---|
| **AgentConfig JSON** | Serialized config — framework-native portable format |
| **Builder Code** | TypeScript `.withX()` chain — copy into project |
| **GitAgent** | `agent.yaml` + `SOUL.md` + `memory/` directory structure |
| **Docker Compose** | `docker-compose.yml` with agent as service |
| **Fly.io** | `fly.toml` + Dockerfile + entry point |
| **Railway** | `railway.json` + entry point |

### 7.2 Deploy Flow

1. Select target platform
2. Preview generated config (editable)
3. Deploy (for supported platforms, deploy directly from Cortex)
4. Monitor — after deployment, Cortex can attach to running agent via WebSocket

### 7.3 Benchmark Report

Before exporting, optionally generate a report:
- Success rate across test prompts
- Average cost, tokens, iterations
- Entropy stability profile
- Comparison to baseline snapshot
- Confidence assessment: production-ready / needs-tuning / experimental

---

## 8. Technical Architecture

### 8.1 Package Structure

```
apps/
  cortex/
    ├─ server/              # Bun + Elysia HTTP/WS server
    │   ├─ index.ts         # Entry point, launches server
    │   ├─ api/             # REST routes
    │   │   ├─ runs.ts      # /api/runs — execution CRUD
    │   │   ├─ configs.ts   # /api/configs — config CRUD
    │   │   ├─ history.ts   # /api/history — analytics
    │   │   └─ export.ts    # /api/export — format generation
    │   ├─ ws/              # WebSocket handlers
    │   │   └─ bridge.ts    # EventBus → WebSocket bridge
    │   └─ runner/          # Agent execution wrapper
    │       └─ executor.ts  # Wraps agent.run/runStream
    │
    └─ ui/                  # Svelte SPA (plain Svelte, no SvelteKit)
        ├─ src/
        │   ├─ App.svelte           # Root component with tab routing
        │   ├─ lib/
        │   │   ├─ canvas/          # Neural Path renderer
        │   │   │   ├─ engine.ts    # Canvas2D rendering loop
        │   │   │   ├─ nodes.ts     # Node types (nucleus, pathway, synapse, tool)
        │   │   │   ├─ layout.ts    # Force-directed/organic layout algorithm
        │   │   │   ├─ effects.ts   # Glow, pulse, color temperature
        │   │   │   └─ interaction.ts # Click, hover, zoom, pan handlers
        │   │   ├─ events/          # Event processing
        │   │   │   ├─ stream.ts    # WebSocket client + event store
        │   │   │   └─ mapper.ts    # Event → visual element mapping (THE decoupling layer)
        │   │   ├─ vitals/          # Entropy heartbeat, metrics cards
        │   │   ├─ timeline/        # Bottom rail component
        │   │   ├─ command/         # Floating command bar
        │   │   ├─ workshop/        # Logic Flux components
        │   │   ├─ observatory/     # Entropy view components
        │   │   └─ export/          # Deploy components
        │   ├─ views/
        │   │   ├─ NeuralPath.svelte  # Neural Path (default)
        │   │   ├─ LogicFlux.svelte   # Logic Flux workshop
        │   │   └─ Entropy.svelte     # Entropy Observatory
        │   └─ app.css              # Design system (dark neural theme)
        └─ public/
            └─ fonts/               # JetBrains Mono font assets
```

### 8.2 The Event Mapper (Decoupling Layer)

The most architecturally important file: `ui/src/lib/events/mapper.ts`

This module translates runtime events into visual instructions. It is the ONLY place that knows about event type names. The canvas renderer receives abstract visual commands, not runtime events.

```typescript
// Conceptual interface — not literal code
interface VisualCommand {
  type: "add-node" | "add-connection" | "update-node" | "pulse" |
        "update-vitals" | "update-metrics" | "add-trace-entry";
  // ... payload varies by type
}

// The mapper function: runtime event → visual command(s)
function mapEvent(event: RuntimeEvent): VisualCommand[];
```

**Fallback behavior:** Unknown event types produce a trace entry but no canvas changes. This ensures forward compatibility.

**Plugin registration:** Custom mappers can be registered for specific event types, allowing future framework features to ship with optional Cortex visualization plugins.

### 8.3 Technology Choices

| Component | Choice | Rationale |
|---|---|---|
| Server runtime | Bun + Elysia | Aligns with framework + Dispatch. Fast. Native WebSocket. |
| Frontend framework | Svelte (plain SPA, not SvelteKit) | Shared with Dispatch. Reactive by nature. Smallest bundle. SvelteKit's SSR/routing is overkill for a local SPA — use client-side tab switching. |
| Canvas rendering | Canvas2D + D3.js force layout | Lighter than WebGL. D3's force simulation creates organic node placement. V1 ceiling: ~200 nodes before performance degrades — sufficient for single-agent runs up to ~25 iterations with tools. Upgrade path to WebGL/Three.js for V2 if complex multi-agent scenarios exceed this. |
| Charts | D3.js | Already used for canvas. Consistent. No extra dependency. |
| WebSocket | Native Bun WS | Zero dependencies. |
| Styling | Tailwind CSS | Utility-first, dark theme, fast iteration. |

### 8.4 WebSocket Protocol

Versioned event envelope for forward compatibility:

```typescript
interface CortexEvent {
  v: 1;                          // Protocol version
  ts: number;                    // Timestamp (ms)
  runId: string;                 // Execution ID
  agentId: string;               // Agent ID
  source: "eventbus" | "stream"; // Which channel produced this event
  type: string;                  // Event type name
  payload: Record<string, unknown>; // Event-specific data
}
```

Cortex connects to `ws://localhost:<port>/ws/runs/:runId` and receives a stream of `CortexEvent` objects. The mapper processes each one into visual commands.

### 8.5 Dual-Source Event Merging

The runtime produces two distinct event channels. The Cortex server merges them into the single `CortexEvent` WebSocket stream:

**Source 1: EventBus** — Lifecycle, reasoning, tool, entropy, strategy events (~48 event types in `AgentEvent` union). The server subscribes to the EventBus with a filter on `taskId`/`agentId` to scope events to the active run. These arrive as `source: "eventbus"` events.

**Source 2: AgentStreamEvent** — Per-token `TextDelta` events, `IterationProgress`, `StreamCompleted`, etc. from `agent.runStream()`. The server consumes the `AsyncGenerator<AgentStreamEvent>` and forwards each event as `source: "stream"` events.

**Merging strategy:** The executor (Section 8.6) uses `agent.runStream()` as the primary execution method. It forks a fiber that consumes the stream generator and forwards events to the WebSocket. Simultaneously, an EventBus subscriber captures lifecycle events and forwards those. Both write to the same WebSocket connection. Events are ordered by `ts` (server timestamp at forwarding time). The client-side event store handles minor reordering via a small buffer (50ms window).

**Event persistence for replay:** All `CortexEvent` objects for a run are appended to an `execution_events` SQLite table (`runId, seq, ts, source, type, payload_json`). This powers replay mode. Retention: configurable, default 50 most recent runs per agent.

### 8.6 Server Runtime Model

**Agent executor pool:** The server maintains a `Map<runId, RunContext>` of active executions. Each `RunContext` holds:
- The `ReactiveAgent` instance
- The `AbortController` for cancellation
- The set of connected WebSocket client IDs
- A `Ref` to the merged event buffer

**Concurrent execution:** Multiple agents can run simultaneously. Each run gets a unique `runId`. EventBus events are filtered by `taskId` (which maps 1:1 to `runId`) before forwarding. No cross-talk between runs.

**Client disconnect behavior:** When a WebSocket client disconnects, the run continues. Events are still persisted to SQLite. If the client reconnects (same `runId`), it receives a replay of missed events from the persistence layer, then resumes live streaming.

**Agent lifecycle:**
1. `POST /api/runs` → creates `RunContext`, builds agent from config, calls `agent.runStream()`
2. Events flow to connected clients + persist to SQLite
3. Agent completes → `RunContext` cleaned up, debrief persisted
4. `POST /api/runs/:id/pause` → calls `agent.pause()` (existing API)
5. `POST /api/runs/:id/stop` → calls `agent.stop()` via `AbortController` (existing API)

### 8.7 Required Runtime API Additions

Some Cortex features require new capabilities in the framework. These are separated from Cortex UI work:

| Feature | Runtime API Needed | V1 Scope |
|---|---|---|
| **Pause/Kill** | `agent.pause()`, `agent.stop()` | **EXISTS** — requires `.withKillSwitch()` on the agent builder. The executor must enable this automatically, or gracefully disable pause/kill buttons when kill switch is not configured. |
| **Throttle** (adjust budget mid-run) | New: `agent.adjustBudget(amount)` on CostService | **V1 stretch** — degrade gracefully (display-only slider showing remaining budget, no mid-run adjustment) |
| **Whisper** (inject context) | New: `agent.injectContext(text)` that appends to working memory before next iteration | **V1 stretch** — skip if not ready, show as disabled in command bar |
| **Redirect** (force strategy eval) | New: `agent.requestStrategySwitch()` that triggers reactive controller evaluation | **V1 stretch** — skip if not ready, show as disabled |

**V1 approach:** Ship pause and kill (which work today). Display throttle as read-only budget indicator. Gray out Whisper and Redirect with "coming soon" tooltip. This keeps the command bar visually complete while honestly scoping V1.

### 8.8 What We Build vs. What We Reuse

| Component | Status |
|---|---|
| EventBus + ~48 event types | **EXISTS** — bridge to WebSocket |
| Stream AsyncGenerator (`runStream`) | **EXISTS** — consume and forward |
| Agent execution (`run`/`runStream`) | **EXISTS** — wrap in executor |
| Config serialization (`AgentConfig`) | **EXISTS** — expose via API |
| Debrief/session/plan SQLite stores | **EXISTS** — query via API |
| Entropy sensor data | **EXISTS** — flows through EventBus |
| Strategy switching events | **EXISTS** — already instrumented |
| Dual-source WS bridge + event merging | **NEW** — ~400 lines |
| REST API layer (runs, configs, history) | **NEW** — ~500 lines |
| Agent executor pool + lifecycle mgmt | **NEW** — ~300 lines |
| Event persistence (SQLite table + replay) | **NEW** — ~200 lines |
| Svelte frontend (all views) | **NEW** — main effort |
| Neural Path canvas renderer | **NEW** — Canvas2D + D3 force layout |
| Event mapper (decoupling layer) | **NEW** — ~200 lines |
| Export generators | **NEW** — template-based, ~100 lines each |

**~50% of the data layer already exists.** The server integration layer and frontend are the primary new work.

---

## 9. Design System

### 9.1 Color Palette

```
Base:       #0f1219 (deep navy-charcoal)
Surface:    #1a1f2e (panel backgrounds)
Border:     #2a3040 (subtle borders)
Text:       #e2e8f0 (primary text)
Muted:      #64748b (secondary text)

Violet:     #8b5cf6 (cognition, reasoning, agent activity)
Cyan:       #06b6d4 (observations, returns, success data)
Amber:      #eab308 (tool calls, action, external reach)
Green:      #22c55e (success, completion, health)
Red:        #ef4444 (errors, failures, high entropy)

Entropy gradient: violet (#8b5cf6) → amber (#eab308) → red (#ef4444)
```

### 9.2 Typography

- **Data/labels:** JetBrains Mono (monospace), uppercase with underscores
- **Headings:** Same monospace, slightly larger
- **Body text (trace log, descriptions):** Same monospace, normal case
- **Numbers/metrics:** Monospace, tabular figures

The entire interface speaks in the language of the runtime — clinical, precise, machine-readable.

### 9.3 Visual Effects

- **Glow:** Nodes and active pathways have soft bloom (CSS box-shadow or canvas glow)
- **Pulse:** Active elements pulse with opacity animation (0.6 → 1.0 → 0.6, ~2s cycle)
- **Impulse travel:** Animated dot/gradient traveling along pathway lines (~500ms travel time)
- **Color temperature shift:** Canvas background subtly shifts based on entropy state
- **Fade-in:** New elements appear with a brief fade-in (200ms)
- **Particle effects (V2):** Subtle particles along active synapses for extra life

---

## 10. CLI Integration

### 10.1 Launch Command

```bash
rax cortex                    # Launch Cortex on default port (4200)
rax cortex --port 4201        # Custom port
rax cortex --attach <agentId> # Launch and immediately attach to a running gateway agent
rax cortex --open             # Launch and open browser automatically
```

### 10.2 Integration with Existing Commands

```bash
rax run "prompt" --cortex     # Run agent and auto-open Cortex for this execution
rax dev --cortex              # Dev mode with Cortex attached
```

---

## 11. V1 Scope

### Must Have (ships in V1)

- [ ] Neural Path canvas with nucleus, pathways, synapses, sub-agents
- [ ] Real-time event streaming via WebSocket
- [ ] Entropy heartbeat with trajectory indicator
- [ ] Vitals panel (cost, tokens, iterations)
- [ ] Trace log (timestamped event stream)
- [ ] Timeline rail with scrubbing
- [ ] Click-to-inspect on all visual elements
- [ ] Replay mode (rebuild past executions step by step)
- [ ] Command bar: pause, kill, throttle (read-only budget display for V1; see Section 8.7)
- [ ] Logic Flux: config editor with inline editing
- [ ] Logic Flux: run with modified config
- [ ] Execution history (list past runs with metrics)
- [ ] `rax cortex` CLI command
- [ ] Event mapper decoupling layer
- [ ] Elysia server + WebSocket bridge

### Nice to Have (V1 stretch)

- [ ] Fork from any node (branch execution)
- [ ] A/B split comparison
- [ ] Prompt laboratory
- [ ] Tool workshop (test tools in isolation)
- [ ] Config snapshots with diff
- [ ] Export: AgentConfig JSON + Builder Code
- [ ] Batch run (eval suite)

### V2

- [ ] Export: GitAgent, Docker, Fly.io, Railway
- [ ] Deploy directly from Cortex
- [ ] Evolution view (cross-run analytics)
- [ ] Aggregate entropy heatmap
- [ ] Diff overlay (ghost alternate execution)
- [ ] WebGL/Three.js upgrade for 3D neural visualization
- [ ] Cortex Cloud (hosted, multi-user, feeds into Dispatch)
- [ ] Plugin API for custom event renderers
- [ ] Benchmark report generation

---

## 12. Error Handling & Degraded Modes

### 12.1 Connection Loss

When the WebSocket connection drops:
- Canvas freezes at last known state with a "CONNECTION LOST" overlay (amber border pulse)
- Automatic reconnection with exponential backoff (1s, 2s, 4s, max 30s)
- On reconnect: replay missed events from SQLite persistence, then resume live stream
- If the agent completed while disconnected, show the final state on reconnect

### 12.2 Event Ordering

Events from two sources (EventBus + stream) may arrive slightly out of order:
- Client-side buffer window (50ms) sorts events by `ts` before processing
- If a `ToolCallCompleted` arrives without a matching `ToolCallStarted`, render the tool node in a "late-arrival" state (dimmed synapse) and backfill when the start event arrives
- If start never arrives within 5s, render as an orphaned completion (still functional, just no firing animation)

### 12.3 Canvas Scaling

For executions that exceed expected complexity:
- Auto-zoom-out when node count exceeds 100 to maintain overview
- Collapse completed sub-agent clusters into summary nodes (expandable on click)
- If node count exceeds 200, switch to "compact mode" — simplified rendering with reduced effects, no glow/pulse, thinner lines

### 12.4 Agent Errors

When an agent execution fails:
- The failing pathway flashes red and shows a break point
- The error message appears in the trace log with full stack trace (expandable)
- The nucleus shifts to red border, heartbeat flatlines
- The run is still inspectable — all prior steps are preserved

---

## 13. Testing Strategy

### 13.1 Server Tests (Bun test)

- **WebSocket bridge:** Verify EventBus events and stream events are correctly merged and forwarded. Test filtering by runId/agentId.
- **REST API:** Standard endpoint tests for runs, configs, history CRUD.
- **Executor pool:** Concurrent run management, disconnect handling, cleanup on completion.
- **Event persistence:** Write/read/replay round-trip. Retention policy enforcement.

### 13.2 Frontend Tests (Vitest + Testing Library)

- **Event mapper:** Unit tests for every known event type → visual command mapping. Test unknown event type fallback.
- **Canvas engine:** Snapshot tests for node layout at various iteration counts.
- **Vitals/timeline components:** Verify correct data display for known inputs.
- **WebSocket client:** Mock WS server, test reconnection and replay behavior.

### 13.3 Integration Tests

- **End-to-end:** Launch `rax cortex`, execute a test agent (using `withTestScenario`), verify WebSocket delivers expected events, verify replay produces identical event sequence.

### 13.4 Visual Regression (V2)

- Screenshot comparison tests for Neural Path at key states (initial, mid-execution, completed, error).

---

## 14. Success Criteria

1. **The screenshot test:** A screenshot of Neural Path during an active execution makes someone stop scrolling and click.
2. **The debugging test:** A developer can identify why an agent failed faster using Cortex than reading raw logs.
3. **The tuning test:** A developer can improve an agent's cost/quality ratio by iterating in Logic Flux.
4. **The decoupling test:** Adding a new reasoning strategy to the framework requires ZERO changes to Cortex code for basic visualization.
5. **The performance test:** Cortex adds less than 5% overhead to agent execution (event bridging cost).

---

## 15. Relationship to Dispatch

Cortex is the local developer tool. Dispatch is the hosted automation platform. They share:
- Svelte frontend components
- Elysia server patterns
- SQLite storage patterns
- Design system (dark neural theme)

**Migration path:** Cortex locally → Cortex Cloud (hosted Cortex with auth + team features) → Dispatch (full automation platform with Cortex embedded as the monitoring/debugging layer).

Cortex proves the visualization and workshop concepts. Dispatch productizes them.

---

## Appendix A: Stitch Design Prompt

> **Design "Cortex" — a neural-themed cognitive interface for an AI agent runtime. This is a living window into a synthetic thinking organism.**
>
> **Core metaphor:** The brain. Agents are synthetic neural organisms. Their execution is visible as neural pathways firing, synapses connecting, impulses traveling. The interface should feel like watching a mind think — alive, rhythmic, purposeful.
>
> **Layout:** Deep navy-charcoal base (#0f1219). Large neural canvas (left 65%). Context-sensitive right panel (30%). Thin timeline rail at bottom. Floating command bar center-bottom. Left icon sidebar for navigation. Top bar: "CORTEX | RUNTIME_V4.2" with tab navigation: NEURAL PATH / LOGIC FLUX / ENTROPY.
>
> **Neural Canvas (main view):** A central glowing nucleus node labeled "AGENT_CORE_ALPHA" with "STATE: REASONING_ITER_04". Neural pathways radiate outward — each pathway is a reasoning chain. Tool calls appear as synapse connections firing to peripheral tool nodes (web-search, file-write icons). The pathways glow with impulses traveling along them — violet for reasoning, amber for tool calls, cyan for observations returning. The overall canvas has a subtle color temperature shift based on the agent's confidence state — currently warm violet-blue indicating focused exploration. Completed pathways are solid, active ones pulse. The structure grows organically like a neural network forming in real-time. Sub-agents appear as smaller nuclei budding off the main one, connected by thick axons.
>
> **Entropy Vitals (right panel, top):** Heading "VITALS: COGNITIVE_ENTROPY" with a status badge [CONVERGING] in green. An EKG-style brainwave monitor shows the entropy heartbeat — a continuous line with subtle oscillations, currently stable. Below: "PEAK: 0.842 η" and "ΔE: -0.12 ↓" (entropy decreasing). Three metric cards: COST $0.42, TOKENS 12.4k, ITER 04/07.
>
> **Trace Log (right panel, bottom):** Heading "TRACE: LOGICAL_OPERATIONS". Timestamped entries in monospace: "[08:42:11] INITIATING_DEEP_REASONING_CHAIN" with indented thought text, "[08:42:15] CALL: web_search.v3 { query: ... }", "[08:42:18] SUCCESS: Received 12 objects." A blinking cursor at the bottom suggests live streaming.
>
> **Timeline Rail (bottom):** Horizontal bar showing iterations T_01 through T_04 (current), sized proportionally to duration. Current iteration highlighted with "ACTIVE" label. A gold entropy curve overlays the timeline showing the trajectory. Step counter "04/07" at right.
>
> **Command Bar (floating, center-bottom):** Sleek dark bar with: whisper icon (inject thought), redirect icon (strategy switch), "THROTTLE" slider at 88%, pause button, fork button, kill button (red X). Minimal, keyboard-driven aesthetic.
>
> **Additional screens to show:**
> 1. "LOGIC FLUX" tab — agent config as interactive tree (AGENT → PROVIDER, REASONING, TOOLS, GUARDRAILS, COST, PERSONA) with inline-editable values. Right side: experiment runner with prompt input, Run/A/B Run buttons, and snapshot controls.
> 2. A complex Neural Path — agent with 3 sub-agents, 8+ iterations, multiple branching pathways, one pathway glowing red (failed tool call), showing organic complexity of a multi-step execution.
> 3. "ENTROPY" tab — execution history as cards with mini-sparklines, evolution charts showing performance over time, aggregate metrics dashboard.
>
> **Visual style:** Dark, clinical, alive. Neuroscience visualization meets mission control. Glowing edges with soft bloom. Monospace typography for all data (JetBrains Mono). Accent palette: violet (#8b5cf6) for cognition, cyan (#06b6d4) for observations, amber (#eab308) for tool activity, green (#22c55e) for success, red (#ef4444) for errors. The interface should feel like observing a living synthetic mind — not reading a log file.
