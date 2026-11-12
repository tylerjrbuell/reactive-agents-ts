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
| `CORTEX_HOST` | `127.0.0.1` | Interface the server binds. Default is loopback only: Cortex has no authentication and its API lists directories and starts runs. Set `0.0.0.0` (or a LAN address) to expose it on purpose; startup is refused unless `CORTEX_TOKEN` is set (`bindRefusal`, `server/request-guard.ts`). `startCortexServer({ hostname })` overrides it. Resolver: `server/listen-host.ts`. |
| `CORTEX_URL` | — | Public base URL (HTTP) for display / agent `.withCortex()` alignment. |
| `CORTEX_ALLOWED_HOSTS` | unset | Comma-separated extra host names (no port) the API accepts in `Host` / `Origin`. By default only localhost, 127.0.0.1, `[::1]`, IP literals (Host only) and the `CORTEX_URL` host pass; anything else gets 403 on `/api/*` and `/ws/*` (DNS-rebinding wall, `server/request-guard.ts`, pinned by `request-guard.test.ts`). Voice endpoints also refuse link-local / cloud-metadata base URLs (`isBlockedAudioHost`). |
| `CORTEX_TOKEN` | unset | Access token for `/api/*` and `/ws/*` (bearer, `cortex_token` cookie set by `/?token=`, or `?token=` on `/ws/*`). Loopback needs none; a non-loopback bind requires it. Every `/api` and `/ws` request with `Sec-Fetch-Site: cross-site` is refused. Outbound URLs (Ollama endpoint, voice base URLs) go through `server/outbound-url.ts` (no link-local/metadata, DNS-checked, no redirects); MCP credentials are write-only (`services/mcp-secrets.ts`); `POST /api/tools/invoke` needs `approved: true` for `requiresApproval` tools; `.cortex/` is 0700 and the db 0600. Pinned by `server/tests/security-hardening.test.ts`. |
| `CORTEX_NO_OPEN` | unset | `1` disables opening a browser when starting the server alone. |
| `CORTEX_LOG` | `info` | Server log verbosity: `error` \| `warn` \| `info` \| `debug` \| `off`. **`debug`** logs every persisted ingest event, empty bridge broadcasts, replay counts. The framework **`CortexReporter`** reads the same variable for connection / dropped-event warnings. |
| `CORTEX_SKILL_SCAN_ROOT` | — | Optional extra absolute path: a workspace-picker suggestion, and merged with `process.cwd()` and the Cortex app root by the older `GET /api/skills/files` scan (no UI reads it now; chat and Lab use framework discovery, section 9 below). |

DB file defaults to **`.cortex/cortex.db`** relative to the server process cwd (usually `apps/cortex`). See `server/types.ts` → `defaultCortexConfig`.

---


## Server Architecture (index)

Wiring: `server/index.ts` mounts routers, `/ws/ingest`, `/ws/live/:agentId`, and the static UI. Agents POST events to `/ws/ingest`; `CortexIngestService` persists and fans out. Live clients connect to `/ws/live/:agentId?runId=` and get a replay, then live messages (`CortexLiveMessage` in `server/types.ts`).

Detail for each numbered section is in [[Cortex-Reference]] (`wiki/Development/Cortex-Reference.md`): 4 REST, 5 workspace, 6 tool disclosure and toolsets, 7 provider keys, 8 output speed, 9 workspace skills, 10 memory studio, 11 living skills, 12 live questions and field editor, 13 composer bar (`/mcp`, `/btw`), 14 judgment, 15 Ollama Cloud, 16 rich answers and attachments, 17 voice. The UI Architecture (routes table, Bench theme tokens and per-page notes, stores, Svelte 5, dogfooding), Specs and Plans, Testing, and Pitfalls 6-12 are there too.

Read the matching section there before editing that area.

---

## WebSocket Paths (Critical)

| Path | Role |
|------|------|
| `/ws/ingest` | Agent → server; JSON `CortexIngestMessage`. |
| `/ws/live/:agentId?runId=` | UI (or tools) → server; **`agentId` must match the agent that receives broadcasts** (same string used in `broadcast(agentId, …)`). |

**Gotcha — Stage grid:** `+layout.svelte` historically used a path like **`/ws/live/cortex-broadcast`**. The bridge **only** fans out to subscribers registered under each message’s **`agentId`**. Until Stage subscribes using the **same `agentId`** as ingest (or the server adds a separate fan-out channel), the desk grid may not show live events. **Run detail** is correct: `run-store.ts` loads `GET /api/runs/:runId`, then connects to **`/ws/live/${encodeURIComponent(agentId)}?runId=…`**.

