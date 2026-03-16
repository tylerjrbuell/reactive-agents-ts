# Project Dispatch — Design Spec

**Codename**: Project Dispatch (final brand TBD)
**Date**: 2026-03-15
**Status**: Draft
**Repo**: Separate repo, shared brand with Reactive Agents ("Powered by Reactive Agents")

---

## Vision

Claude Code for automation. Reactive Agents is the language.

A natural language automation builder where users describe what they want automated and a meta-agent (the DispatchAgent) scaffolds, deploys, and monitors purpose-built reactive agents to carry it out. The system learns from every run, getting smarter and more reliable over time.

**Core promise**: Describe it. Agents handle the rest.

---

## Philosophy & Brand

- **Voice**: Confident, direct, understated. Short sentences. No hype. The product proves itself.
- **Philosophy**: Autonomous intelligence. Agents that learn, adapt, and self-heal. You move on.
- **Aesthetic**: Dark-first, developer-tool polish. Sharp typography, monospace for agent output, strong signature accent color. Light mode available. Clean, dense, no wasted space.
- **Emotional core**: "This is seriously capable and I barely had to think about it."
- **Brand architecture**: Own identity + "Powered by Reactive Agents" trust badge.
- **Target users**: Progressive disclosure — simple enough for non-technical users, power users can pop the hood to see and edit raw agent configs.

---

## Origin & Context

This product is the evolution of ZenRunners, a prior project that identified the need for an "automated automation" platform. Building ZenRunners led to the creation of the Reactive Agents framework (originally Python, now fully TypeScript/Bun). The original ZenRunners architecture required 6+ services (Vue frontend, PocketBase, Bun engine, Redis, FastAPI, Python agents) to get an agent to run a task. With reactive-agents-ts v0.8.x, that entire backend collapses into a single Bun process.

**Prior art studied**:
- **ZenRunners** (tylerjrbuell/zenrunners) — original prototype, multi-service architecture
- **OpenClaw/ClawdBot** — personal AI assistant across messaging platforms, skills platform, always-on agent
- **n8n** — visual workflow automation, node-graph editor

**Key differentiators from all three**:
1. A meta-agent that writes agents, not just runs pre-built skills or visual nodes
2. Self-healing, adaptive automations powered by reactive intelligence (entropy sensing, strategy switching, learning engine)
3. Data flywheel — every run improves future runs via the Reactive Agents telemetry API
4. Full power of an open-source agent framework underneath, not a proprietary runtime

---

## Architecture

### Approach: Process-Isolated Bun Server (Approach B)

North star: evolve toward Approach C (microkernel — agents all the way down) over time.

```
[ Browser — Svelte SPA ]
    |
    | WebSocket (realtime streaming)
    | REST (CRUD)
    |
[ Bun Server (Elysia) — main process ]
  |-- Static UI assets (Svelte build)
  |-- REST API (runner CRUD, session management, config)
  |-- WebSocket server (streams agent events to UI)
  |-- DispatchAgent (meta-agent, in-process)
  |-- Agent Supervisor
  |     |-- [Runner Process 1] <-- isolated Bun subprocess
  |     |-- [Runner Process 2] <-- isolated Bun subprocess
  |     |-- [Runner Process N]
  |-- SQLite (bun:sqlite)
  |     |-- runners (config, state, tenant_id)
  |     |-- runs (execution history, debriefs)
  |     |-- tools (custom tool definitions)
  |     |-- schedules (cron, triggers)
  |-- MCP Server Registry (available tool providers)
```

### Why This Architecture

- **One process, one language, one runtime**: Bun runs everything. No Redis, no PocketBase, no Python bridge.
- **Agent isolation**: Each runner executes in a child process. Crashes don't take down the server. Supervisor restarts failed runners.
- **Self-healing**: The Supervisor monitors heartbeats, restarts unresponsive runners, and can escalate to the DispatchAgent for reconfiguration.
- **Cloud-ready**: The same Bun server deploys to a VPS/container. Child processes become containers. SQLite swaps to Turso for edge distribution.
- **SaaS-ready from day one**: Multi-tenant data model (`tenant_id` on all tables). Single-user local mode is `tenant_id = "local"`.

### Data Flow: Creating a Runner

