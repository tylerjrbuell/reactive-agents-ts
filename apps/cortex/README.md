# Cortex

Local desk for Reactive Agents: Bun + Elysia API, SQLite store, WebSocket ingest/live fan-out, and a SvelteKit UI: Beacon, Chat (multimodal composer, voice), Runs and run traces, Lab builder, Judgments, memory and skills, and approvals. User docs: https://docs.reactiveagents.dev/features/cortex/

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

For a second, throwaway instance (tests, tooling) use the pid-file lifecycle instead of killing by port: `bun run dev-stack start --port 4399 --ui-port 4398 --cwd <tmp-dir>`, then `bun run dev-stack status` and `bun run dev-stack stop --port 4399`. `stop` only touches processes `start` recorded in `.cortex-run/` (override with `CORTEX_RUN_DIR`).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `CORTEX_PORT` | `4321` | HTTP + WS listen port |
| `CORTEX_HOST` | `127.0.0.1` | Interface the server binds. Loopback only by default; set `0.0.0.0` to expose Cortex to your network (this requires `CORTEX_TOKEN`; the server refuses to start without it) |
| `CORTEX_TOKEN` | unset | Access token for `/api/*` and `/ws/*`. Not needed on loopback. Required for a non-loopback `CORTEX_HOST`. Clients send `Authorization: Bearer <token>`; in a browser open `/?token=<token>` once (sets an HttpOnly cookie); sockets also accept `?token=` |
| `CORTEX_NO_OPEN` | unset | Set to `1` to disable opening a browser when running **`dev:server`** alone |

SQLite path comes from `defaultCortexConfig` in `server/types.ts` (default `.cortex/cortex.db` under the current working directory — usually `apps/cortex`).

## Security note (Lab — host shell)

The Lab builder can opt in to **`shell-execute`**, which runs allowlisted terminal commands on the **same machine** as the Cortex server. It is disabled by default; enabling it is **at your own risk**. When enabled, the Tools section shows **one list of allowed commands**: the framework defaults pre-filled as chips you can remove, an input to add a command, and quick-add buttons for opt-in groups (JavaScript, Python, Web, Archives, Environment) with a short risk note each. The list you see is exactly what the agent may run; defaults and opt-in commands come from `ShellExecuteConfig` in `@reactive-agents/tools`. Use only on trusted accounts and codebases, and read the framework docs on blocklists and Docker sandboxing for stronger isolation.

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

## Features

- **Beacon** — live board and field of running agents, with a prompt bar.
- **Chat** — multimodal composer (pictures, audio, files, `@` file tags), slash commands such as `/mcp` and `/btw`, rich answers with deliverables, live approvals and questions (agents ask before risky tools such as writing files or running the shell by default; switch it off per agent), one command list shared by `/` and the Config button, and voice (dictation, read aloud, voice mode).
- **Runs and run view** — run table, trace, "Why it ended", and an inspector with Context (skills and recalled memories), Memory, Safety and Judgments tabs. Compare two runs.
- **Lab** — agent builder (with TypeScript export), saved agents, memory studio, agent skills, tools and prompts. A **Channels** builder section connects a saved Gateway process agent to Telegram, Signal or a signed webhook: credentials are saved encrypted and never shown again, a connection test checks them, and the access list is fail-closed (an empty list means nobody can message the agent; "Allow everyone" is an explicit switch). The **Gateway** tab shows each gateway agent's live channel connections, schedules (next fire and recent runs), inbound queue activity and recent messages and refusals.
- **Settings** — provider keys (including Ollama Cloud), judgment backends, voice engines.

Architecture, routes and contracts for contributors are in [`AGENTS.md`](./AGENTS.md). Earlier phase plans are archived under `wiki/Planning/Implementation-Plans/Superpowers/archive/`.
