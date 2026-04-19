---
title: What's New
description: Latest features and changes to Reactive Agents across recent releases
sidebar:
  order: 2
---

A quick-scan guide to what has landed in each major release. Start here when returning after time away — each bullet links to the relevant documentation.

---

## Current (post-v0.9.0)

Features shipped to `main` since the v0.9.0 tag, not yet assigned a version number.

- **StatusRenderer TUI** — live terminal display with collapsible think panel (`t` key toggles), `mode: 'stream' | 'status'` — see [Observability](../features/observability)
- **3 new terminal tools** — `git-cli`, `gh-cli`, and `gws-cli` are now built-in, bringing the total to 11 — see [Tools](./tools)
- **New web-search provider: Serper.dev** — third web-search backend alongside Tavily; no extra config beyond `SERPER_API_KEY` — see [Tools](./tools)
- **`crypto-price` built-in tool** — CoinGecko price lookup, no API key required, module-level cache — see [Tools](./tools)
- **Observability on by default** — minimal verbosity is now enabled out of the box; no `.withObservability()` call needed for basic output — see [Observability](../features/observability)
- **Sub-agent `maxIterations` fully honored** — the silent cap of 3 has been removed; your configured value is respected — see [Sub-agents](./sub-agents)

---

## v0.9.0 — MCP Production Hardening

- **MCP client rewritten on `@modelcontextprotocol/sdk`** — smart auto-detection between stdio and HTTP-only containers, two-phase docker lifecycle — see [Orchestration](../features/orchestration)
- **Composable kernel architecture** — `react-kernel.ts` reduced from ~1,700 to ~197 lines via `makeKernel({ phases })` factory; phases are now individually swappable — see [Composable Kernel](../concepts/composable-kernel)
- **Permanently-failed required tools fix** — tools that always error no longer cause loop-until-maxIterations; framework detects and stops early — see [Harness Control Flow](../features/harness-control-flow)
- **Cortex MCP CRUD + JSON import** — import Cursor/Claude-style MCP configs directly into Cortex — see [Cortex](../features/cortex)
- **`effect` moved to `peerDependencies`** — add `effect` explicitly if you import from it directly — see [Installation](./installation)

---

## v0.8.5 — Native FC Hardening + Web Framework Adapters

- **React, Vue, and Svelte adapters** — `useAgentStream()` and `useAgent()` hooks/composables/stores for all three frameworks, consuming SSE endpoints — see [Web Integration](./web-integration) and [Streaming](../features/streaming)
- **7-hook provider adapter system** — `taskFraming`, `toolGuidance`, `errorRecovery`, `synthesisPrompt`, `qualityCheck`, `continuationHint`, `systemPromptPatch` fully wired — see [Reactive Intelligence](../features/reactive-intelligence)
- **Dynamic stopping (3-layer)** — novelty signal (Jaccard overlap), budget exhaustion phase transition, and per-tool call cap (`maxCallsPerTool`) — see [Harness Control Flow](../features/harness-control-flow)
- **Full prompt observability** — `logModelIO: true` logs the complete FC conversation thread with no truncation — see [Observability](../features/observability)
- **Actionable failure messages** — loop detection, required-tools, and stall detection all emit `Fix:` suggestions with specific builder options — see [Troubleshooting](./troubleshooting)

---

## v0.8.0 — Reactive Intelligence Layer

- **Entropy-aware intelligence pipeline** — 5-source composite entropy sensor, trajectory classifier, and reactive controller that takes corrective action automatically — see [Reactive Intelligence](../features/reactive-intelligence)
- **Thompson Sampling strategy learner** — SQLite-backed bandit learns which reasoning strategy wins per task category across runs — see [Reactive Intelligence](../features/reactive-intelligence)
- **Builder hardening** — `withStrictValidation()`, `withTimeout()`, `withRetryPolicy()`, `withFallbacks()`, `withHealthCheck()`, and `withErrorHandler()` — see [Builder API](../reference/builder-api)
- **Automatic strategy switching** — when entropy analysis detects a stuck loop, the agent switches reasoning strategy without user intervention — see [Choosing Strategies](./choosing-strategies)
- **Observability dashboard upgrade** — chalk/boxen terminal UI with entropy grade (A–F), sparklines, and entropy-informed alerts — see [Observability](../features/observability)

---

## v0.5.0 — A2A Protocol + Observability Foundation

- **Full A2A (Agent-to-Agent) protocol** — JSON-RPC 2.0 server, streaming SSE, client, discovery, and capability matching based on Google's A2A spec — see [A2A Protocol](../features/a2a-protocol)
- **Agent-as-tool pattern** — wrap any local or remote A2A agent as a callable tool with `createAgentTool()` / `createRemoteAgentTool()` — see [Sub-agents](../guides/sub-agents)
- **Live observability streaming** — `withObservability({ live: true, verbosity })` writes structured phase logs to stdout as each step fires — see [Observability](../features/observability)
- **`rax serve`** — expose any agent as an A2A-compliant HTTP server with a single CLI command — see [CLI](../reference/cli)
- **EventBus reasoning events** — all 5 strategies publish `ReasoningStepCompleted`; subscribe with `agent.on()` for custom monitoring — see [Observability](../features/observability)
