# @reactive-agents/cortex

> A local web studio for Reactive Agents: watch runs live, read every reasoning step, chat with agents and build them without writing code.

> **Stability:** experimental. The UI, the SQLite storage schema and the HTTP endpoints may change between minor releases.

## Install

```bash
bun add reactive-agents @reactive-agents/cortex
# or: npm install reactive-agents @reactive-agents/cortex
```

`reactive-agents` brings the `rax` CLI; `@reactive-agents/cortex` is the studio it launches.

## Usage

Start the studio:

```bash
bunx rax cortex
# API + UI on http://127.0.0.1:4321, opens in your browser
```

Then stream an agent to it from the CLI:

```bash
bunx rax run "Research the top 5 TypeScript testing frameworks" --provider anthropic --tools --cortex
```

or from your own code with `.withCortex()`:

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools()
  .withCortex() // streams to http://localhost:4321, or CORTEX_URL
  .build();

await agent.run("Summarize the top AI news this week");
```

The connection is best-effort: if Cortex is not running, the agent still runs and logs one warning. `rax cortex --help` lists the options (`--port`, `--host`, `--no-open`).

## Features

- **Beacon**: a live board of running agents, with a prompt bar to start a new run.
- **Runs and run view**: run history, the full trace, "Why it ended", and an inspector with Context (skills and recalled memories), Memory, Safety and Judgments tabs. Compare two runs.
- **Chat**: a multimodal composer (pictures, audio, files, `@` file tags), slash commands, live approvals and questions before risky tools, and voice (dictation, read aloud, voice mode).
- **Lab**: an agent builder with TypeScript export, saved agents, memory and skills studios, tools and prompts. Connect a saved gateway agent to Telegram, Signal or a signed webhook, and watch its channels and schedules in the Gateway tab.
- **Settings**: provider keys (including Ollama Cloud), judgment backends, voice engines.

Everything is stored in a local SQLite file (`.cortex/cortex.db` under the directory you start Cortex in), so you can reopen any run later.

## API

| Export or command | Use it when |
|---|---|
| `rax cortex` | You want the studio. Starts the API, WebSocket ingest and the built UI on one port. |
| `startCortexServer(config?)` | You embed Cortex in your own Bun process. Takes a partial config (`port`, `hostname`, `token`, `dbPath`, `openBrowser`) and returns `{ hostname, port, stop }`. |
| `.withCortex(url?)` | On the agent builder (`reactive-agents`): stream that agent's events to Cortex. |

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `CORTEX_PORT` | `4321` | HTTP + WS listen port |
| `CORTEX_HOST` | `127.0.0.1` | Interface the server binds. Loopback only by default; set `0.0.0.0` to expose Cortex to your network (this requires `CORTEX_TOKEN`; the server refuses to start without it) |
| `CORTEX_TOKEN` | unset | Access token for `/api/*` and `/ws/*`. Not needed on loopback. Required for a non-loopback `CORTEX_HOST`. Clients send `Authorization: Bearer <token>`; in a browser open `/?token=<token>` once (sets an HttpOnly cookie); sockets also accept `?token=` |
| `CORTEX_NO_OPEN` | unset | Set to `1` to not open a browser on start |
| `CORTEX_URL` | local Cortex on port `4321` | Where agents (`.withCortex()`, `rax run --cortex`) send events |

### Security note (Lab: host shell)

The Lab builder can opt in to **`shell-execute`**, which runs allowlisted terminal commands on the **same machine** as the Cortex server. It is off by default; turning it on is **at your own risk**. The Tools section shows one list of allowed commands: the framework defaults as removable chips, an input to add a command, and quick-add buttons for opt-in groups with a short risk note each. The list you see is exactly what the agent may run. Use it only on trusted accounts and codebases, and read the framework docs on blocklists and Docker sandboxing for stronger isolation.

## Documentation

- [Cortex Studio](https://docs.reactiveagents.dev/features/cortex/): tour, chat, run view, Lab, gateway and channels, approvals, voice, settings
- [Connect your app](https://docs.reactiveagents.dev/features/cortex/connect-your-app/): `.withCortex()` and what gets streamed
- [CLI reference](https://docs.reactiveagents.dev/reference/cli/): `rax cortex` and `rax run --cortex`

## Runtime

Bun >= 1.1.0. Cortex uses `Bun.serve` and `bun:sqlite`, so it does not run on Node.js. The agents that stream to it can run on Bun or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).

## Contributing

From a source checkout (`bun install` at the repo root), run `bun start` in `apps/cortex`. It starts the server on `:4321` and the hot-reloading SvelteKit UI on `http://localhost:5173` (Vite proxies `/api` and `/ws`; open the UI on 5173). Separately: `bun run dev:server` and `bun run dev:ui`. For a throwaway second instance use `bun run dev-stack start --port 4399 --ui-port 4398 --cwd <tmp-dir>`, then `bun run dev-stack stop --port 4399` (it stops only the processes it started).

Single-port, production-style: `bun run build:ui && bun run dev:server`, then open `http://localhost:4321`.

Checks, from `apps/cortex`: `bun test` (server), and in `ui/`: `bun test`, `bun run check`, `bun run build`.

Architecture, routes, WebSocket contracts, store map and pitfalls: [AGENTS.md](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/cortex/AGENTS.md).