---

## UI Rules That Always Apply

- Visual language is fixed (Bench, `wiki/Architecture/Design-Specs/2026-11-10-cortex-ui-modernization.md`): semantic `--cortex-*` tokens in `ui/src/app.css`, Geist for words, JetBrains Mono for machine values, nothing under 11px, no uppercase labels. `NeuralMark` is the only logo. The signal gradient, live glow and sonar ring mean "running now" and appear nowhere else. Every motion has a reduced-motion fallback. Token and per-page detail: [[Cortex-Reference]].
- Svelte 5 runes only (`$props`, `$state`, `$derived`, `$effect`). `RunDetail` remounts per `runId` via `{#key}`.

### Layout context

- **`routes/+layout.svelte`** — Creates **`createAgentStore()`**, **`createStageStore()`**, `setContext("agentStore" | "stageStore", …)`, live WS for Beacon, toasts, command palette shell, top nav. Calls **`stageStore.setNavigate(goto)`** in `onMount`.
- **`routes/+page.svelte` (Beacon)** — Must use **`getContext`** for both stores (do not instantiate a second `createStageStore()` on the page).

The UI depends on `@reactive-agents/svelte` (via `ui/src/lib/stores/framework.ts`): Cortex dogfoods the framework UI bindings.

Testing: scoped `bun test apps/cortex/server/tests/<file>.ts --timeout 15000`; after UI changes `cd apps/cortex/ui && bun run build`. Do not run the full monorepo suite unless the task requires it.

Owner: `cortex-warden` (`.claude/agents/cortex-warden.md`). Domain edits go through it.

---

## Pitfalls (Cortex-Specific)

0. **Rebuild packages before testing Cortex.** Cortex imports `@reactive-agents/*` from `dist/` (compiled output), not `src/`. If you modify framework packages without running `bun run build:packages` (or `bun run build`) from the repo root, Cortex will execute stale code. Always rebuild after package changes: `bun run build:packages && cd apps/cortex && bun start`.
1. **Live WS `agentId` in the URL must match broadcast keys** — derived from ingest `agentId`, not arbitrary labels.
2. **Do not double-load run history** — Run view relies on **WS replay** after connect; avoid also replaying the full event list from REST in the same client unless you dedupe.
3. **`POST /api/runs`** is still **501** by design — UI must handle gracefully (`stage-store` already does).
4. **Pause/stop** routes may be missing — `run-store` `pause`/`stop` fail quietly.
5. **Debrief in REST** — Run summary exposes `hasDebrief`; full debrief object typically arrives via **`DebriefCompleted`** on the live stream.
6. **Approval policy** — the gate is the framework's top-level `approvalPolicy`; `server/services/approval-policy.ts` `approvalPolicyOf` reads an explicit one. **Cortex asks before risky tools by default** (owner decision 2026-11-12; the framework's own default stays off): `effectiveApprovalPolicy` is what all three build paths (run, chat, gateway) build with: the explicit policy, else a rule-less `{ mode: "detach" }` (the framework then gates every `requiresApproval` tool: file-write, file-edit, code-execute, shell-execute), else nothing when the config says `askBeforeRiskyTools: false` (UI: Lab Tools · Approvals switch, chat `/approvals` · Turn approvals off). Gateway agents are headless and get `block` (a gated call is refused, nothing hangs). A tools-off chat gets no gate. Pins: `approval-policy.test.ts`, `build-path-parity.test.ts`; tests that really run a risky tool unattended set `askBeforeRiskyTools: false`.
   The chat composer has ONE command surface (`ui/src/lib/config-menu-nav.ts`, `ChatSlashMenu.svelte`): typing `/` and the Config button open the same list anchored to the composer; every setting is a slash command shown with its current value, a command with a panel (`picker`) drills in place under a Back row, Esc goes back one level then closes. New settings need a `CHAT_COMMANDS` entry (+ `picker`) and a `configGroups` row (`config-menu-nav.test.ts` pins both ways). Live approvals, the one-approval-surface rule and durable chat approvals: [[Cortex-Reference]] pitfall 6.
7-12. **Chat slash menu, transcript contract, panel field styles, chat queue and compaction, run endings, turns that never complete**: contracts live in [[Cortex-Reference]] pitfalls 7-12. Read them before touching `ChatPanel`, `ChatTranscript`, the chat queue, or run-ending copy.

---

## When You Change Cortex

