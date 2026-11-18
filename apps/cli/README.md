# @reactive-agents/cli

> `rax`, the Reactive Agents command line: scaffold a project, run an agent from a prompt, and inspect recorded runs.

> **Stability:** unstable. Command names, flags and output can change between minor versions until 1.0.

## Install

```bash
bun add -g @reactive-agents/cli
# or: npm install -g @reactive-agents/cli
```

Or run it without installing:

```bash
bunx @reactive-agents/cli --help
# or: npx @reactive-agents/cli --help
```

`rax` runs on Node.js 22.5+ or Bun, so `npx` works without Bun installed. See [Runtime](#runtime).

## Usage

See an agent work with no setup. Without an API key or a local Ollama, `rax demo` prints a recorded run and tells you which key to set:

```bash
rax demo
```

Scaffold a project, then run a one-off prompt:

```bash
rax init my-agent --template with-tools
export ANTHROPIC_API_KEY=sk-ant-...
rax run "Summarize the state of fusion energy" --provider anthropic
```

`rax init` uses the same templates as [`create-reactive-agent`](https://www.npmjs.com/package/create-reactive-agent). It picks the provider from the API key in your environment and falls back to Ollama.

Every command prints its options with `--help`, for example `rax run --help`.

## Commands

| Command | What it does |
|---|---|
| `rax demo` | Zero-config demo. Live with Ollama or an Anthropic, OpenAI or Google key; recorded output otherwise. |
| `rax init <name> [--template <name>]` | Scaffold a project. Templates: `minimal` (default), `with-tools`, `streaming`, `with-structured-output`, `with-approval-gates`, `with-memory`, `cloudflare-worker`. |
| `rax create agent <name> [--recipe basic\|researcher\|coder\|orchestrator]` | Generate an agent file in your project. |
| `rax run <prompt> [--provider <name>] [--model <id>] [--tools] [--reasoning] [--stream] [--cortex]` | Run an agent once and print the result. Providers: `anthropic` (default), `openai`, `ollama`, `gemini`, `litellm`, `groq`, `xai`, `test`. |
| `rax playground [--provider <name>] [--stream] [--memory]` | Interactive agent REPL. Uses the `test` provider by default. |
| `rax dev [--entry <path>] [--no-watch]` | Run your agent entrypoint in watch mode, with Bun when installed, else with the project's `tsx`. |
| `rax serve [--port <n>] [--name <name>]` | Serve an agent over A2A. |
| `rax cortex [--port <n>] [--no-open]` | Launch the Cortex studio. Needs Bun and `@reactive-agents/cortex` installed. Pair it with `rax run ... --cortex`. |
| `rax eval run --suite <name>` | Run an evaluation suite. |
| `rax trace inspect <path>`, `rax trace compare <a> <b>` | Read or compare JSONL trace files. |
| `rax diagnose <sub>` | Inspect recorded runs (for example `list`, `replay`, `grep`, `diff`, `debrief`). |
| `rax ps`, `rax attach <runId>` | List durable runs, or follow one until it ends. |
| `rax deploy up\|down\|status\|logs [--target <target>]` | Build and deploy an agent container. Targets: `local`, `fly`, `railway`, `render`, `cloudrun`, `digitalocean`. |
| `rax version` | Print the version. |

`rax --help` lists every command, including `skills`, `mcp`, `discover`, `inspect`, `bench` and `examples`.

## Documentation

- [CLI reference](https://docs.reactiveagents.dev/reference/cli/)
- [Quickstart](https://docs.reactiveagents.dev/guides/quickstart/)

## Runtime

The `rax` binary runs on Node.js 22.5+ (its entry is `#!/usr/bin/env node`) or on Bun >= 1.1.0. Bun honors the Node shebang, so pass `--bun` to force the Bun runtime: `bunx --bun rax ...` or `bun run --bun rax ...`. On a machine with Bun but no Node, use one of these forms. Projects it scaffolds run on either; Bun is recommended.

On Node, `rax init` and `rax demo` print npm commands (or the package manager that launched `rax`). A few commands need Bun itself. On Node they re-run under Bun when `bun` is on your `PATH`, and otherwise print a one-line "needs Bun" message:

- `rax cortex`: the Cortex server runs on Bun.
- `rax examples suite` and `rax examples demo`: they run the TypeScript example sources directly (repo checkout only).

`rax dev` uses Bun when it is installed and otherwise runs your entry with the project's `tsx`, which the npm, pnpm and yarn scaffolds already include.

Node.js 22.5 to 22.12 gate `node:sqlite` behind `--experimental-sqlite`; without it, SQLite-backed features (memory, for example) fall back to a no-op store that persists nothing. Use Node.js 22.13+ or Bun for those.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
