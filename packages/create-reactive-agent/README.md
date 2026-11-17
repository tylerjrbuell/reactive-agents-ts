# create-reactive-agent

> Scaffold a new Reactive Agents TypeScript project with one command: pick a template, a provider and a package manager.

[![npm](https://img.shields.io/npm/v/create-reactive-agent?color=CB3837&logo=npm)](https://www.npmjs.com/package/create-reactive-agent)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/features/create-reactive-agent/)

> **Stability:** unstable. Templates, the generated files and the CLI flags can change between minor versions with a changelog note; the programmatic API has no stable-tier commitment.

## Install

You normally do not install it. Run it through your package manager's `create` command:

```bash
npm create reactive-agent my-agent
# or: bun create reactive-agent my-agent
# or: pnpm create reactive-agent my-agent
```

To call it from code, add the package:

```bash
bun add create-reactive-agent
# or: npm install create-reactive-agent
```

## Usage

Run the command without flags for interactive prompts, or pass flags for a non-interactive run:

```bash
npm create reactive-agent my-agent -- \
  --template=streaming \
  --provider=anthropic \
  --pm=bun \
  --yes
```

The same scaffold from code:

```ts
import { scaffold } from "create-reactive-agent";

const result = await scaffold({
  dir: "./my-agent",
  projectName: "my-agent",
  template: "minimal",
  provider: "anthropic",
  packageManager: "bun",
});

console.log(result.files);     // paths written, relative to dir
console.log(result.nextSteps); // commands to run next
```

`scaffold` throws if the target directory exists and is not empty.

### Templates

| Name | Description |
| --- | --- |
| `minimal` | Single-file agent, no tools. Best starting point. |
| `with-tools` | Agent with built-in tools (web search, HTTP, file I/O, and code execution; shell is separately gated). |
| `streaming` | Token-by-token streaming via `agent.runStream()`. |
| `with-structured-output` | Typed `result.object` from a supplied schema. |
| `with-approval-gates` | Human approval before sensitive tools execute. |
| `with-memory` | SQLite-backed cross-session memory. |
| `cloudflare-worker` | Deployable Cloudflare Worker (edge) agent on OpenAI. |

The `cloudflare-worker` project ships a `wrangler.toml` with `compatibility_flags = ["nodejs_compat"]` (the framework uses Node built-ins the edge runtime must polyfill) and a `.dev.vars` secret stub. It is pinned to OpenAI (fetch-based, edge-safe); persistent memory and shell or filesystem tools are not available on the edge. Run `bun run dev` (`wrangler dev`) locally and `bun run deploy` (`wrangler deploy`) to ship.

### Providers

`anthropic` · `openai` · `google` · `groq` · `xai` · `ollama` (local, no key). The `cloudflare-worker` template always uses `openai`.

### Flags

| Flag | Description |
| --- | --- |
| `--template=<name>` | `minimal` \| `with-tools` \| `streaming` \| `with-structured-output` \| `with-approval-gates` \| `with-memory` \| `cloudflare-worker` |
| `--provider=<name>` | `anthropic` \| `openai` \| `google` \| `groq` \| `xai` \| `ollama` |
| `--pm=<manager>` | `bun` \| `npm` \| `pnpm` \| `yarn` |
| `--yes` | Skip prompts, accept defaults |
| `--help` | Show help |
| `--version` | Print version |

## API

| Export | Use it when |
|---|---|
| `scaffold(options)` | You want to write a project to disk. Resolves to `{ dir, files, nextSteps }`. |
| `listTemplates()` / `getTemplate(name)` | You need the template names and descriptions. |
| `renderTemplate(options)` | You want the generated files in memory without writing them. |
| `providerEnvVar` / `providerDefaultModel` / `providerImport` / `providerRuntimeName` | You need the per-provider wiring the templates use. |

## Documentation

- [create-reactive-agent](https://docs.reactiveagents.dev/features/create-reactive-agent/)
- [Quickstart](https://docs.reactiveagents.dev/guides/quickstart/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
