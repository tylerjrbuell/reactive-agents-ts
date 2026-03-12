# @reactive-agents/cli — `rax`

**The Reactive Agents eXecutable** — CLI for scaffolding, running, and inspecting AI agents.

[![npm downloads](https://img.shields.io/npm/dm/%40reactive-agents%2Fcli?logo=npm)](https://www.npmjs.com/package/@reactive-agents/cli)

## Installation

```bash
# Global install
bun add -g @reactive-agents/cli

# Or run without installing
bunx @reactive-agents/cli --help
```

## Commands

```bash
rax init <name> [--template minimal|standard|full]
  Scaffold a new Reactive Agents project

rax create agent <name> [--recipe basic|researcher|coder|orchestrator]
  Generate an agent file in your project

rax run <prompt> [--provider anthropic|openai|ollama|gemini|litellm|test] [--model <model>] [--name <name>] [--stream]
  Run an agent with a prompt and print the result

rax dev [--entry src/index.ts] [--no-watch]
  Run your local agent entrypoint in watch mode

rax eval run --suite <name>
  Run an evaluation suite

rax playground
  Launch an interactive agent REPL session

rax inspect <agent-id> [--logs-tail 200] [--json]
  Inspect local deployment signals and recent matching logs

rax deploy up [--target local|fly|railway|render|cloudrun|digitalocean] [--mode daemon|sdk] [--dry-run]
  Build + deploy agent container through provider adapters

rax deploy down [--target <target>]
  Stop deployment (target auto-detected from config)

rax deploy status [--target <target>]
  Show deployment status (target auto-detected from config)

rax deploy logs [-f] [--target <target>]
  Tail deployment logs (target auto-detected from config)

rax version
  Print version
```

## Deploy Provider Contracts

Deploy adapters are validated with CLI contract tests so upstream CLI changes can trigger early patches.

```bash
bun test apps/cli/tests/cli-contracts.test.ts
RUN_SLOW_TESTS=1 bun test apps/cli/tests/cli-contracts.test.ts
```

Baseline contract checks include:

- Docker `>= 20`, Compose `>= 2`
- `gcloud >= 380.0.0`
- `doctl >= 1.72.0`
- Fly/Railway/Render command and flag availability for adapter-invoked subcommands

Containerized fallback CLIs (`flyctl`, `gcloud`, `doctl`) are supported when Docker is available.

## Examples

```bash
# Scaffold a new project with all features
rax init my-ai-app --template full
cd my-ai-app
bun install

# Generate a research agent
rax create agent researcher --recipe researcher

# Run a one-off prompt
export ANTHROPIC_API_KEY=sk-ant-...
rax run "Summarize the state of fusion energy" --provider anthropic
```

## Documentation

Full documentation at [docs.reactiveagents.dev/reference/cli/](https://docs.reactiveagents.dev/reference/cli/)