```
1. User types: "Monitor my GitHub repo for new issues and summarize them daily"

2. WebSocket -> Bun Server -> DispatchAgent.chat()

3. DispatchAgent reasons about the request:
   - Assesses feasibility: are GitHub MCP tools available?
   - If not: "I'd need GitHub access to do this. Want to connect it?"
   - If yes: designs runner config (tools, schedule, strategy, guardrails)
   - Creates custom tools if needed (writes TypeScript tool definition)
   - Presents high-level config to user in draft state

4. User reviews draft:
   - Sees: instructions, tools, schedule, strategy
   - Can ask for changes in natural language
   - Can toggle "View Config" for raw JSON (power users)
   - Says "looks good" or DispatchAgent recommends publishing

5. Runner transitions: draft -> ready -> active

6. Supervisor spawns runner as child process

7. Runner executes on schedule, reports events via IPC
   -> Supervisor forwards to EventBus
   -> EventBus forwards to WebSocket
   -> UI updates in realtime

8. Run completes -> debrief stored -> entropy data sent to telemetry API
```

---

## The DispatchAgent (Meta-Agent)

The core product experience. A reactive agent whose "code" is other reactive agents.

### Responsibilities

1. **Understand** — parse what the user wants automated, ask clarifying questions if ambiguous
2. **Assess feasibility** — check available tools/MCP servers, determine if the task is achievable. Fail fast and clearly if not.
3. **Design** — decide: single agent or team? What tools? What schedule/trigger? What reasoning strategy? What guardrails?
4. **Scaffold** — generate the runner definition (instructions, tools, schedule, strategy, guardrails)
5. **Create custom tools** — if no existing tool fits, write a TypeScript tool definition and register it
6. **Test** — dry run or sanity check before publishing
7. **Deploy** — hand off to the Supervisor
8. **Monitor & heal** — watch for failures, reconfigure or escalate to user

### Interaction Modes

The DispatchAgent supports multiple modes depending on user preference and task complexity:

- **Chat-first, wizard-assisted**: User describes intent, DispatchAgent asks clarifying questions, scaffolds everything. Default for new users.
- **Chat-first, preview-and-edit**: Same conversational start, but DispatchAgent shows structured preview before deploying. User can adjust. Default for returning users.
- **Template-guided with NL customization**: User picks from curated categories, customizes via natural language. Guided path for common use cases.

### Feasibility Gate

The worst UX is an agent that accepts a task and then fails silently. The DispatchAgent must fail fast:

```
User: "Automatically pay my bills when they arrive"
DispatchAgent: "I can monitor your email for bills and notify you,
  but I can't make payments — that would require bank access
  which isn't available. Want me to set up monitoring + notifications?"
```

### Custom Tool Creation

The DispatchAgent can write new tools at runtime:
- Generates a TypeScript function conforming to the tool interface
- Registers it with the tool registry
- Assigns it to the runner being built
- All without the user touching code

---

## The Runner Model

### What the User Sees

**Runner Card (dashboard):**
```
+-------------------------------------+
| GitHub Issue Summarizer              |
+-------------------------------------+
| Instructions: Monitor reactive-     |
|   agents-ts for new issues and      |
|   summarize them daily              |
|                                     |
| Tools: github, email                |
| Schedule: Daily at 9am             |
| Strategy: Plan & Execute            |
| Status: * Active                    |
|                                     |
| [Edit] [Pause] [View Config >]     |
+-------------------------------------+
```

**Progress View (during execution):**
```
+-------------------------------------+
| GitHub Issue Summarizer -- Running   |
+-------------------------------------+
| [done] Fetched 12 new issues        |
| [done] Categorized by priority      |
| [....] Generating summary...        |
| [    ] Sending email                |
|                                     |
| Tokens: 1,240  Duration: 8.2s      |
+-------------------------------------+
```

### Runner Lifecycle

```
drafting -> ready -> active -> paused -> stopped
    ^                                      |
    +---------- (edit/reconfigure) --------+
```

- **Drafting**: DispatchAgent is building the config. UI shows live preview. User can intervene, ask questions, tweak. Co-editing experience.
- **Ready**: Config complete, user has reviewed. Not yet running. The "publish" gate.
- **Active**: Supervisor has spawned the process. Runner is executing or scheduled.
- **Paused**: User paused the runner. Can be resumed.
- **Stopped**: Runner is not executing. Editing puts it back to drafting.

### Editing Modes

- **Natural language**: "Change this to run every hour instead" -> DispatchAgent updates config, UI reflects the change
- **Direct config edit**: Power user opens JSON config and modifies it directly

### Runner Composition

A single runner may use sub-agents internally (e.g., one fetches data, another summarizes, another sends notifications). The user sees one runner with task progress. The DispatchAgent decides when to compose vs. use a single agent.

---

## Intelligence Layer — The Moat