| Change | Update |
|--------|--------|
| New Lab builder flags wired to `buildCortexAgent` | `server/tests/config-parity.test.ts` (`FULL_CONFIG_BODY` + assertions), `ui/src/lib/cortex-runs-post-body.ts`, `AgentConfigBodyFields` in `server/api/agent-config-body.ts` (spread by both `RunConfigBody` and `ChatSessionConfigBody`; PATCH passes the validated body through), `chat-session-service` `buildChatAgentParams`, `runner-service` `LaunchParams` + `launchParamsToBuildParams`, `gateway-process-manager` `gatewayConfigToBuildParams`, `normalizeCortexAgentConfig`. `server/tests/build-path-parity.test.ts` runs one maximal config through all three build paths and fails when a `BuildCortexAgentParams` key is set on some paths only (deliberate differences live in its commented `PATH_SPECIFIC` list); a new `BuildCortexAgentParams` field is a type error there until it is listed in `PARAM_KEYS`. Also `ui/src/lib/types/agent-config.ts` `hydrateAgentConfig` for nested shapes, docs `features/cortex.md` if user-facing. A field that is already an `AgentConfig` path needs none of this: it renders in `AdvancedFrameworkConfig` (rules in `ui/src/lib/framework-options.ts`: collections via `COLLECTION_FIELDS` + `ListField`, mixed-literal unions via `CHOICE_FIELDS`) and flows through `rawConfig`. A curated control that sets an AgentConfig path lists it in its section's `configPaths` (`ui/src/lib/agent-config-sections.ts`; Cortex-fixed paths in `CORTEX_FIXED_CONFIG_PATHS`) so All framework options hides it; `server/tests/curated-config-paths.test.ts` fails when the mapping writes a path that also renders generically. |
| Debriefs | `.withDebrief(enabled)` controls the debrief independent of memory (runtime `isDebriefEnabled` in `debrief.ts`: `debrief ?? enableMemory === true`). Unset, it follows memory; `true` writes one with memory off (to the debrief store, a small SQLite table); `false` turns it off with memory on. The reasoning loop must still run (`debrief-synthesis.ts`). The bus `DebriefCompleted` is the only copy Cortex stores: the runner and gateway forward the agent's bus and never re-emit one from `result.debrief` (that doubled every debrief; pinned by `runner-service.test.ts`, `gateway-process-manager.test.ts`). Memory · **Debrief after each run** writes `rawConfig.debrief` only when it differs from memory (never touches the tiers), and the run view's empty state reads the same rule (`ui/src/lib/debrief-memory.ts`, `server/tests/debrief-memory.test.ts`). |
| A pick list in the UI | Use kit `Select` (`ui/src/lib/components/kit/Select.svelte`; rules in `lib/select.ts`: search box from 9 options, grouped options, descriptions, keyboard, flip-up placement). `onchange` gets the new value string. Never a native select: `lib/no-native-select.test.ts` fails on one. A popover that should close on an outside press or Esc uses `use:clickOutside` (`lib/actions/click-outside.ts`; a press inside a `Select` list counts as inside). |
| Messaging channels / gateway overview | A gateway agent's channels (`config.channels`: Telegram, Signal, signed webhook) hold only non-secret settings; credentials are sealed in the provider key store under `channel:<channelId>:<field>` (`services/channel-credentials.ts`, write-only: responses carry a mask, `channel-credentials.test.ts` / `api-gateway.test.ts` pin that no response or probe echoes a value). Access control, queue and crons are the framework's own `gateway.*` (`CortexGatewayConfig`, `BuildCortexAgentParams.gateway`; Cortex sets no default, so an empty allowlist denies everyone and `accessPolicy: "open"` is the explicit "Allow everyone"). They are **gateway-path only**: `gatewayConfigToBuildParams` carries `gateway`; the cron one-shot `fireAgent` strips it; `GatewayChannelHost` (`services/gateway-channel-host.ts`, owned by `GatewayProcessManager.channels`) builds a long-lived agent with `channelAdapters` (`.withChannels`, overlay) and `agent.start()`, folds its events (`gateway-status.ts`) and serves `GET /api/gateway/status`. `build-path-parity.test.ts` lists `gateway` / `channelAdapters` in `PATH_SPECIFIC`. UI: Lab · Channels section (`ChannelsSection.svelte`, rules `lib/channels.ts`, `channel-access.ts`, `gateway-schedules.ts`) and Lab · Gateway tab (`GatewayOverview.svelte`, `lib/gateway-overview.ts`). The framework has no `agent.channelStatus()` or queue-depth accessor, so channel counters and queue counts come from events. |
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
