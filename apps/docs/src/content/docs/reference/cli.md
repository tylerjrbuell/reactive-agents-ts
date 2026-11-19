---
title: CLI Reference
description: 'Command reference for Rax, the CLI for Reactive Agents.'
topic: cli
related:
  - guides/cli-artisan
  - reference/cli/diagnose
  - guides/tools/mcp-tools
  - guides/durable-execution
---

`rax` is the artisan command line for Reactive Agents.

`Rax` stands for **Reactive Agents Executable**.
Think of it as the Reactive Agents equivalent of Laravel's Artisan CLI.

Use it to scaffold projects, generate agents, run and stream tasks, inspect runtime state, serve A2A endpoints, and deploy across local and cloud targets.

For workflow-first onboarding, start with [Rax CLI](/guides/cli-artisan/).

## Runtime

`rax` runs on **Bun (recommended) or Node.js 22.5+**. On older Node versions it exits with a message naming the required version.

A few commands need Bun itself. On Node, if Bun is installed, `rax` re-runs the command under Bun; if not, it prints one line asking you to install Bun:

| Command | Needs Bun because |
|---------|-------------------|
| `rax cortex` | The Cortex server runs on Bun |
| `rax examples suite`, `rax examples demo` | They run TypeScript example sources directly (`rax examples list` works on Node) |

`rax dev` uses Bun when it is installed and otherwise falls back to the project's local `tsx` (`npm install -D tsx`).

## Commands

### `rax init`

Create a new Reactive Agents project.

```bash
rax init <name> [--template minimal|with-tools|streaming|with-structured-output|with-approval-gates|with-memory|cloudflare-worker]
```

**Templates:**

`rax init` delegates to the `create-reactive-agent` template engine. All templates install the single unified `reactive-agents` package — no need to install individual `@reactive-agents/*` packages separately.

| Template                  | What's scaffolded                                                          |
|---------------------------|----------------------------------------------------------------------------|
| `minimal` (default)       | `reactive-agents` + single-file agent. No tools. Best starting point.       |
| `with-tools`              | Agent with built-in tools (web-search, http-get, file I/O, code-execute)    |
| `streaming`               | Token-by-token streaming via `agent.runStream()`                            |
| `with-structured-output`  | Typed structured output - declare a schema, read `result.object`            |
| `with-approval-gates`     | Human-in-the-loop - pause on sensitive tool calls for approval              |
| `with-memory`             | Cross-session memory (SQLite) - the agent remembers across runs             |
| `cloudflare-worker`       | Deployable Cloudflare Worker (edge) agent on OpenAI, with wrangler config   |

Generated `src/index.ts` imports from `"reactive-agents"` and is runnable after you install dependencies (`bun install` or `npm install`) and copy `.env.example` to `.env`.

### `rax create agent`

Generate an agent file from a recipe, or use `--interactive` for guided scaffolding.

```bash
rax create agent <name> [--recipe basic|researcher|coder|orchestrator]
rax create agent <name> --interactive
```

**Recipes:**

| Recipe | What It Generates |
|--------|------------------|
| `basic` | Minimal agent with LLM only |
| `researcher` | Agent with memory + reasoning |
| `coder` | Agent optimized for code tasks |
| `orchestrator` | Multi-agent orchestrator with memory |

**Interactive mode:**

The `--interactive` flag launches a readline-based wizard (TTY only) that prompts for:

1. **Agent name** — defaults to the first positional argument if you pass one (e.g. `rax create agent my-agent --interactive`).
2. **Provider** — one of `anthropic`, `openai`, `gemini`, `groq`, `xai`, or `ollama` (same set the wizard validates today).
3. **Recipe** — `basic`, `researcher`, `coder`, or `orchestrator`.
4. **Features** — comma-separated list; default `reasoning,tools`. This is collected for the session; the **generated file is determined only by the recipe** (templates live in `apps/cli/src/generators/agent-generator.ts`). Adjust `.withProvider()`, `.withModel()`, and builder flags in the generated source after scaffolding if you need a different stack.

```bash
$ rax create agent my-agent --interactive

Create Agent (Interactive)
? Agent name: my-research-agent
? Provider [anthropic/openai/gemini/groq/xai/ollama]: anthropic
? Recipe [basic/researcher/coder/orchestrator]: researcher
? Features (comma-separated) (reasoning,tools): reasoning,tools

✔ Created: src/agents/my-research-agent.ts
```