### The Data Flywheel

Every automation that runs through the platform makes the next one smarter.

```
User creates runner -> Runner executes -> Entropy data collected
    |
    v
Reactive Intelligence scores each run:
  - Which reasoning strategy worked best?
  - Where did the agent get stuck? (entropy spikes)
  - What tool sequences were most effective?
  - When did early-stop save tokens vs. hurt quality?
    |
    v
Learning Engine feeds back:
  - Conformal calibration improves confidence scores
  - Thompson Sampling learns optimal strategy per task type
  - Skill synthesis extracts reusable patterns
    |
    v
Next run is smarter. Next similar runner starts pre-optimized.
```

### Telemetry Integration

The Reactive Agents telemetry API (api.reactiveagents.dev/v1/stats) already collects entropy data from all reactive agent deployments. This app:

1. **Tags telemetry** with runner category/fingerprint for clustering similar tasks
2. **Pulls calibration data** when scaffolding new runners ("runners like this perform best with Plan-Execute")
3. **Contributes the highest volume** of telemetry data, improving the intelligence pool for all users — including open-source framework users

### Skill Synthesis

When a runner pattern works well repeatedly, the system extracts it as a reusable skill:
- "This 3-step GitHub monitoring pattern has a 95% success rate across 50 runs"
- Promoted to a template available to all users
- Feeds back into the DispatchAgent's knowledge for scaffolding recommendations

### Competitive Moat

n8n, Zapier, Make — they run the same workflow the same way every time. They are static execution engines. Project Dispatch has:
- Adaptive reasoning strategies that switch mid-execution
- Entropy sensing that detects when an agent is stuck
- Cross-runner learning that improves with usage
- A telemetry dataset that grows with every deployment

Competitors would need both the framework AND the accumulated intelligence data to replicate this.

---

