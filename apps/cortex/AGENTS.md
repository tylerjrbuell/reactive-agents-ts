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

Detail for each numbered section is in [[Cortex-Reference]] (`wiki/Development/Cortex-Reference.md`): 4 REST, 5 workspace, 6 tool disclosure and toolsets, 7 provider keys, 8 output speed, 9 workspace skills, 10 memory studio, 11 living skills, 12 live questions and field editor, 13 composer bar (`/mcp`, `/btw`), 14 judgment, 15 Ollama Cloud, 16 rich answers and attachments, 17 voice, 18 agent session control (`session-control` tool, proposals, capability switches). The UI Architecture (routes table, Bench theme tokens and per-page notes, stores, Svelte 5, dogfooding), Specs and Plans, Testing, and Pitfalls 6-12 are there too.

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

Temp files in server tests: `/tmp` is RAM-backed and a WAL db leaves `-wal`/`-shm` beside it. Make DB paths with `tmpDbPath` and remove them with `rmDbFiles` (`server/tests/helpers/tmp-db.ts`); scratch dirs use `tmpDir` + `rmTmpDirs` in `afterAll`; prefer `:memory:`. `tmp-hygiene.test.ts` fails on hand-rolled temp DB names.

Owner: `cortex-warden` (`.claude/agents/cortex-warden.md`). Domain edits go through it.

---

## Compliance gates

`scripts/check-cortex-compliance.sh` (registered in `tools/repo/checks.json`, so `bun run repo check` runs it) holds Cortex to `CODING_STANDARDS.md`. Cortex is an edge app on Bun and Elysia, so raw `await` and Promises at route and handler edges are allowed and not counted; the rest applies. Scan: non-test `.ts` under `server/`, and non-test `.ts`/`.svelte` under `ui/src`. Every counter is a ratchet: growth fails, and a shrink fails until its baseline in the script is lowered (a cleanup always shows in the diff). `--measure` prints the current numbers.

| Rule | Do this instead |
|------|-----------------|
| No `any`, `as any`, `<any>`, `@ts-ignore`, `@ts-expect-error` (baseline 0) | A named type, or `unknown` plus a guard. |
| `as unknown as` is baselined | One typed helper owns the cast (model: `eventRecord` in `services/ingest-service.ts`, `structuredOutputExtractedEvent`). |
| String `new Error(msg)` is baselined; a service-boundary failure is a tagged error | `Data.TaggedError` in `server/errors.ts` (model: `ChatTurnFailedError`). `instanceof *Error` is baselined too; prefer `_tag` or a guard. |
| `console.*` only in `server/cortex-log.ts` (baseline 0) | `cortexLog(level, scope, message)`; `cortexBanner` for the startup line. |
| `process.env` is read in `server/env-config.ts` (`cortexEnv`); existing reads elsewhere are baselined | Add the variable to `cortexEnv` and to the Environment table above, or take an `env` argument like `listen-host.ts`. |
| No new `bun:sqlite` imports (existing type imports are baselined) | Take the database as a parameter, typed like the neighbouring query modules. |
| Files at or above 800 LOC are listed in `SIZE_LEDGER` with a ceiling | New behavior goes in a new module; the giant only wires it. A new giant fails at birth. |

