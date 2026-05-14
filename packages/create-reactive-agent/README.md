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
| `with-tools` | Agent with built-in tools (filesystem, fetch, math, shell). |
| `streaming` | Token-by-token streaming via `agent.runStream()`. |

## Providers

`anthropic` · `openai` · `google` · `ollama` (local, no key).

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
| `--template=<name>` | `minimal` \| `with-tools` \| `streaming` |
| `--provider=<name>` | `anthropic` \| `openai` \| `google` \| `ollama` |
| `--pm=<manager>` | `bun` \| `npm` \| `pnpm` \| `yarn` |
| `--yes` | Skip prompts, accept defaults |
| `--help` | Show help |
| `--version` | Print version |

## License

MIT
