# @reactive-agents/cli — `rax`

**The Reactive Agents eXecutable** — CLI for scaffolding, running, and inspecting AI agents.

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

rax run <prompt> [--provider anthropic|openai|ollama] [--model <model>] [--name <name>]
  Run an agent with a prompt and print the result

rax dev
  Start a development server with hot reload

rax eval run --suite <name>
  Run an evaluation suite

rax playground
  Launch an interactive REPL

rax inspect <agent-id> [--trace last]
  Inspect agent state and execution traces

rax version
  Print version
```

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

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts/reference/cli/](https://tylerjrbuell.github.io/reactive-agents-ts/reference/cli/)
