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
| `CORTEX_HOST` | `127.0.0.1` | Interface the server binds. Default is loopback only: Cortex has no authentication and its API lists directories and starts runs. Set `0.0.0.0` (or a LAN address) to expose it on purpose; the server logs a warning. `startCortexServer({ hostname })` overrides it. Resolver: `server/listen-host.ts`. |
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
4. **REST** — `GET /api/runs`, `GET /api/runs/:runId`, `GET /api/runs/:runId/events`, **`POST /api/runs`** (desk runner). Skills: `GET /api/skills/files`, `GET /api/skills/file?path=`, `GET /api/skills/sqlite/:id` (open-skill YAML + markdown). Workspace picker: `GET /api/workspace/check?path=` (absolute existing dir → normalised path, else 400), `GET /api/workspace/recent`, `GET /api/workspace/candidates` (ranked suggestions: launch dir's git root, launch dir = server cwd, `CORTEX_SKILL_SCAN_ROOT`, recent; plus `home`), `GET /api/workspace/browse?path=&hidden=1` (subdirectory names + `isGitRepo` only, home by default, 400 on relative/missing paths, capped at 500 entries). Built-in toolset shortcuts: `GET /api/tools/toolsets`; shell toolsets → the programs they run: `GET /api/tools/shell-presets`; shell allowlist sources (defaults, opt-in, groups): `GET /api/tools/shell-commands`. Routers under `server/api/`.
5. **Workspace** — `workspace` (absolute existing dir) on a chat session / run / saved agent maps to `.withTools({ workspace })`: file tools confine to it and `shell-execute` runs in it. Chat create/PATCH and `POST /api/runs` refuse a bad path with 400 (`services/workspace-dir.ts`); chat sessions forward it, the shell options and `terminalTools` only when tools are on (a tools-off chat never gets `shell-execute`). Shell options ride in `terminalShellOptions` (`cwd`, `allowUnsafeCwd`, `timeoutMs`, `maxOutputChars`, `commandAccess`, `sandbox`). The builder edits the shell allowlist as **one list** (`ShellCommandsField.svelte`): the exact commands the agent gets as removable chips, framework defaults pre-filled from `GET /api/tools/shell-commands` (framework `DEFAULT_ALLOWED_COMMANDS`, `OPT_IN_COMMANDS`, and the commands behind each `commandAccess` group; never copied into the UI), an add input, and quick-add buttons for the opt-in groups (no `github`: the `git` toolset brings `gh`). `ui/src/lib/shell-allowlist.ts` folds stored `terminalShellAllowedCommands` + `terminalShellAdditionalCommands` + legacy `commandAccess` into that list and writes edits back as extras beyond the defaults → `terminalShellAdditionalCommands`, or, once a default is removed, the full list → `terminalShellAllowedCommands`; it never sets `commandAccess` (cleared on the first edit; an unedited legacy config still sends it, so no command is lost). The group → commands map is the framework's `COMMAND_CAPABILITY_MAP` (`@reactive-agents/tools`), served as is; Cortex keeps no copy (`server/tests/shell-commands-catalog.test.ts`).
6. **Tool disclosure + toolsets** — `.withTools({ disclosure, builtins })` are AgentConfig paths, so they ride `rawConfig.tools` (builder Tools section `ToolDisclosureField.svelte` and chat `/tools` "Show tools" rows, both via `disclosurePatch` in `ui/src/lib/chat-quickbar.ts`; `builtins` via the Lab generic renderer). The Tools quick picks list `kind: "built-in"` catalog rows plus the shell toolsets (`shellPresetPicks`); meta-tools are configured in Meta tools. A shell toolset (`git` = `git`/`gh`; framework `BUILTIN_SHELL_PRESETS`, served by `GET /api/tools/shell-presets`, never hard-coded in the UI) is selected by its own name in `tools`, never as `shell-execute`: the framework resolves the name to a `shell-execute` limited to those programs, while `shell-execute` in `tools` means the full host shell (`shellExecuteRequested`). Chat `/tools` rows follow the same rule (`toolsetChoice` in `ui/src/lib/chat-quickbar.ts`). The shell has three states (`ui/src/lib/shell-from-picks.ts`): off, toolset-only (a toolset picked, `terminalTools` off: `shell-execute` limited to its programs) and full (`terminalTools` on). While a toolset is picked the builder's host-shell checkbox never shows unchecked but stays clickable: a click flips the user's own `terminalTools` (git · gh only, full shell), and a hint says which. The chat shell chip and the `/terminal` off row read `Shell: git · gh only` in that state. Unpicking the toolset shows the user's own value again. Stored configs naming the removed `gh-cli` / `git-cli` tools are rewritten to `git` on read and at build; `gws-cli` and a stored `workspace` pick (the gws toolset the framework removed) are dropped with a server warning and never turn on the shell (`server/services/legacy-cli-tools.ts`, pinned by `server/tests/legacy-cli-tools.test.ts`). `tools.builtins` suggestions come from `GET /api/tools/toolsets`. The run view pill reads `AgentStarted.config.disclosure` (`{ mode, source }`). Pinned by `server/tests/tool-disclosure-parity.test.ts`.

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
- **`ui/vite.config.ts`** — Proxies **`/api`** and **`/ws`** to `http://127.0.0.1:$CORTEX_PORT` (default 4321, and WS). A second stack for live checks, beside a running one: start the server from its own cwd (its DB is `.cortex/cortex.db` under the cwd) with `CORTEX_PORT=4417 CORTEX_NO_OPEN=1 bun run <repo>/apps/cortex/server/index.ts`, then `CORTEX_PORT=4417 bun run --cwd apps/cortex/ui dev -- --port 5217 --strictPort`.

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

The design language is **Bench** (`wiki/Architecture/Design-Specs/2026-11-10-cortex-ui-modernization.md`; mockups and the token source `tokens.css` beside it). Violet is the agent, cyan is tools and data, green/amber/red are outcomes; the signal gradient's motion, the live glow and the sonar mean "running now" and nothing else.

| What | Where |
|------|--------|
| Semantic tokens, both themes (`--cortex-canvas`, `--cortex-surface-1..3`, `--cortex-line(-strong)`, `--cortex-text/-2/-3`, `--cortex-accent(-fill)`, `--cortex-io`, `--cortex-ok/warn/bad` + `*-tint`, `--cortex-focus`; type, radius, `--cortex-z-*` layers, motion) | `ui/src/app.css`. Light is `:root`, dark is `html.dark`; each colour also has a `*-rgb` channel token. There is **no** light-mode override block: a new colour is a token, never an `html:not(.dark)` patch. Legacy names (`--cortex-bg`, `--cortex-surface`, `--cortex-border`, `--cortex-text-muted`, …) alias the semantic tokens until the step-8 cleanup. |
| Tailwind colours | `ui/tailwind.config.ts` — every colour is `rgb(var(--cortex-*-rgb) / <alpha-value>)`; the MD3 names (`surface-container-low`, `on-surface`, `outline`, `primary`, …) are aliases onto the semantic tokens. `text-primary` is the accent, `bg-primary` the accent fill. The neutral text ladder has an opacity floor (`text-outline/40` renders as text-3) so muted text keeps AA. Layers: `z-sticky` `z-nav` `z-drawer` `z-modal` `z-toast` `z-tooltip`. |
| Fonts | Self-hosted via fontsource (`app.css`): Geist for words, JetBrains Mono for machine values. Wordmark is Geist 600, sentence case. Material Symbols still loads from the Google CDN until every icon moves to `kit/Icon.svelte` (Chat has moved; the top bar, Runs, Run view, Beacon, Lab and Settings move in steps 4-7). `MarkdownRich`'s `--cortex-md-*` tokens alias the semantic tokens. |
| Identity layer | `NeuralMark` (`kit/NeuralMark.svelte`, geometry in `lib/neural-mark.ts`; `static/favicon.svg` matches it) is the only logo and illustration. Utilities in `app.css`: `.band` (grid behind page headers), `.dotgrid` (Beacon Field), `.glow-live` (live cards only), `.sonar` (running Field nodes only), `.rail` + `.rail-live/-failed/-attention`, `.brand-grad` (22px and up only). |
| Motion setting | Settings · Motion (`lib/motion.ts`, stored as `motion` in `cortex-settings`) sets `html[data-motion="reduce"]`; `app.css` applies the same rules as `prefers-reduced-motion`. Every animation needs a reduced-motion fallback. |
| Kit components | `ui/src/lib/components/kit/`: `Icon`, `NeuralMark`, `Button`, `IconButton` (label required), `Chip`, `Badge`, `Status` (ui-core `StatusTone`), `Panel` (`live`), `PageHeader` (`band`), `Tabs`, `Field` + `Input` / `Select` / `Textarea` / `Switch`, `EmptyState` (plain / `hero`), `Overlay` (modal / drawer), `Meter`, `EntropyLine`. Logic in `lib/tablist.ts`, `lib/meter.ts`, `lib/entropy-line.ts`, `lib/overlay-focus.ts`; rendering tests in `kit/kit.test.ts` (SSR through `kit/test-render.ts`). New UI uses the kit; pages move to it step by step (spec section 9). |
| Shared formatters | ui-core `formatCost`, `formatTokens`, `formatRelativeTime`, `formatClockTime` and the status vocabulary (`statusOfRun` / `statusOfTurn` / `statusOfSubAgent`). Do not add a Cortex-local cost or time formatter. |
| Shell layout (nav, command palette, Beacon WS) | `ui/src/routes/+layout.svelte` |
| Beacon desk grid (fluid slots, panel chrome) | `AgentGrid.svelte`, `.cortex-beacon-desk-grid` in `app.css` |
| **Desk shell** (every full-height route) | `CortexDeskShell.svelte` wraps each page root (`/`, `/chat`, `/runs`, `/lab`, `/settings`, `/run`, `/run/[runId]`). Its `ambient` prop (default off) shows the two drifting orbs: on for Beacon and page-level empty states only (Runs with no runs, an empty chat), never behind dense content. Chat passes an opaque canvas so the shell grid never shows behind a transcript. |
| Run detail (vitals, trace, summary shell, bottom tabs + panel) | `RunDetail.svelte`, `VitalsStrip`, `TracePanel`, `RunOverview`, `RunFinalDeliverable` |

When adding pages or chrome, use the kit and the semantic tokens so both themes stay correct with no overrides.

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
6. **Durable approvals in chat** — a streamed chat turn with `durableRuns` + an approval-gated tool pauses (`StreamCompleted.pendingApproval`). `services/chat-approvals.ts` holds it as a `chat_pending_approvals` row (the user message waits there, not in `cortex_chat_turns`) and registers it in `durable-approvals` as an owner-managed entry: listed by `GET /api/runs/pending-approvals` (with `chatSessionId`) and `GET /api/chat/sessions/:id/approvals`, resolved by `POST /api/chat/sessions/:id/approvals/:runId/approve|deny|dismiss` or the desk `/api/runs/:runId/approve|deny`. Either way the resumed reply lands in the thread and the cached agent is evicted so history rebuilds from the DB. New turns get 409 while a turn is pending. Rows survive restart (`restore()` at boot); resuming then needs the same session config (durable config hash). A turn that pauses on `request_user_input` (`pendingInteraction`, first turn or after an approval) is held the same way in `chat_pending_interactions` (not in the desk approval list), returned as `pendingInteractions` on `GET /api/chat/sessions/:id`, and rendered by `ChatInteractionCards.svelte` as a reply box (Yes/No, choice buttons, form fields, or free text; helpers in `ui/src/lib/chat-interactions.ts`). `POST /api/chat/sessions/:id/interactions/:runId/respond` (`{ value }`) resumes it through `respondToInteraction`; the question and the answer land in the thread as their own exchange, then the reply (or the next pause). `.../interactions/:runId/dismiss` drops it. Both the stream and non-stream chat paths hold pauses (`ChatApprovals.holdIfPaused`). Pinned by `server/tests/chat-durable-approval.test.ts`.
7. **Chat slash menu state** — the menu anchors above the quick bar (so chips stay clickable) and closes on a pointer press outside it; elements marked `data-slash-menu-keep` (composer, quick bar) do not count as outside. Chip/draft/multi-select rules are pure in `ui/src/lib/chat-menu.ts` (`chipClicked`, `menuClosed`, `pickChip`/`closeMenu` for the composer + menu state together, `keepsMenuOpen`, pinned by `chat-menu.test.ts`); multi rows (`MenuItem.multi`) toggle through `createToggleQueue`, which queues PATCHes and computes each patch when it runs. ChatPanel effects that reset per session read the `$derived` `activeSession`, never the `sessionId` prop directly: the prop getter tracks the parent's whole chat store, so a direct read re-ran on every store update and wiped the composer.
8. **Chat transcript contract** — an assistant turn in `/chat` reads as the agent talking (`ChatTranscript.svelte`, ChatPanel only wires it): ui-core's `buildTurnTranscript` via `turnTranscript` in `ui/src/lib/stores/chat-timeline.ts` gives the order. The model's narration renders as normal markdown prose; the tool work between two pieces of prose is one collapsed row (`Ran 7` plus one badge per tool from ui-core `toolBadgesOf`: `web-search ×3`, an unfixed failure as a red badge that never hides behind the `+N` overflow, a fixed one with a check, then `N failed` and the duration; `Running` while a call runs) that expands into the step rows below (`ChatTurnTimeline` with `only={group.steps}`: no summary, no narration, since the prose already shows it); the answer closes the turn with its copy button. Provider thinking never enters the reading path (it stays in the expanded steps). While streaming, the in-flight text is a non-final answer, muted and unrendered. Sub-agents render as compact cards (`ChatSubAgentCards.svelte`, ui-core `subAgentCardOf` / `subAgentRollup` via `subAgentCard` in `ui/src/lib/sub-agent-view.ts`): a `4 agents · 1 running` header, then per agent its name, a status dot (running / done / failed / abstained), its goal icon, `2 tools · 20s · $0.003`, and one muted activity line (the running call with a short argument hint, the result's first line, or why it failed; never raw tool JSON). A click opens `ChatSubAgentDrawer.svelte`, a side panel that renders the child's own `ChatTranscript` (nested sub-agents are cards again); a failed child's synthetic turn carries `runFailed` so the panel closes with its ending note. Goal checks (`ChatPlanCard`, `planCardModel` in `ui/src/lib/checklist-view.ts`) are a compact `Goals 3/4` pill in the footer: the floor requirement every run has (`produce a substantive answer…`, id `answer`, ui-core `isImplicitRequirement` / `goalSummaryOf`) is hidden unless blocked, a card with only implicit checks is not shown, it opens while a plan runs or a goal is unmet, and sub-agent goals fold into each card's icon (ui-core `findSubAgentGroup`). The summary line sits in the footer; model and token usage stay in the header. Under each message an action row (`ChatTurnActions.svelte`, helpers in `ui/src/lib/chat-turn-meta.ts`) holds a status tick, the time (user: `3 minutes ago`; assistant: `Ran 2m 05s · finished 3 minutes ago`, a live `Running 12s` while it streams; the absolute time on hover), the strategy chip (`ReAct`, `ReAct + Reflexion` when sub-agents ran others; read from `StreamCompleted.metadata.strategyUsed` on the turn and each child, never from config) and copy / retry / trace / fork. Duration is the run's reported `metadata.duration`; ui-core's fold records `strategy` and `durationMs` on the trace and the server keeps them through the turns table (`db/chat-queries.ts`). A live turn's `ts` is its send time; a stored assistant row's `ts` is its finish time (`hydrateTurn` sets `finishedAt`). The assistant turn pins the provider/model it started with (`turnModelOf`). Reloaded turns build the same transcript from the stored trace (`hydrateTurn`); a trace with no narration reads as one tool group plus the answer, a turn with only `toolsUsed` shows tool-name chips. Do not re-derive the order in Cortex. Pinned by `chat-timeline.test.ts` (`turnTranscript`) and ui-core `turn-transcript.test.ts`. **Chat turn steps** — the step list (`ChatTurnTimeline.svelte`, in the turn inspector, the run-view chat tab and inside an expanded tool group) is ui-core's action-first step view (`buildTurnSteps` via `turnSteps` / `turnSummary` in `ui/src/lib/stores/chat-timeline.ts`): rows are titled by the tools called (retries grouped, `· 2 failed → ok`), narration shows under the row, thinking is collapsed, a repeat says "same as step N", failures show the reason and the fixing call, and a summary line above gives steps, calls, failures, outcome and the context window in use. Cortex renders it; it does not re-derive steps. Persisted traces carry `narration` / `thinking` per iteration (older ones only `thought`, read as narration). **Chat trace timeline** — the turn inspector's Run trace tab gets frames and timeline groups from `buildRunTrees` (`ui/src/lib/chat-export.ts`), built from the tracer JSONL (each line is already a `TraceEvent`). The run view builds its timeline from live AgentEvents (`timeline-store.ts`) instead; both categorise with `timeline-filter.ts`.
9. **Panel field styles** — `.acp-field` / `.acp-stack` / `.config-input` etc. are `:global` under `.agent-config-panel`, so section components (`ShellWorkspaceFields`, `GuardrailsFields`) inherit them; the section-shell / header rules are `:global(.agent-config-panel …)` for the same reason. New panel sections go in their own component; `AgentConfigPanel.svelte` and `ChatPanel.svelte` only wire them. Where the split giants live: AgentConfigPanel → `components/agent-config/` (`AgentConfigHeader`, `ConfigSection` shell, `sections/*Section.svelte`; section ids, titles and filter keywords in `lib/agent-config-sections.ts`); ChatPanel → `components/chat/` (`ChatHeader`, `ChatThread`, `ChatUserTurn`, `ChatAssistantTurn`, `ChatEmptyState`, `ChatComposer` (the quick bar renders inside it through its `quickBar` snippet), `ChatErrorBanner`, `ChatSessionRow` for the rail; slash-menu rows in `lib/chat-menu-items.ts`, scroll rules in `lib/chat-scroll.ts` (`followAfterScroll`: only the reader scrolling up unpins, so a chat opens and stays at its latest turn while markdown renders), rail grouping and search in `lib/chat-session-rail.ts`). Chat is the Bench reference page: kit components and semantic tokens only, icons from `kit/Icon` (slash commands, quick-bar chips and ending notes carry typed `IconName`s), no Material Symbols; ToolWorkshop → `components/tools/` + `lib/tool-workshop.ts`; Lab page → `components/lab/` (`BuilderTab` + `LaunchPanel`, `SavedAgentsTab`, `SkillsTab`) with `lib/lab-tabs.ts`, `lib/lab-builder.ts`, `lib/stores/gateway-agents-store.ts`, `lib/stores/lab-skills-store.ts`. The giants keep state ownership (tab view state stays on the Lab page so it survives tab switches).
10. **Chat queue, draft swap and compaction contract** — Config changes during a run never queue (`ui/src/lib/chat-live-config.ts`): quick-bar chips and the config commands (`/model`, `/provider`, `/thinking`, `/strategy`, `/tools`, `/terminal`, `/workspace`, `/iterations`, `/skills`, `/docs`, `/agent`) open their picker and PATCH the session config at once, the toast says it applies to the next turn, and the send button reads Send, not Queue. The server keeps the running turn's agent: `updateSessionConfig` during an in-flight turn marks the session and evicts the cached agent when the turn releases (pinned by `server/tests/chat-session-service.test.ts`). Enter during a run parks other text in one slot (`ui/src/lib/chat-queue.ts`); it auto-sends only when the run ends normally, and an error, a user stop, or a run that reported `success: false` (`lastRunFailed`; such a run still ends with a normal `StreamCompleted`) keeps it with "Send now". Text put into the composer goes through `replaceDraft` (`ui/src/lib/chat-draft.ts`), never a raw assignment; `restoreDraft` is a swap, so the text Restore displaces gets its own Restore. Compaction summaries follow `COMPACTION_SECTIONS` (`server/services/compaction-summary.ts`); headings match after `normalizeSectionHeading` (case, spacing, trailing colon or parenthetical) and are rewritten to the exact name, the UI parser mirrors the list and the rule (pinned against each other in `compaction-summary.test.ts`), and section guidance stays out of the prompt's heading lines; unstructured output is wrapped, not rejected. The estimate the compact call computes is persisted on the summary row, kept rows lose their readings, and `carryContext` must not resurrect a pre-compaction reading. Pinned by `chat-queue.test.ts`, `chat-draft.test.ts`, `chat-context.test.ts`, `compaction-summary.test.ts`, `chat-compaction-context.test.ts`.
11. **Run endings (failed, partial, abstained, files only)** — the harness never writes text into `output`. A failed or abstained run's `StreamCompleted` has `output: ""`, the cause on `error` (`… What was attempted: …`) and `terminatedBy`; an abstention also has `terminatedBy: "abstained"` and `abstention { reason, missing }`; a partial run ships the model's draft plus an `Unfinished:` list; a successful run whose answer is a file can have `output: ""` with `receipt.deliverables`. Never read harness sentences (`Could not complete the task`, `Strategy execution failed`, `[verification blocked]`, `Completed: …`) from `output`. ui-core `turnOutcomeOf` is the one classifier: server `chat-turn-trace.ts` (`turnOutcomeOf`, `readStoredOutcome`) and UI `ui/src/lib/turn-ending.ts` (`completionEnding`, `chatTurnOutcome`, `endingNote`, `endingBadge`, `runEnding`) wrap it. The cause comes from `StreamCompleted.error`; `server/services/chat-run-errors.ts` (bus `ReasoningFailed` / `AgentCompleted` / `TaskFailed`) only fills in when a completion reports none. The stream path persists a turn that did not succeed with its `output` as content (often `""`, never the streamed narration) and `trace.outcome = { success: false, ending, terminatedBy?, error?, abstention?, unfinished? }` (rows without `ending` read as failed), and a file-only answer with `trace.deliverables`. `turnsToChatMessages` sends `[The previous run failed (…): cause. No answer was given.]`, `[The previous run abstained: reason. …]` or `[The previous run produced: files.]` in place of the content (`historyContentOf`), and the auto-titler gets no reply text for a failed turn. The live cached session's own history still records the framework's own failed-turn note (`ChatEngine.streamTurn`) until the agent is rebuilt from the DB. The chat transcript closes with ui-core's `ending` segment, rendered by `ChatRunEndingNote.svelte`: failed in red (`ChatRunFailedNote`), abstained as a quiet decline with its reason and missing inputs, partial as the draft plus the unfinished list, files as a "Produced" list; the header badge (`endingBadge`) reads `did not finish` / `partial` / `abstained`. The run view's `RunEndingBanner.svelte` does the same from `AgentCompleted` (`outcome.status`). The run toast (`ui/src/lib/run-toast.ts`, one keyed toast per run) and `ui/src/lib/run-error.ts` (first line, credentials redacted, capped) are unchanged. Pinned by `server/tests/chat-failed-turn.test.ts`, `chat-run-errors.test.ts`, `chat-turn-trace.test.ts`, `chat-strategy-matrix.test.ts`, UI `turn-ending.test.ts`, ui-core `turn-outcome.test.ts`. Local providers get no Cortex `numCtx` default: unset, the framework sizes the window per model. The shared live socket is ref-counted (`ws-client.ts`): a page closing its handle must not close the layout's.
12. **Turns that never complete, and the wait on the model** — a turn that fails before its run reports (the agent cannot be built, `session.chat` throws on the tools-off path, e.g. a model that is not pulled) is persisted with the user message and `trace.outcome { ending: "failed", error }` and ends with a failed `StreamCompleted` (`failedOutcome` / `failedCompletion` in `chat-turn-trace.ts`); the cause goes through ui-core `causeLineOf`, which drops error class tags (`LLMError: `). The UI keeps the message too when nothing streamed (`failTurn` in `chat-stream.ts`). Stop calls `POST /api/chat/sessions/:id/chat/stop` (`stopTurn`, `services/chat-turn-stop.ts`), which aborts the run server-side, then drops the stream; a stream that only drops (page closed, navigated off) reads as a disconnect. Both store `trace.outcome { ending: "interrupted", interruptedBy: "user" | "disconnect", error }` with the partial text (`interruptedOutcome`; cause lines are ui-core `interruptionCause`), `StreamCancelled.reason` carries who, and history tells the model the reply was cut off. The runtime publishes no terminal bus event for an aborted stream, so `chat-ingest.ts` tracks the runs a turn started and `closeOpenRuns` ends them through ingest: `ExecutionCancelled` → run status `stopped` (also what the desk Stop publishes), `TaskFailed` → `failed`; a stopped run that then reports a failure stays `stopped`. At boot `closeOrphanedChatRuns` (`db/queries.ts`) closes chat runs a restart left `live`, except sessions holding a paused turn. The live Trace list follows the same rules (`ui/src/lib/run-live-status.ts`). While a turn waits on the model (request out, no token back; ui-core `foldModelWait`, from the send and after the last running tool finishes) the turn has `awaitingModelSince` and `ChatModelWait.svelte` shows `modelWaitLabel` (`Waiting for Ollama (loading the model or queued)` for Ollama) with the elapsed time. Status ticks and run rows paint ui-core `statusOfTurn` / `statusOfRun` tones. Pinned by `server/tests/chat-turn-endings.test.ts`, UI `stores/chat-stream.endings.test.ts`, `stores/chat-store.test.ts`, `run-live-status.test.ts`, ui-core `chat-states.test.ts`.

---

## When You Change Cortex

| Change | Update |
|--------|--------|
| New Lab builder flags wired to `buildCortexAgent` | `server/tests/config-parity.test.ts` (`FULL_CONFIG_BODY` + assertions), `ui/src/lib/cortex-runs-post-body.ts`, `AgentConfigBodyFields` in `server/api/agent-config-body.ts` (spread by both `RunConfigBody` and `ChatSessionConfigBody`; PATCH passes the validated body through), `chat-session-service` `buildChatAgentParams`, `runner-service` `LaunchParams` + `launchParamsToBuildParams`, `gateway-process-manager` `gatewayConfigToBuildParams`, `normalizeCortexAgentConfig`. `server/tests/build-path-parity.test.ts` runs one maximal config through all three build paths and fails when a `BuildCortexAgentParams` key is set on some paths only (deliberate differences live in its commented `PATH_SPECIFIC` list); a new `BuildCortexAgentParams` field is a type error there until it is listed in `PARAM_KEYS`. Also `ui/src/lib/types/agent-config.ts` `hydrateAgentConfig` for nested shapes, docs `features/cortex.md` if user-facing. A field that is already an `AgentConfig` path needs none of this: it renders in `AdvancedFrameworkConfig` (collections via `COLLECTIONS` + `ListField`) and flows through `rawConfig`. |
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