### `rax run`

Run an agent with a prompt.

```bash
rax run <prompt> [--provider anthropic|openai|gemini|groq|xai|ollama|litellm|test]
          [--model <model>] [--name <name>] [--tools] [--reasoning] [--stream] [--cortex]
          [--verbose|-v] [--quiet]
```

| Flag | Behavior |
| --- | --- |
| `--tools` | Enables the built-in tools (files, web, code), equivalent to `.withTools({ builtins: true })`. |
| `--stream` | Streams tokens to the terminal and turns off the live status line. |
| `--quiet` | Prints only the output and turns off the live status line. |
| `--verbose`, `-v` | Shows phase-by-phase execution details, including when output is piped (not a TTY). |

**`--cortex`:** Enables `.withCortex()` on the builder so run lifecycle events are sent to a local **Cortex** companion studio (WebSocket ingest). Cortex is available as a public npm package (`@reactive-agents/cortex`). For npm-installed CLI: `bun add @reactive-agents/cortex && rax cortex`. For repo contributors: `bun cortex` (runs from source with hot reload). Set `CORTEX_URL` to the HTTP base (default `http://127.0.0.1:4321`).

**Example:**

```bash
rax run "Explain quantum computing" --provider anthropic --model claude-sonnet-4-6
```

### `rax demo`

Run the live demo with the first detected provider: local Ollama, then an
Anthropic, OpenAI, or Google API key. Google Gemini is selected as the `gemini`
provider. If no provider is configured, Rax displays the recorded example
output instead.

```bash
rax demo
```

### `rax examples`

Run the offline-capable example suite or launch a standalone demo.

```bash
rax examples suite [--offline] [--filter <category>] [<numbers>...]
rax examples list
rax examples demo <name> [--provider <provider>] [--model <model>] [--port <port>]
```