## Tech Stack (MVP)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Server runtime | Bun | Matches framework, fast, native SQLite |
| HTTP framework | Elysia | Bun-native, lightweight, typed |
| Frontend | Svelte (SvelteKit) | Reactive model fits realtime UX, small bundles |
| Database | SQLite (bun:sqlite) | Zero infrastructure, embedded, WAL mode. Turso-ready for scale. |
| Agent framework | @reactive-agents/* | The entire backend |
| Realtime | WebSocket (native Bun) | Streams agent events to UI |
| Telemetry | api.reactiveagents.dev | Existing entropy/intelligence pipeline |

**Not in stack**: Redis, PocketBase, Docker (for MVP), separate backend process.

---

## Data Model (SaaS-Ready)

All tables include `tenant_id`. Local single-user mode uses `tenant_id = "local"`.

### runners
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| tenant_id | TEXT | Tenant identifier |
| name | TEXT | Runner display name |
| instructions | TEXT | Natural language description of what this runner does |
| config | JSON | Full ReactiveAgentBuilder serialized config |
| tools | JSON | Array of tool names/IDs assigned to this runner |
| schedule | JSON | Cron expression, trigger config, or null for manual |
| strategy | TEXT | Reasoning strategy (react, plan-execute, etc.) |
| state | TEXT | drafting, ready, active, paused, stopped |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### runs
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| tenant_id | TEXT | Tenant identifier |
| runner_id | TEXT FK | Which runner executed |
| status | TEXT | pending, running, completed, failed |
| result | JSON | Agent result payload |
| debrief | JSON | AgentDebrief from DebriefSynthesizer |
| metrics | JSON | Tokens, duration, steps, cost |
| entropy_scores | JSON | Reactive intelligence entropy data |
| started_at | DATETIME | |
| completed_at | DATETIME | |

### custom_tools
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| tenant_id | TEXT | Tenant identifier |
| name | TEXT | Tool name |
| description | TEXT | Tool description |
| schema | JSON | Input parameter schema |
| implementation | TEXT | TypeScript function source |
| created_by | TEXT | "dispatch-agent" or "user" |
| created_at | DATETIME | |

### sessions
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| tenant_id | TEXT | Tenant identifier |
| runner_id | TEXT FK | Associated runner (null for DispatchAgent sessions) |
| messages | JSON | Chat history |
| created_at | DATETIME | |
| updated_at | DATETIME | |

---

## Reactive Agents Framework Enhancements

Six enhancements needed in the framework that benefit it independently of this product:

### 1. Serializable AgentConfig (JSON <-> Builder Roundtrip)

**Current state**: Builder is fluent-only, no serialization.
**Need**: Any tool that generates, stores, or shares agent configs needs a JSON-serializable format. This includes CLI scaffolding, the DispatchAgent, A2A agent cards, and runner persistence.
**Deliverable**: `AgentConfig` schema that can be serialized to JSON and deserialized back into a configured builder.

### 2. Dynamic Tool Registration

**Current state**: Tools must be defined at build time via `.withTools()`.
**Need**: Agents that create tools for other agents at runtime. The DispatchAgent writes custom tools and assigns them to runners without rebuilding.
**Deliverable**: `ToolService.registerTool()` method that accepts a tool definition post-build.

### 3. Task-Level Progress Events

**Current state**: `IterationProgress` is per-iteration (step N of M).
**Need**: Multi-step task visibility: "step 1 of 4: fetching issues" -> "step 2 of 4: categorizing". Useful for any EventBus consumer, not just this app.
**Deliverable**: `TaskProgress` event type with step label, step index, total steps, and optional metadata.

### 4. Dry Run / Validation Mode

**Current state**: No equivalent.
**Need**: "Plan but don't execute" mode for testing, CI, evaluation, and the DispatchAgent's pre-publish validation step.
**Deliverable**: Builder option `.withDryRun()` or execution option `{ dryRun: true }` that runs reasoning but skips tool execution.

### 5. Subprocess Agent IPC

**Current state**: Subprocess sandbox exists in identity package. No structured IPC protocol.
**Need**: Production-grade protocol for Supervisor <-> Agent process communication. Spawn, configure, monitor, stop, restart agents as child processes with typed message passing.
**Deliverable**: `AgentProcess` abstraction with `spawn()`, `send()`, `on()`, `kill()` + typed IPC message protocol. Heartbeat monitoring built in.

### 6. Cross-Runner Learning API

**Current state**: Learning Engine operates per-agent instance.
**Need**: Share calibration data and skill patterns across agent instances. When one runner learns "Plan-Execute works best for GitHub monitoring tasks," all similar runners benefit.
**Deliverable**: `LearningEngine.shareCalibration()` and `LearningEngine.loadCalibration()` methods. Skill synthesis output format that can be stored and loaded.

---

## MVP Scope

### v1 — Core Experience
- DispatchAgent chat interface (conversational runner creation)
- Runner lifecycle: draft -> ready -> active -> paused -> stopped
- Runner dashboard: status cards, progress view, run history
- Agent Supervisor: spawn/monitor/restart runner subprocesses
- 3-5 built-in MCP tool packs (web/HTTP, file system, email, GitHub, scheduling)
- Custom tool creation by DispatchAgent
- High-level config view with "View Config" toggle for power users
- Natural language editing ("change this runner to run hourly")
- SQLite persistence for runners, runs, debriefs
- Multi-tenant data model (single-user local mode)
- Telemetry collection on every run (entropy, strategy, tools, tokens)
- Reactive intelligence integration (calibration data informs runner scaffolding)

### v2 — SaaS & Native
- User accounts + auth (multi-tenant)
- Cloud deployment: promote runners from local to hosted
- Electrobun native app shell
- Tool marketplace / community MCP servers
- Runner templates (curated starting points)
- Notifications (desktop, email, webhook)
- Skill synthesis pipeline (extract reusable patterns from successful runs)
- Runner fingerprinting (cluster similar runners across tenants for learning)

### v3 — North Star
- Microkernel architecture: system agents managing system agents (Approach C)
- Runner sharing: export/import runner configs
- Multi-user collaboration
- Analytics dashboard: cost, usage, success rates across runners
- Mobile companion app
- Cross-runner learning at scale (global calibration from telemetry API)

### Not in Scope
- Chrome extension
- Billing/subscription management in MVP
- Visual node-graph editor (natural language replaces this)

---

## Future: Electrobun Native Shell (v2)

The migration path from web app to native desktop:
- Bun server becomes the Electrobun main process
- Svelte SPA becomes the webview content
- System tray integration for always-on monitoring
- Native notifications for runner events
- Near-zero throwaway work from MVP

---

## Success Criteria

### MVP Launch
- A user can describe an automation in natural language and have a working runner active within 2 minutes
- The DispatchAgent correctly identifies missing tools/resources and communicates clearly
- Runners self-heal from transient failures without user intervention
- Task progress is visible in realtime during execution
- Power users can view and edit raw config

### Product-Market Fit Signals
- Users create 3+ runners (indicates value beyond novelty)
- Runners run unattended for 7+ days (indicates reliability/trust)
- Users return to create new runners (indicates stickiness)
- Telemetry shows improving success rates over time (intelligence flywheel working)
