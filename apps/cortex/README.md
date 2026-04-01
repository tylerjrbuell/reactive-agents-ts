# Cortex

Local desk for Reactive Agents: Bun + Elysia API, SQLite store, WebSocket ingest/live fan-out, and a SvelteKit UI (Stage / Run / Workshop).

**Contributors & AI agents:** see **[`AGENTS.md`](./AGENTS.md)** in this folder for architecture, WS contracts, store map, pitfalls, and plan index.

## Prerequisites

From the **repo root**:

```bash
bun install
```

## Start everything (recommended for review)

From **`apps/cortex`**:

```bash
cd apps/cortex
bun start
```

This runs:

1. **Cortex server** on [http://localhost:4321](http://localhost:4321) — REST, ingest WS, live WS.
2. **SvelteKit dev** on [http://localhost:5173](http://localhost:5173) — Vite proxies `/api` and `/ws` to the server.

**Open the UI at port 5173.** The server does not auto-open a browser when started via `bun start` (so your tab stays on the dev UI).

### Two terminals (optional)

| Terminal | Command | Role |
|----------|---------|------|
| 1 | `cd apps/cortex && bun run dev:server` | API + WS on `4321` |
| 2 | `cd apps/cortex && bun run dev:ui` | UI on `5173` (proxied to `4321`) |

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `CORTEX_PORT` | `4321` | HTTP + WS listen port |
| `CORTEX_NO_OPEN` | unset | Set to `1` to disable opening a browser when running **`dev:server`** alone |

SQLite path comes from `defaultCortexConfig` in `server/types.ts` (default `.cortex/cortex.db` under the current working directory — usually `apps/cortex`).

## Production-style UI (single port)

Build the static UI and let Cortex serve it from `ui/build`:

```bash
cd apps/cortex
bun run build:ui
bun run dev:server
```

Then open [http://localhost:4321](http://localhost:4321). (Ensure `server/index.ts` `staticAssetsPath` points at the built UI — it does when run via the bundled entry.)

## Tests

```bash
cd apps/cortex
bun test
```

UI component/store tests:

```bash
cd apps/cortex/ui
bun test
```

## UI checks

```bash
cd apps/cortex/ui
bun run check   # svelte-kit sync + svelte-check
bun run build
```

## Plans

Implementation tracks `docs/superpowers/plans/2026-03-31-cortex-app-phase*.md`:

- **Phase 3** — Stage (agent grid, bottom input, WS desk).
- **Phase 4** — Run detail at `/run/[runId]` (vitals strip, D3 signal monitor, trace panel, debrief card, bottom tabs for decisions / memory / context). Live + replay via `/ws/live/:agentId?runId=` after REST loads the run row.
- **Phase 5+** — Workshop, command palette commands, replay scrubber, etc.
