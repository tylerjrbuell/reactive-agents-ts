# create-reactive-agent

Scaffold a new [Reactive Agents](https://docs.reactiveagents.dev) project in seconds.

```bash
npm create reactive-agent my-agent
# or
bun create reactive-agent my-agent
# or
pnpm create reactive-agent my-agent
```

## Templates

| Name | Description |
| --- | --- |
| `minimal` | Single-file agent, no tools. Best starting point. |
| `with-tools` | Agent with built-in tools (web search, HTTP, file I/O, and code execution; shell is separately gated). |
| `streaming` | Token-by-token streaming via `agent.runStream()`. |
| `with-structured-output` | Typed `result.object` from a supplied schema. |
| `with-approval-gates` | Human approval before sensitive tools execute. |
| `with-memory` | SQLite-backed cross-session memory. |
| `cloudflare-worker` | Deployable Cloudflare Worker (edge) agent on OpenAI. |

> **`cloudflare-worker` note:** the generated project ships a `wrangler.toml` with
> `compatibility_flags = ["nodejs_compat"]` (required — the framework uses Node
> built-ins the edge runtime must polyfill) and a `.dev.vars` secret stub. The
> agent is pinned to OpenAI (fetch-based, edge-safe); persistent memory and
> shell/filesystem tools are not available on the edge. Run `bun run dev`
> (`wrangler dev`) locally and `bun run deploy` (`wrangler deploy`) to ship.

## Providers

`anthropic` · `openai` · `google` · `groq` · `xai` · `ollama` (local, no key).
The `cloudflare-worker` template always uses `openai`.

## Non-interactive

```bash
npm create reactive-agent my-agent -- \
  --template=streaming \
  --provider=anthropic \
  --pm=bun \
  --yes
```

## Flags

| Flag | Description |
| --- | --- |
| `--template=<name>` | `minimal` \| `with-tools` \| `streaming` \| `with-structured-output` \| `with-approval-gates` \| `with-memory` \| `cloudflare-worker` |
| `--provider=<name>` | `anthropic` \| `openai` \| `google` \| `groq` \| `xai` \| `ollama` |
| `--pm=<manager>` | `bun` \| `npm` \| `pnpm` \| `yarn` |
| `--yes` | Skip prompts, accept defaults |
| `--help` | Show help |
| `--version` | Print version |

## License

MIT
