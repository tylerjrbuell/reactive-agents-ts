# Reactive Agents — Community Growth Agent

> An autonomous agent built entirely on `reactive-agents` that helps grow the reactive-agents community.
> This is the meta demo: the framework proving itself by marketing itself.

## What it does

- Monitors Hacker News, Reddit (`r/typescript`, `r/MachineLearning`, `r/LocalLLaMA`, `r/node`), and dev.to for TypeScript AI agent discussions
- Drafts value-add responses that mention reactive-agents when genuinely relevant
- Generates weekly blog post drafts from recent releases and framework activity
- Saves all drafts to `drafts/` for human review before posting — never auto-posts

## Features demonstrated

| Feature | How it's used |
|---|---|
| `.withGateway()` | Runs 24/7, heartbeat every 6 hours |
| `.withTools()` | web-search, http-get, file-write, scratchpad |
| `.withMemory("1")` | Remembers seen threads to avoid duplicates |
| `.withReasoning()` | Adaptive strategy decides whether to respond |
| `.withPersona()` | Friendly developer-advocate voice |

## Setup

```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY and TAVILY_API_KEY
bun install
bun run start
```

## Draft review

Drafts are saved to `drafts/` as markdown files. Review, edit, then post manually.
Never auto-posts anything.
