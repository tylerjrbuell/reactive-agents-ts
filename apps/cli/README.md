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

The `rax` binary runs on Bun, so Bun must be on your `PATH` even when you install it with npm. See [Runtime](#runtime).

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
| `rax dev [--entry <path>] [--no-watch]` | Run your agent entrypoint in watch mode. |
| `rax serve [--port <n>] [--name <name>]` | Serve an agent over A2A. |
| `rax cortex [--port <n>] [--no-open]` | Launch the Cortex studio. Needs `@reactive-agents/cortex` installed. Pair it with `rax run ... --cortex`. |
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

The `rax` binary needs Bun >= 1.1.0 on your `PATH` (its entry is `#!/usr/bin/env bun`). Projects it scaffolds run on Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