Pin: `server/tests/check-cortex-compliance.test.ts` (fixture trees: growth fails, shrink demands lowering, exempt modules, SCAN-EMPTY).

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
| Messaging channels / gateway overview | A gateway agent's channels (`config.channels`: Telegram, Signal, signed webhook) hold only non-secret settings; credentials are sealed in the provider key store under `channel:<channelId>:<field>` (`services/channel-credentials.ts`, write-only: responses carry a mask, `channel-credentials.test.ts` / `api-gateway.test.ts` pin that no response or probe echoes a value). Access control, queue and crons are the framework's own `gateway.*` (`CortexGatewayConfig`, `BuildCortexAgentParams.gateway`; Cortex sets no default, so an empty allowlist denies everyone and `accessPolicy: "open"` is the explicit "Allow everyone"). They are **gateway-path only**: `gatewayConfigToBuildParams` carries `gateway`; the cron one-shot `fireAgent` strips it; `GatewayChannelHost` (`services/gateway-channel-host.ts`, owned by `GatewayProcessManager.channels`) builds a long-lived agent with `channelAdapters` (`.withChannels`, overlay; the AgentConfig `gateway.ingress: { channels: false }` is set with them in `cortexParamsToAgentConfig`, no builder overlay) and `agent.start()` and serves `GET /api/gateway/status` from the framework's accessors: `agent.channelStatus()` (adapter state, `messagesReceived`/`messagesSent`, `lastInboundAt`/`lastSentAt`, `deliveryFailures`, `lastError`) and `agent.gatewayStatus().inboundQueue` (`ready`, `deferred`, `capacity`, `overflow`, `dropped`). Only the activity feed and the refused-sender count are folded from events (`gateway-status.ts`). Webhook channels mount an ingress listener on their own port and route through `WebhookChannelAdapter.handleWebhook`; the framework's runtime ingress also serves any `handleWebhook` adapter at `/channels/<id>` on `gateway.port` (default 3000, loopback). `.withGateway` options (`queue`, `accessControl.mode`/`sessionTtlDays`) now reach the gateway (`api-gateway.test.ts` pins the queue bounds read back from the running queue). `build-path-parity.test.ts` lists `gateway` / `channelAdapters` in `PATH_SPECIFIC`. UI: Lab · Channels section (`ChannelsSection.svelte`, rules `lib/channels.ts`, `channel-access.ts`, `gateway-schedules.ts`) and Lab · Gateway tab (`GatewayOverview.svelte`, `lib/gateway-overview.ts`). |
| Channel hub (channels, routes, router) | `services/channel-hub.ts` runs ONE framework `createChannelRouter` for the `cortex_channels` / `cortex_routes` tables (`db/channel-hub-queries.ts`; credentials stay sealed under `channel:<id>:<field>`). Ports over SQLite in `channel-hub-store.ts` (durable `RouterStore`, `makeDbLeases` account lease with heartbeat, `makeDurableRouteMeter`); the store serves only routes that pass `validateRoute` (fail-closed). `channel-hub-resolver.ts` builds an agent per (route, role) through `cortexAgentBuilder` (headless approvals), narrows the params for non-owners (`channel-tool-surface.ts`: read-only built-ins, no MCP / meta-tools / sub-agents / memory) and checks the BUILT config (`surfaceViolations`), so a re-opened surface fails the build. Session turns pass no `useTools`: the framework's capability default (`agent.chat` takes the tool loop iff the built agent has capability tools, whatever the wording) decides over the narrowed build (`channel-hub-owner-tools.test.ts`). Cortex chat likewise passes only the user's tools-off switch (`useTools: false`; `chat-tool-intent.test.ts`). Target kind `session` is a typed extension point (`parseRouteTarget`), unimplemented. Migration `channel-hub-migration.ts` (idempotent; legacy `allowedSenders` become owners; webhook stays legacy; rows follow the agent until edited in the hub). **Single poller:** `GatewayChannelHost.sync` skips channels `hub.owns` (`GatewayProcessManager.attachChannelHub`, started in `server/index.ts` before `hydrate`); `CORTEX_CHANNEL_HUB=off` is the rollback. API `api/channel-hub.ts` (`/api/channels`, widening changes need `confirm`, audited), status in `GET /api/gateway/status` `hub`. **Saved-agent changes and failures:** the router keeps a conversation's session open across turns, so the resolver takes the CURRENT built agent on every turn and re-opens the session (same id, persisted history) when `evictAgent` replaced it (otherwise every turn after a PATCH hit a disposed agent: `turn_failed` until restart). A failed turn or build logs (`channels` scope) and shows its sanitized cause (message only; URL queries, bearer and key-like tokens removed: `channel-hub-failure.ts`) in the activity line and the simulate `detail`. **Model-written acks:** for a route with `ack.source: "model"` the resolver streams a turn that carries `onProgress` and forwards the agent's pre-tool narration (`drainWithNarration`), and offers `acknowledge` (`makeAcknowledge` over `toChannelHandle(agent).complete`: tool-less, outside the chat turn gate, never in history, fail-soft to the canned text). A new Telegram route created without an `ack` (API create, migration, and the editor's new draft) gets `{ source: "model" }` (`services/channel-ack-default.ts`); an explicit `ack`, `false` included, is never touched, and webhook / Signal routes get none. `ChannelTurnAcknowledged` shows in the activity feed (`acknowledged (<source>, <role>)`; when a model ack fell back to canned: `acknowledged (canned, <role>; model ack fell back: <timeout|empty|thinking_only|error>)` plus the `ackFallbackReason` field on the activity record; the framework's `ackLatencyMs` shows as seconds (`acknowledged (model, owner; 5.8s)`, `... fell back: timeout after 12.0s)`) and is kept on the record; the resolver passes the `acknowledge` port result, `{ text, fallbackReason? }` from `makeAcknowledge`, through unchanged). Pin: `channel-hub-model-ack.test.ts`. **Owner `/new`:** a route owner sending a `resetCommands` entry (default `/new`, `/reset`; `[]` disables) ends the conversation: the router calls the resolver's `RoutedSession.reset`, which ends the open session and empties the persisted history row in the agent's memory db (`channel-hub-history.ts` `clearPersistedHistory`, the memory `SessionStoreService` upsert of `[]`; it rejects on a store failure because `session.end()` swallows save errors, so the owner is told "Could not start a new conversation." instead of a false fresh start). `resetCommands` is a plain route field (route model, `PATCH` with `null` back to the default, editor `ResetFields.svelte` over `lib/channel-reset-commands.ts`); `ChannelConversationReset` shows in the feed as `reset` (ok / failed, no text). Pin: `channel-hub-reset.test.ts`, `ui/src/lib/channel-reset-commands.test.ts`. **Turn limit and failed turns:** `turnTimeoutMs` (edited in seconds, blank = the framework's 120 s) and `failureNotice` (framework default on; only an opt-out is written; hidden on webhook routes) are plain route fields edited by `TurnLimitFields.svelte` over `lib/channel-turn-limits.ts`. A failed `ChannelTurnCompleted` shows `failureReasonText` (`channel-hub-failure.ts`: `turn timed out after 120s (the route's turn limit)`, then the sanitized cause) in the feed, with the limit read from the saved route (`HubActivityTracker`'s `turnTimeoutMsOf`); the test panel words the same reasons (`failureReasonLine`). The sender-facing failure message is the framework's fixed text; Cortex does not write it. Pin: `channel-hub-failure-reason.test.ts`, `ui/src/lib/channel-turn-limits.test.ts`, `channel-hub-api.test.ts` (round trip). The editor does not expose `priority`, `groups` or `deniedReply` (kept as saved). Pins: `channel-hub-mcp-turns.test.ts`, `channel-hub.test.ts`, `channel-hub-migration.test.ts`, `channel-hub-store.test.ts`, `channel-hub-api.test.ts`, `channel-tool-surface.test.ts`. **UI:** Lab · Channels tab (`components/channel-hub/`: `ChannelsHub` composes `HubChannelCard` over the shared `ChannelCard`, `HubRoutes`, `RouteEditor` drawer with `SenderChips` + `AckFields`, `RouteTestPanel` = explain + opt-in simulate; rules `lib/channel-hub.ts`, calls `lib/channel-hub-api.ts`, live words `lib/channel-hub-view.ts`; each has a sibling test). The editor sends a route as the framework `RouteSpecInput`, keeps fields it does not own (priority, `groups`, `deniedReply`), and omits `senderTools`/`ack` on webhook channels (the framework refuses the keys). A widening save (added owner, `open`, `AgentDefault`) asks through the audited confirm dialog first and sends `confirm`; a 409 `confirmation_required` opens the same dialog. `PATCH /api/channels/routes/:id` treats a `null` value as "clear this field" (a merge could not remove a cap or the ack). `HubStatus.leases` (channel, pid, since; never the account or its hash) lets the page link a duplicate-account refusal to the channel that holds the account. The Saved agents list shows "Reachable via" (`ReachableVia.svelte`) with an "Add route" shortcut (`stores/channels-intent.ts`). Docs: `features/cortex/gateway-and-channels.mdx`. |
| Local speech server (Speaches) supervisor | Opt-in `localSpeech.keepRunning` (default off; saved in `voice-settings.json`, changed only by `POST /api/voice/local/keep-running`, never the settings PUT). `services/voice/speech-supervisor.ts` runs `docker` through an injected `DockerRunner` (real = `execFile`, argv arrays, no shell): fixed container `cortex-speaches` (a hand-made `speaches` container is never touched), image from a two-tag allowlist (`latest-cpu`, `latest-cuda` only when `docker info` lists an nvidia runtime), `--restart unless-stopped`, port published as `127.0.0.1:<port>:8000`, only the `hf-hub-cache` volume. Only loopback `http://host:port/v1` endpoints with a Hugging Face model id qualify (`resolveSpeechTarget`). Checks at startup, on `GET /api/voice/settings` (throttled), on a 60 s timer, and lazily when `/speak`, `/transcribe`, `/test` get an `unreachable` failure (one retry after Ready). Single-flight, 3 attempts with backoff, then `failed` until Retry. Routes `GET /api/voice/local/status`, `POST /api/voice/local/ensure`, `POST /api/voice/local/keep-running`; the two POSTs answer 403 when `allowDocker` is false (non-loopback bind without a token) on top of the request guard. docker stderr leaves the server only as a scrubbed 300-char tail. UI: `LocalSpeechBlock.svelte` (rules `lib/voice/local-speech.ts`). Pins: `server/tests/speech-supervisor.test.ts` (fake docker + fake speech server), `ui/src/lib/voice/local-speech.test.ts`. |
| Chat plan card (Plan mode plan, edits, Execute) | Cortex only renders and persists the framework `Plan`; the plan's meaning is the framework's (`AgentSession.plan` / `setPlan`, core `Plan`, `PlanRecorded`). The conversation's to-do list stays the one store of steps and statuses (`todo_json`); `plan_meta_json` (`db/chat-plan-queries.ts`) holds what a list cannot (plan id, goal, author, tool hints). `services/chat-session-plan.ts` (`ChatSessionPlans`, on `ChatSessionService.plans`): `read` = the live session's plan with stored tool hints, else the stored list; `write` = `session.setPlan` under the turn guard, then `persistSessionPlan` (also run after every persisted turn). Routes `GET`/`PUT /api/chat/sessions/:id/plan` (`api/chat-plan-route.ts`; 400 bad edit via `cleanPlanSteps`, 404 unknown, 409 turn running). **Plan mode turns `todo` on** (`chat-meta-tools.ts` `chatMetaTools`: unless the user set `metaTools.enabled: false` or `todo`; tools-off chats untouched), and `setMode("plan")` rebuilds a cached agent built without it (`modeSwitchNeedsRebuild`; after the running turn when one is in flight), so the model can record its plan; with no `todo` the harness derives the steps. UI: `ChatModePlanCard.svelte` (editable on the latest Plan reply, read-only on the executed one: `executedPlanTurnId`) over `PlanChecklist.svelte`; edit rules `lib/plan-edit.ts`, calls `lib/plan-api.ts`, state `stores/chat-plan-store.ts`; `executePlan(edited?)` in `chat-mode-store.ts` saves the edits, switches mode, then sends `Execute the plan.` (a refused save stops all three). Feed: chat ingest has no run for `ChatModeChanged` and a user-edited `PlanRecorded` (no `taskId`), so it files them under the one open chat root or holds them for the next root (`SESSION_EVENT_TAGS` in `chat-ingest.ts`); `run-event-log.ts` words them. ui-core exports `PlanWire` and the plan/mode event wire types. Pins: `server/tests/chat-plan.test.ts`, `chat-ingest-session-events.test.ts`, `ui/src/lib/plan-edit.test.ts`, `stores/chat-mode-store.test.ts`, `chat-mode.test.ts`, `run-event-log.test.ts`, `components/chat/PlanChecklist.test.ts`. Docs: `features/cortex/chat-and-composer.mdx`, `goals-plans-loops.mdx`. |
| Agent session control (new action the `session-control` tool may propose) | One row in the capability registry `server/services/session-capabilities.ts` (`CAPABILITY_ACTIONS`, group, aliases, validation against live values, diff, tighten/loosen, `planCapability` effect) and a case in `chat-session-capabilities.test.ts`. Apply must reuse `updateSessionConfig` or a chat-session history method, never a second config path. A change that LOOSENS what the agent can do must be `loosen` (or `neutral`) so it can never auto-apply; only tightening in a group the user listed in `agentControlAutoApply` may apply without a click. A new switch group needs the server `CAPABILITY_GROUPS` entry and the UI `ui/src/lib/agent-control.ts` entry (a test fails when they drift). Proposals are part of the thread: anything that rewrites history (clear, rewind, compact) must also delete the proposals it orphans (`db/chat-proposal-queries.ts`). Details: [[Cortex-Reference]] 18. |
| Voice mode speed and spoken answers | Speed: the voice-mode bar stepper (`VoiceSpeedStepper.svelte`, rules `ui/src/lib/voice/voice-speed.ts`) writes the saved `rate` pref (Settings · Voice · Reading speed); the shared reader reads it before every sentence (browser `rate`, server `speed` in the `/api/voice/speak` body, which the server already forwards). Spoken answers to a live `request_user_input` question: `voice-answer.ts` (pure, deterministic matcher: `VoiceQuestionSpec` text / choice(multi) / boolean / number; `voiceQuestionSpec` maps today's `kind` + `schema`, the structured question shape plugs in by producing a spec per question), `voice-question.ts` (pure reducer: ask, read aloud, listen, read back, confirm, send), `voice-question-host.ts` (runs it over the shared reader + its own dictation; one speaker), wired in `voice-runtime.ts` (`askQuestion`, `questionState`) and `ChatVoiceControls.svelte` (`voiceQuestionOf`, `answerLiveInteraction`); UI `VoiceQuestionStrip.svelte`. Rules: nothing is sent without a confirm phrase / button (free text auto-sends only with `autoSend` pref); approvals never go through it. Pins: `voice-answer.test.ts` (table), `voice-question.test.ts`, `voice-question-host.test.ts`, `voice-speed.test.ts`, `voice-text.test.ts`. Docs: `features/cortex/voice.mdx`. |
| Structured `request_user_input` (several typed questions) | Wire: `questions` on `InteractionRequested` / `PendingInteractionWire` (ui-core `protocol/events.ts`, own structural copy), forwarded by server `durable-approvals.ts` (live rows), `runner-service.ts` (`listPendingInteractions`) and `chat-approvals.ts` (derived from the persisted `schema.questions`). Answer = id-keyed map (`{ [question.id]: string \| number \| boolean \| string[] }`), checked by `services/interaction-answers.ts` (`validateAnswers` from `@reactive-agents/tools`; 422 with a person-readable error on `POST /api/runs/:runId/interaction` and the chat respond route; legacy asks are not checked). UI: rules `ui/src/lib/structured-questions.ts` (`questionsOf`, `buildAnswers`), form `StructuredQuestionForm.svelte` (kit Select for single choice and yes/no, checkboxes for multi), used by `InteractionReply.svelte` and `WaitingOnYou.svelte`. Voice: `voice/voice-structured.ts` (one `VoiceQuestion` step per required question, labels to values, `deliverPartAnswer` sends one map after the last), wired in `ChatVoiceControls.svelte`; optional questions and `allowOther` are form-only. Pins: `server/tests/structured-questions.test.ts`, `structured-questions.test.ts`, `chat-live-interaction.test.ts` (wire event to answer map), `voice-structured.test.ts`, ui-core `run-machine.test.ts`. Docs: `features/cortex/approvals-and-questions.mdx`, `voice.mdx`. |
| Web-search provider keys (Settings · Web search) | `WEB_SEARCH_KEY_PROVIDERS` in `server/services/web-search-keys.ts` is built from the framework's exported `WEB_SEARCH_PROVIDERS` (`@reactive-agents/tools`; ids `websearch-<provider>`, only the display label is Cortex copy), spread into `KEYED_PROVIDER_ENV`; same encrypted store and `/api/settings/keys` routes; `POST /:id/test` sends a one-result search (`probeWebSearchKey`, injectable). **They reach agents** as `.withTools({ webSearch: { apiKeys, providers } })`, an overlay in `cortexAgentBuilder` (`build-cortex-agent.ts`, `webSearchOptionOf`; the one funnel for chat, desk runs and gateway agents). Keys are runtime-only in the framework (never in `AgentConfig` JSON), so they ride the overlay and `withTools` replaces `webSearch` whole: the config's `tools.webSearch.providers` is passed again with them. The overlay runs only when the config already enables tools and a saved key wins the provider-key rule (`providerKeyForAgent`: env wins unless "use stored key"); Cortex never writes `process.env`. The provider order is the AgentConfig path `tools.webSearch.providers`, set by `WebSearchProvidersField.svelte` (rules `lib/web-search-providers.ts`, in `ToolsSection`, so builder and chat panels share it) into `rawConfig`; `tools.webSearch` is in the Tools section's `configPaths`. Export as code lists saved keys as not exported (`cortexOnlySettings`). A new framework provider shows in Settings automatically; add its label to `LABELS` and its chip to `WEB_SEARCH_CHOICES` (`web-search-keys.test.ts` fails until the UI list matches). UI: `ProviderKeysPanel scope="web-search"` (`lib/provider-keys.ts`). Pins: `server/tests/web-search-agent.test.ts` (stubbed fetch sees the key on the chat and gateway paths; reverted overlay fails it), `web-search-keys.test.ts`, `ui/src/lib/web-search-providers.test.ts`, `provider-keys.test.ts`. Docs: `features/cortex/settings-and-keys.mdx`, `lab-builder.mdx`, `features/llm-providers.md`. |
| MCP server options (`readOnly`, `trustAnnotations`) and which MCP tools an agent sees | A saved server is one `MCPServerConfig` JSON blob (`cortex_mcp_servers.config_json`), so a field survives only if `parseConfigBody` (`services/mcp-config-import.ts`, shared by POST/PATCH and the JSON import) keeps it; `readOnly` is `true` or a non-empty name list (`false`/empty is not stored), `trustAnnotations` a boolean. Both pass to the builder through `mcpConfigs` -> `mcpServers`. UI: `McpServerForm.svelte` over `McpDraft` (`lib/tool-workshop.ts`). **Attaching a server makes all its tools available**: the framework adds an attached server's tools to `allowedTools` unless a tool of that server is named (then the named ones win). The pickers (`ToolsSection.svelte`, chat `/mcp`) therefore attach with no tool names, and a chip click writes an exclusion as the remaining names; rules in `lib/tool-selection.ts` (`mcpServerMode`, `toggleMcpServerAttached`, `toggleMcpTool`; an emptied subset detaches, a complete one collapses to "all"). Old configs with explicit `server/tool` lists stay a subset. Pins: `mcp-config-import.test.ts`, `cortex-to-agent-config.test.ts`, `tool-workshop.test.ts`, `tool-selection.test.ts`, `chat-quickbar.test.ts`. |
| New script or env var | `README.md`, and this file if agent-facing. A server env var is read in `server/env-config.ts` (`cortexEnv`). |
| Compliance gates (a cleanup that lowers a count, or a new rule) | Lower the baseline in `scripts/check-cortex-compliance.sh` (the gate fails until you do), update the "Compliance gates" section above and the self-test `server/tests/check-cortex-compliance.test.ts`. |
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
