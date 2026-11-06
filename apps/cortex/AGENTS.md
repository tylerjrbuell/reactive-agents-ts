# Cortex — Agent Guide

Instructions for AI agents and contributors working on **`@reactive-agents/cortex`** (Bun server + SvelteKit UI). For monorepo-wide Effect-TS rules, builder patterns, and release workflow, read the repo root **`AGENTS.md`**.

---

## What Cortex Is

A **local desk** for Reactive Agents: ingest agent events over WebSocket, persist to SQLite, fan out **live** messages to subscribers, and expose a **SvelteKit** UI that dogfoods **`@reactive-agents/svelte`**.

| Layer | Location | Stack |
|-------|-----------|--------|
| Server | `apps/cortex/server/` | Bun, Elysia, Effect-TS, `bun:sqlite` |
| UI | `apps/cortex/ui/` | SvelteKit 2, Svelte 5 (runes), Tailwind, Vite, D3 (run view) |

---

## Quick Start (Human or Agent)

From repo root: `bun install`.

From **`apps/cortex`**:

```bash
bun start
```

- **UI:** http://localhost:5173 — use this in dev (Vite proxies `/api` and `/ws` to the server).
- **API/WS (direct):** http://localhost:4321

| Script | Purpose |
|--------|---------|
| `bun start` | `scripts/dev-stack.ts` — server + UI together; sets `CORTEX_NO_OPEN=1` on the server child. |
| `bun run dev` / `dev:server` | Elysia + SQLite + routes + WS only. |
| `bun run dev:ui` | SvelteKit dev only (expects server on 4321). |
| `bun run build:ui` | Production UI build → `ui/build`. |
| `bun test` | Server tests under `server/tests/`. |

**Two ways to run cortex:**
- **From any project (npm):** `bun add @reactive-agents/cortex` then `rax cortex` — the CLI lazy-loads the package and starts the bundled server + UI.
- **From source repo (contributors):** `bun cortex` runs `scripts/dev-stack.ts` — server + Vite UI dev mode in parallel. Same as `bun start` from this folder.

Pair with `rax run "<prompt>" --cortex --provider …` so the agent uses `.withCortex()` against `CORTEX_URL` (default `http://127.0.0.1:4321`).

UI tests: `cd ui && bun test src/lib`. UI build: `cd ui && bun run build`.

User-facing overview: **`README.md`** in this folder.

---

## Environment

| Variable | Default | Notes |
|----------|---------|--------|
| `CORTEX_PORT` | `4321` | HTTP + WebSocket listen port. |
| `CORTEX_URL` | — | Public base URL (HTTP) for display / agent `.withCortex()` alignment. |
| `CORTEX_NO_OPEN` | unset | `1` disables opening a browser when starting the server alone. |
| `CORTEX_LOG` | `info` | Server log verbosity: `error` \| `warn` \| `info` \| `debug` \| `off`. **`debug`** logs every persisted ingest event, empty bridge broadcasts, replay counts. The framework **`CortexReporter`** reads the same variable for connection / dropped-event warnings. |
| `CORTEX_SKILL_SCAN_ROOT` | — | Optional extra absolute path merged with `process.cwd()` and the Cortex app root when discovering `SKILL.md` trees for Lab / `GET /api/skills/files`. |

DB file defaults to **`.cortex/cortex.db`** relative to the server process cwd (usually `apps/cortex`). See `server/types.ts` → `defaultCortexConfig`.

---

## Server Architecture (High Level)