`suite` and `demo` need Bun (see [Runtime](#runtime)). `suite` runs from a repository checkout: the published CLI does not ship the example sources.

- `suite --offline` runs examples that need no provider credentials. `--filter` selects a category; numeric arguments run selected numbered examples.
- `list` prints available standalone demos.
- `demo island-sim` starts the survival simulation UI. `--provider`, `--model`, and `--port` pass through to demos that support them.

```bash
rax examples suite --offline
rax examples demo island-sim --provider ollama --model cogito:14b --port 3007
```

See the [Examples Catalog](/guides/examples/) for the runnable examples and demos.

### Cortex (companion studio)

Cortex is available as a public npm package and from source. `rax cortex` needs Bun (see [Runtime](#runtime)).

**From npm (recommended for users):**
```bash
bun add @reactive-agents/cortex
rax cortex
# Opens http://127.0.0.1:4321 in your browser
```

**From source (for contributors with hot reload):**
```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts
cd reactive-agents-ts
bun install
bun cortex
# API on http://localhost:4321 — UI on http://localhost:5173 (hot reload)
```

Then in another terminal:

```bash
rax run "Research topic" --cortex --provider anthropic
```

| Variable | Purpose |
|----------|---------|
| `CORTEX_PORT` | API listen port (default `4321`) |
| `CORTEX_HOST` | Listen address (default `127.0.0.1`; same as `rax cortex --host <addr>`). Cortex can run code and read files, so any non-loopback address requires `CORTEX_TOKEN`: without it, Cortex refuses to start |
| `CORTEX_TOKEN` | Access token for `/api/*` and `/ws/*`. Required for a non-loopback `CORTEX_HOST`. Clients send `Authorization: Bearer <token>`; in a browser, open `/?token=<token>` once to store it in a cookie |
| `CORTEX_ALLOWED_HOSTS` | Comma-separated extra host names Cortex accepts in `Host`/`Origin` (for a public URL or reverse proxy). Requests naming any other host get 403 |
| `CORTEX_NO_OPEN` | Set to `1` to skip opening a browser |
| `CORTEX_URL` | Base URL the agent uses to reach Cortex ingest |

### `rax serve`

Start an agent as an A2A server. `--provider` takes any built-in provider or `test`, including `groq` and `xai`.

```bash
rax serve [--port <number>] [--name <name>] [--provider <provider>] [--model <model>]
          [--with-tools] [--with-reasoning] [--with-memory]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | `3000` | HTTP port for the A2A server |
| `--name` | `"agent"` | Agent name (used in Agent Card) |
| `--provider` | `"test"` | LLM provider |
| `--model` | — | Model name |
| `--with-tools` | off | Enable built-in tools on the A2A server agent (file-write, web-search, etc.) |
| `--with-reasoning` | off | Enable reasoning strategies |
| `--with-memory` | off | Enable memory. With no extra token: default tier (`.withMemory()`). Pass `enhanced` or `2` immediately after the flag for full four-layer memory with embeddings (`.withMemory({ tier: "enhanced" })`). Optional `basic` or `1` after the flag keeps the default tier and consumes that token (same behavior as omitting it). |

**Endpoints served:**

- `GET /.well-known/agent.json` — Agent Card (A2A discovery)
- `GET /agent/card` — Agent Card (fallback)
- `POST /` — JSON-RPC 2.0 (`message/send`, `tasks/get`, `tasks/cancel`, `agent/card`)

**Example:**

```bash
rax serve --name researcher --provider anthropic --model claude-sonnet-4-6 --with-tools --port 4000
```

### `rax discover`

Fetch and display the Agent Card from a remote A2A-compatible agent server.

```bash
rax discover <url>
```

Fetches `GET <url>/.well-known/agent.json` and pretty-prints the agent's name, description, capabilities, and supported skills.

**Example:**

```bash
rax discover http://localhost:3000
```

```
Agent Card: researcher
  Provider: anthropic (claude-sonnet-4-6)
  Capabilities: streaming, tools
  Skills: web-search, file-write
  Endpoint: http://localhost:3000
```

### `rax deploy`

Deploy an agent using a provider adapter (local Docker, Fly.io, Railway, Render, Cloud Run, DigitalOcean).

```bash
rax deploy up [--target local|fly|railway|render|cloudrun|digitalocean]
              [--mode daemon|sdk]
              [--dry-run]
              [--scaffold-only]
              [--name <agent-name>]
              [--allow-unauthenticated]   # cloudrun only

rax deploy down [--target <target>]
rax deploy status [--target <target>]
rax deploy logs [-f] [--target <target>]
rax deploy init   # legacy alias for `deploy up --scaffold-only`
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--target` | `local` (auto-detected if config exists) | Deploy provider adapter |
| `--mode` | `daemon` | `daemon` for full agent loop, `sdk` for HTTP API mode |
| `--dry-run` | off | Run provider `preflight()` checks and print execution plan |
| `--scaffold-only` | off | Generate config files only, do not deploy |
| `--name` | auto-detected from `package.json` (slugified) | Agent/app identifier. Must match `/^[a-z0-9][a-z0-9-]{0,40}$/`; anything else is rejected. Provider commands run as argument arrays, never through a shell |
| `--allow-unauthenticated` | off | Cloud Run only. By default the service requires IAM auth (`--no-allow-unauthenticated`); this makes it public. The agent API has no auth of its own |
| `--follow`, `-f` | off | Follow logs for `deploy logs` |

**Provider CLI Contracts:**

These commands and flags are validated by `apps/cli/tests/cli-contracts.test.ts` to detect upstream CLI breaking changes early.

| Provider | CLI | Contract Baseline |
|----------|-----|-------------------|
| local | Docker + Compose | Docker `>= 20`, Compose `>= 2`, supports `compose build/up/down/ps/logs`, `up -d`, `logs --tail/--follow`, `ps --format` |
| fly | `flyctl` / `fly` | supports `auth whoami`, `launch --copy-config --name --no-deploy`, `deploy`, `status`, `logs`, `apps destroy --yes` |
| railway | `railway` | supports `whoami`, `link`, `up`, `down --yes`, `status`, `logs`, `variables` |
| render | `render` | supports `blueprints validate`, `services list`, `logs`. There is no CLI command that creates services from a blueprint: connect the Git repo at `dashboard.render.com/blueprints` |
| cloudrun | `gcloud` | SDK `>= 380`, supports `config get-value project`, `auth list --filter --format`, `run deploy --source --region --port --memory --timeout --no-allow-unauthenticated\|--allow-unauthenticated --min-instances --no-cpu-throttling`, `run services describe/delete/update` |

**Always-on daemon settings.** `--mode daemon` runs cron, heartbeat and channels, so the scaffolds keep an instance running: Fly sets `auto_stop_machines = "off"` with one health check; Cloud Run deploys with `--min-instances=1 --no-cpu-throttling`; Render needs a paid (non-free) plan, which the scaffold uses. `--mode sdk` is request-driven and may scale to zero.
| digitalocean | `doctl` | `>= 1.72`, supports `account get --format --no-header`, `apps create/list/update/delete/logs`, `--spec`, `--format` |

**Containerized CLI fallback:**

For `flyctl`, `gcloud`, and `doctl`, `rax deploy` resolves local binaries first and can fall back to a Docker-wrapped CLI when Docker is available.

**Contract test commands:**

```bash
bun test apps/cli/tests/cli-contracts.test.ts
RUN_SLOW_TESTS=1 bun test apps/cli/tests/cli-contracts.test.ts
```

`RUN_SLOW_TESTS=1` enables container image availability checks for the fallback images.

### `rax dev`

Run your local entrypoint in watch mode.

```bash
rax dev [--entry src/index.ts] [--no-watch]
```

Default entrypoint is `src/index.ts`. Use `--entry` if your project uses a different file.

`rax dev` runs the entry with Bun (`bun --watch run`) when Bun is installed. Without Bun, it uses the project's local `tsx` (`tsx watch`); install it with `npm install -D tsx`. With neither, it exits with a message.

### `rax eval`

Run an evaluation suite from a YAML/JSON dataset file. Uses `@reactive-agents/eval` with frozen-judge isolation (Rule 4) — the judge LLM is wired through a separate `JudgeLLMService` Tag so its code path is isolated from the SUT.

```bash
rax eval run --suite <path-to-suite> [--provider anthropic|openai|test] [--agent <name>]
```

Options:

- `--suite <path>` — required. Path to the suite definition file.
- `--provider <name>` — `anthropic`, `openai`, or `test` (default: `test`)
- `--agent <name>` — agent config name to load from your project (default: `default`)

The runtime guard rejects identical `judge.model === sutModel` pairings to prevent self-judging bias.

### `rax eval gate`

Decide whether a candidate variant beats a baseline on a session report, with the same lift rule the project uses for default-on changes.

Exit codes: `0` when the decision is not a reject, `1` when the decision is `reject`, `2` when no tiers were covered or `--activations 0` (an A/A comparison measures nothing).

```bash
rax eval gate --report <SessionReport.json> --baseline <variantId> --candidate <variantId> \
              [--metric <dimension>] [--min-lift <pp>] [--max-tok <pct>] [--min-tiers <n>] \
              [--token-leg <raw|billed>] \
              [--ledger <path> --weakness <t> --hypothesis <t> --weakness-ref <id> --activations <n>]
```

- `--activations <n>` — how many candidate runs the mechanism under test actually acted in.
- `--ledger <path>` with `--weakness`, `--hypothesis`, `--weakness-ref`, and `--activations` appends the gate outcome to the improvement ledger at that path.

### `rax playground`

Launch an interactive agent REPL session.

```bash
rax playground [--provider <provider>] [--model <model>] [--tools] [--reasoning] [--stream]
```

Use `/help` and `/exit` inside the session.

### `rax inspect`

Inspect local deployment/runtime signals for an `agentId`.

```bash
rax inspect <agent-id> [--logs-tail 200] [--json]
```

This checks Docker/Compose availability, prints compose status, and scans recent logs for lines containing the provided `agentId`.

### `rax diagnose`

Forensic CLI for recorded JSONL traces: `list`, `replay`, `replay-run`, `grep`, `diff`, `debrief`, `signals`, `cause` and `attribute`. The full subcommand reference, including how `cause` and `attribute` classify a run, is on [rax diagnose](/reference/cli/diagnose/).

### `rax ps`

List durable runs (see [Durable execution](/guides/durable-execution/) and the [process model](/features/process-model/#cli-rax-ps-and-rax-attach)) across every `~/.reactive-agents/*/runs.db`, newest first.

```bash
rax ps [--db <path>] [--all]
```

- By default only non-terminal runs are shown: `paused`, `awaiting-approval` and `awaiting-interaction` are alive, blocked on a resume or a decision. `completed` and `failed` are hidden until you pass `--all`.
- `--db <path>` scans one RunStore database and skips the glob discovery.
- Output columns are `RUN ID`, `STATUS`, `AGENT` and `TASK` (truncated to 60 characters). A forked run carries a `[FORKED-FROM <runId>@<iteration>]` note.
- With no databases it prints `No RunStore databases found...`; with no matching runs it prints `No active runs. Pass --all to include completed/failed.`

### `rax attach`

Watch one durable run until it ends.

```bash
rax attach <runId> [--db <path>]
```

It polls the RunStore once a second and prints a `status:` line and an `iteration:` line (the latest checkpoint) each time either changes. It exits when the run reaches `completed` or `failed`. `Ctrl-C` detaches and leaves the run going. If the run id is not found in any database after 10 polls (about 10 seconds) it exits with code 1; find ids with `rax ps --all`. This is a poll loop, not a push stream.

### `rax trace`

Read a JSONL trace file written by `.withTracing()`. For forensic analysis of recorded runs use [`rax diagnose`](/reference/cli/diagnose/).

```bash
rax trace inspect <path>      # run id, event/iteration/token totals, interventions, max entropy, then a timeline
rax trace compare <a> <b>     # iterations, tokens, interventions and max entropy for two traces, side by side
```

`inspect` prints one timeline line per `entropy-scored`, `intervention-dispatched`, `intervention-suppressed` and `strategy-switched` event. `compare` treats `<a>` as the baseline and `<b>` as the candidate, with a delta for iterations and tokens.

### `rax skills`

Export, import and list the learned skills in an agent's memory database. Skills move as `SKILL.md` files. See [Agent skills](/guides/agent-skills/) and [Memory](/guides/memory/) for how skills are learned and shared.

```bash
rax skills export --agent <id> [--name <skill>] [--out <file|dir>]
rax skills import <file> --agent <id> [--rebind <newAgentId>] [--regenerate-id]
rax skills list --agent <id>
```

- `export` writes one skill, or all of them when `--name` is omitted. With no `--out` it prints to stdout. Several skills (or an `--out` that is a directory) produce `<skill-name>.SKILL.md` files in that directory. It exits with code 1 if the memory database or a matching skill does not exist.
- `import` stores the skill under `--agent`, or under `--rebind` if given. `--regenerate-id` gives it a fresh id.
- `list` prints name, version, confidence, success rate, use count and task categories per skill.
- All three accept `--db <path>` to override the memory database, which defaults to `~/.reactive-agents/memory/<agent>/memory.db`.

### `rax mcp`

Manage OAuth credentials for remote MCP servers: `rax mcp login <name|--url <endpoint>>`, `rax mcp logout <name|--url <endpoint>>` and `rax mcp status`. `<name>` resolves against `.rax/mcp.json` in the current directory (or `--mcp-config <path>`). `status` never prints tokens. Flags, the grant types and where tokens are stored are in the [MCP tools guide](/guides/tools/mcp-tools/#rax-mcp-login-logout-status).

### `rax bench`

Run the benchmark suite. It needs the private `@reactive-agents/benchmarks` package, so it works only inside a checkout of the reactive-agents-ts repository; elsewhere it exits with an explanatory error.

```bash
rax bench [--provider <name>] [--model <id>] [--tier <a,b,...>] [--timeout <seconds>] [--log-level silent|progress|verbose] [--output <file>]
rax bench --session <name> [--log-level ...] [--output <file>]
```

- Without `--session`, `--provider` defaults to `test` (the mock provider; other values are `anthropic`, `openai`, `gemini`, `groq`, `xai`, `ollama`, `litellm`). `--tier` takes a comma-separated list; `--timeout` is in seconds.
- With `--session`, the named session decides providers and models. Valid names: `regression-gate`, `real-world-full`, `local-models`, `competitor-comparison`, `frontier-spot-check`. An unknown name lists them and exits with code 1. A session that uses only Ollama models defaults `BENCH_JUDGE_PROVIDER` to `ollama` unless you set it.
- `--log-level` defaults to `progress`. `--output` writes the JSON report to that file.
- `rax bench` has no `--help` flag: any call without `--session` starts a run. Live providers cost real tokens.

### `rax version`

```bash
rax version
rax --version
rax -v
```

### `rax help`

```bash
rax help
rax --help
rax -h
```
