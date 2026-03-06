# Reactive Agents — Community Growth Agent

> An autonomous agent built entirely on `reactive-agents` that helps grow the reactive-agents community.
> This is the meta demo: the framework proving itself by marketing itself.

## What it does

- Monitors Hacker News, Reddit (`r/typescript`, `r/MachineLearning`, `r/LocalLLaMA`, `r/node`), and dev.to for TypeScript AI agent discussions
- Runs two staggered competitor sweeps every 12 hours: TypeScript-first frameworks (minute `0`) and Python-first frameworks (minute `30`)
- Generates an hourly competitive scorecard summarizing where reactive-agents is winning and where it is behind, with evidence links
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
cp .env.production.example .env.production
# Add ANTHROPIC_API_KEY and TAVILY_API_KEY
bun install
bun run build    # build reactive-agents packages first
bun run start
```

## Fast Docker Dev Loop (No Rebuild Per Edit)

Use the dev compose override to bind-mount source and run the agent in watch mode.

```bash
# from apps/meta-agent/
bun run docker:dev
```

What this does:

- Mounts `./src` and `./tools` into the container
- Runs `bun --watch` in the container for automatic restart on file changes
- Preserves generated drafts in `./drafts`

Useful commands:

```bash
bun run docker:dev:build     # rebuild image (only when deps/base image changed)
bun run docker:dev:restart   # restart container manually
 bun run docker:dev:logs      # recent logs
 bun run docker:dev:logs:follow # follow logs live
bun run docker:dev:down      # stop dev container
bun run docker:dev:fresh     # full reset: remove container + named volumes, then rebuild
```

Note: removing/recreating only the container does not clear named volumes (`agent-data`, `drafts`).
If you want a truly clean restart (no persisted memory/draft state), use `bun run docker:dev:fresh`.

For non-dev compose:

```bash
bun run docker:fresh
```

## Draft review

Drafts are saved to `drafts/` as markdown files. Review, edit, then post manually.
Never auto-posts anything.