1. **`server/index.ts`** — Wires routers, `/ws/ingest`, `/ws/live/:agentId`, optional static UI from `ui/build`.
2. **Ingest** — Agents POST events to **`/ws/ingest`**. `CortexIngestService` persists rows and **`CortexEventBridge.broadcast(agentId, liveMsg)`** — subscribers are keyed by **real `agentId`**, not run id.
3. **Live** — Clients connect to **`/ws/live/:agentId?runId=`**. `runId` triggers **replay** of stored events for that run on open (`ws/live.ts` + `replayRunEvents`).
4. **REST** — `GET /api/runs`, `GET /api/runs/:runId`, `GET /api/runs/:runId/events`, **`POST /api/runs`** (desk runner). Skills: `GET /api/skills/files`, `GET /api/skills/file?path=`, `GET /api/skills/sqlite/:id` (open-skill YAML + markdown). Workspace picker: `GET /api/workspace/check?path=` (absolute existing dir → normalised path, else 400), `GET /api/workspace/recent`, `GET /api/workspace/candidates` (ranked suggestions: launch dir's git root, launch dir = server cwd, `CORTEX_SKILL_SCAN_ROOT`, recent; plus `home`), `GET /api/workspace/browse?path=&hidden=1` (subdirectory names + `isGitRepo` only, home by default, 400 on relative/missing paths, capped at 500 entries). Built-in toolset shortcuts: `GET /api/tools/toolsets`. Routers under `server/api/`.
5. **Workspace** — `workspace` (absolute existing dir) on a chat session / run / saved agent maps to `.withTools({ workspace })`: file tools confine to it and `shell-execute` runs in it. Chat create/PATCH and `POST /api/runs` refuse a bad path with 400 (`services/workspace-dir.ts`); chat sessions forward it only when tools are on. Shell options ride in `terminalShellOptions` (`cwd`, `allowUnsafeCwd`, `timeoutMs`, `maxOutputChars`, `commandAccess`, `sandbox`).

Canonical live payload shape: **`CortexLiveMessage`** in `server/types.ts` (`v`, `ts`, `agentId`, `runId`, `source`, `type`, `payload`). Event `type` is the AgentEvent `_tag` string; `payload` is the event object as JSON.

---

## WebSocket Paths (Critical)

| Path | Role |
|------|------|
| `/ws/ingest` | Agent → server; JSON `CortexIngestMessage`. |
| `/ws/live/:agentId?runId=` | UI (or tools) → server; **`agentId` must match the agent that receives broadcasts** (same string used in `broadcast(agentId, …)`). |

**Gotcha — Stage grid:** `+layout.svelte` historically used a path like **`/ws/live/cortex-broadcast`**. The bridge **only** fans out to subscribers registered under each message’s **`agentId`**. Until Stage subscribes using the **same `agentId`** as ingest (or the server adds a separate fan-out channel), the desk grid may not show live events. **Run detail** is correct: `run-store.ts` loads `GET /api/runs/:runId`, then connects to **`/ws/live/${encodeURIComponent(agentId)}?runId=…`**.

---

## UI Architecture

### Constants and proxy

- **`ui/src/lib/constants.ts`** — `CORTEX_SERVER_URL` and `WS_BASE` use **`window.location`** in the browser so fetches and WS go through the Vite dev origin; SSR fallback uses `localhost:4321`.
- **`ui/vite.config.ts`** — Proxies **`/api`** and **`/ws`** to `http://localhost:4321` (and WS).

### Routes

| Route | Purpose |
|-------|---------|
| `/` | Beacon — agent grid, empty state, bottom bar, `stage-store` + layout `agentStore`. |
| `/chat` | Chat — conversational sessions (`ChatSessionList`, `ChatPanel`, etc.). |
| `/runs` | Trace hub — run history list / entry to run detail. |
| `/run` | Placeholder hub for run UX. |
| `/run/[runId]` | **Run view** — `RunDetail.svelte`, run/signal/trace stores, D3 monitor, trace panel, debrief, bottom tabs. |
| `/lab` | Lab — builder, gateway agents, skills (SKILL.md + SQLite), tools tabs. |
| `/settings` | Settings — provider defaults, notifications, storage. |

### UI theme (stay consistent)

Cortex is a **local desk**: readable, keyboard-friendly, and visually aligned with **Reactive Agents docs** (`docs.reactiveagents.dev`), not a generic marketing site.

| What | Where |
|------|--------|
| CSS variables (light/dark surfaces, markdown, borders) | `ui/src/app.css` — `--cortex-*`, `--ra-*` (violet / cyan brand) |
| Tailwind tokens (surfaces, primary/secondary, fonts) | `ui/tailwind.config.ts` — Geist (UI), JetBrains Mono (data/code); display wordmark uses Outfit in `ui/src/app.html` |
| Shell layout (nav, command palette, Beacon WS) | `ui/src/routes/+layout.svelte` |
| Beacon desk grid (fluid slots, panel chrome) | `AgentGrid.svelte`, `.cortex-beacon-desk-grid` in `app.css` |
| **Ambient desk shell** (violet/cyan orbs behind content — all full-height routes) | `CortexDeskShell.svelte`; wrap each page root the same way as Beacon (`/`, `/chat`, `/runs`, `/lab`, `/settings`, `/run`, `/run/[runId]`) |
| Run detail (vitals, trace, summary shell, bottom tabs + panel) | `RunDetail.svelte`, `VitalsStrip`, `TracePanel`, `RunOverview`, `RunFinalDeliverable` |
| Visual reference mockups | `docs/superpowers/specs/cortex-design-export.html` |

When adding pages or chrome, reuse these tokens and patterns so the app stays one coherent **Cortex** product (same contrast behavior in light mode as enforced by the `html:not(.dark)` overrides in `app.css`).

### Layout context

- **`routes/+layout.svelte`** — Creates **`createAgentStore()`**, **`createStageStore()`**, `setContext("agentStore" | "stageStore", …)`, live WS for Beacon, toasts, command palette shell, top nav. Calls **`stageStore.setNavigate(goto)`** in `onMount`.
- **`routes/+page.svelte` (Beacon)** — Must use **`getContext`** for both stores (do not instantiate a second `createStageStore()` on the page).

### Stores (UI `lib/stores/`)

| Module | Role |
|--------|------|
| `agent-store.ts` | Multi-agent desk; REST seed + `handleLiveMessage` for grid nodes. |
| `stage-store.ts` | First-connect auto-nav, bottom bar `submitPrompt` → `POST /api/runs` (501 handling). |
| `ws-client.ts` | Deduped WS clients by URL; reconnect backoff in `constants.ts`. |
| `framework.ts` | Wrappers around **`@reactive-agents/svelte`** (`createCortexAgentRun`, etc.). |
| `run-store.ts` | Single run: REST bootstrap → live WS with correct `agentId`; vitals + event log + debrief. |
| `signal-store.ts` | D3-ready series + `selectIteration`. |
| `trace-store.ts` | `IterationFrame[]` for trace panel. |

### Svelte 5

Components use **`$props`**, **`$state`**, **`$derived`**, **`$effect`** where appropriate. Store auto-subscriptions **`$runStore`** in templates are valid. **`RunDetail`** is remounted with **`{#key $page.params.runId}`** so run-scoped stores reset per run.

### Dogfooding

The UI depends on **`@reactive-agents/svelte`** (via `framework.ts` and package exports). Keep workspace types/build aligned if you change the Svelte package’s public API.

---

## Specs and Plans

Archived plans live in `wiki/Planning/Implementation-Plans/Superpowers/archive/` (historical; the code is the current truth):

| Doc | Content |
|-----|---------|
| `2026-03-31-cortex-app-phase1-server.md` | Server foundation. |
| `2026-03-31-cortex-app-phase2-ui-foundation.md` | UI scaffold, stores, Tailwind. |
| `2026-03-31-cortex-app-phase3-stage-view.md` | Stage view components. |
| `2026-03-31-cortex-app-phase4-run-view.md` | Run view, D3, trace, debrief. |
| `2026-03-31-cortex-app-phase5-workshop-and-cli.md` | Lab, palette, CLI. |
| `wiki/Architecture/Design-Specs/cortex-design-export.html` | Visual reference (HTML mockups). |

Owner: `cortex-warden` (`.claude/agents/cortex-warden.md`). Domain edits go through it.

---

## Testing and Quality

- Prefer **scoped** tests: `bun test apps/cortex/server/tests/<file>.ts --timeout 15000`, `cd apps/cortex/ui && bun test src/lib --timeout 15000`.
- After UI changes: `cd apps/cortex/ui && bun run build`.
- Do not run the full monorepo test suite unless the task requires it (see root `AGENTS.md` terminal rules).

---

## Pitfalls (Cortex-Specific)

0. **Rebuild packages before testing Cortex.** Cortex imports `@reactive-agents/*` from `dist/` (compiled output), not `src/`. If you modify framework packages without running `bun run build:packages` (or `bun run build`) from the repo root, Cortex will execute stale code. Always rebuild after package changes: `bun run build:packages && cd apps/cortex && bun start`.
1. **Live WS `agentId` in the URL must match broadcast keys** — derived from ingest `agentId`, not arbitrary labels.
2. **Do not double-load run history** — Run view relies on **WS replay** after connect; avoid also replaying the full event list from REST in the same client unless you dedupe.
3. **`POST /api/runs`** is still **501** by design — UI must handle gracefully (`stage-store` already does).
4. **Pause/stop** routes may be missing — `run-store` `pause`/`stop` fail quietly.
5. **Debrief in REST** — Run summary exposes `hasDebrief`; full debrief object typically arrives via **`DebriefCompleted`** on the live stream.
6. **Durable approvals in chat** — a streamed chat turn with `durableRuns` + an approval-gated tool pauses (`StreamCompleted.pendingApproval`). `services/chat-approvals.ts` holds it as a `chat_pending_approvals` row (the user message waits there, not in `cortex_chat_turns`) and registers it in `durable-approvals` as an owner-managed entry: listed by `GET /api/runs/pending-approvals` (with `chatSessionId`) and `GET /api/chat/sessions/:id/approvals`, resolved by `POST /api/chat/sessions/:id/approvals/:runId/approve|deny|dismiss` or the desk `/api/runs/:runId/approve|deny`. Either way the resumed reply lands in the thread and the cached agent is evicted so history rebuilds from the DB. New turns get 409 while a turn is pending. Rows survive restart (`restore()` at boot); resuming then needs the same session config (durable config hash). A resumed run that pauses to ask the user (`request_user_input`) lands its question as the reply. Gaps: the non-stream `POST /chat` path cannot see a pause (`ChatReply` has no `pendingApproval`), and a first-turn `request_user_input` pause in the stream path still saves the "Run paused" text. Pinned by `server/tests/chat-durable-approval.test.ts`.
7. **Chat slash menu state** — the menu anchors above the quick bar (so chips stay clickable) and closes on a pointer press outside it; elements marked `data-slash-menu-keep` (composer, quick bar) do not count as outside. Chip/draft/multi-select rules are pure in `ui/src/lib/chat-menu.ts` (`chipClicked`, `menuClosed`, `keepsMenuOpen`, pinned by `chat-menu.test.ts`); multi rows (`MenuItem.multi`) toggle through `toggleInPlace` in `ChatPanel`, which queues PATCHes and computes each patch when it runs. ChatPanel effects that reset per session read the `$derived` `activeSession`, never the `sessionId` prop directly: the prop getter tracks the parent's whole chat store, so a direct read re-ran on every store update and wiped the composer.
8. **Chat trace timeline** — the turn inspector's Run trace tab gets frames and timeline groups from `buildRunTrees` (`ui/src/lib/chat-export.ts`), built from the tracer JSONL (each line is already a `TraceEvent`). The run view builds its timeline from live AgentEvents (`timeline-store.ts`) instead; both categorise with `timeline-filter.ts`.
9. **Panel field styles** — `.acp-field` / `.acp-stack` / `.config-input` etc. are `:global` under `.agent-config-panel`, so section components (`ShellWorkspaceFields`, `GuardrailsFields`) inherit them. New panel sections go in their own component; `AgentConfigPanel.svelte` and `ChatPanel.svelte` only wire them.

---

## When You Change Cortex

| Change | Update |
|--------|--------|
| New Lab builder flags wired to `buildCortexAgent` | `server/tests/config-parity.test.ts` (`FULL_CONFIG_BODY` + assertions), `ui/src/lib/cortex-runs-post-body.ts`, `server/api/runs.ts` body schema (shared fragments in `server/api/agent-config-body.ts`), `server/api/chat.ts` `ChatSessionConfigBody` (PATCH passes the validated body through), `chat-session-service` `buildChatAgentParams`, `runner-service` `LaunchParams`, `gateway-process-manager`, `normalizeCortexAgentConfig`, `ui/src/lib/types/agent-config.ts` `hydrateAgentConfig` for nested shapes, docs `features/cortex.md` if user-facing. A field that is already an `AgentConfig` path needs none of this: it renders in `AdvancedFrameworkConfig` (collections via `COLLECTIONS` + `ListField`) and flows through `rawConfig`. |
| New script or env var | `README.md`, and this file if agent-facing. |
| New WS route or payload | This file + any UI `constants` / store comments. |
| New primary route or nav entry | This file **Routes** table + `+layout.svelte` nav / `CommandPalette` if applicable. |
| Phase completion | Plan checkboxes in `docs/superpowers/plans/…` if the team tracks there; bump descriptions in `README.md` / here. |
| User-facing framework behavior | Root `AGENTS.md` / docs site only if Cortex is documented there (optional). |
| Significant UI / theme or token changes | `ui/src/app.css`, `ui/tailwind.config.ts`, and the **UI theme** subsection above. |

---

## Key Paths (Cheatsheet)

```
apps/cortex/
  AGENTS.md              ← this file
  README.md              ← human quick start
  package.json           ← scripts: start, dev, dev:ui, test, build:ui
  scripts/dev-stack.ts   ← bun start
  server/
    index.ts             ← entry, listen, static path
    api/                 ← REST routers
    ws/                  ← ingest + live handlers
    services/            ← ingest, store, event-bridge
    db/                  ← schema + queries
    tests/
  ui/
    vite.config.ts       ← /api + /ws proxy
    src/
      routes/            ← SvelteKit pages + layout
      lib/
        stores/          ← agent, stage, run, signal, trace, ws-client, framework
        components/      ← Stage + Run + shared UI
```

Repo root **`AGENTS.md`** lists this file under **Key File Paths** for discoverability.
