# @reactive-agents/compose

> Prebuilt killswitch compositions for reactive agents.

[![npm](https://img.shields.io/npm/v/@reactive-agents/compose?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/compose)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

A small library of ready-made **killswitches** — guard rails that abort or terminate a reactive-agent run when a budget, time, iteration, or progress limit is crossed. Each killswitch is a factory that returns a function applied to a `Harness`, hooking into its `before`/`after` phase taps. Useful for putting hard safety bounds on autonomous agents.

## Install
```bash
bun add @reactive-agents/compose
# or: npm install @reactive-agents/compose
```

## Usage

A killswitch is `(harness: Harness) => void` — it registers phase hooks that return `{ abort, reason }` when their limit is hit:

```ts
import { maxIterations, budgetLimit, timeoutAfter } from "@reactive-agents/compose";

// Each returns a function that wires hooks onto a Harness
const stopRunaway = maxIterations(10);                       // stop after 10 think loops
const capSpend    = budgetLimit({ maxTokens: 50_000 });      // stop when token budget exceeded
const deadline    = timeoutAfter({ wallClock: "60s" });      // stop after wall-clock limit

// Apply to a harness instance (Harness from @reactive-agents/core)
stopRunaway(harness);
capSpend(harness);
deadline(harness);
```

All killswitches accept `onTrigger: 'stop' | 'terminate'` (default `'stop'`) to choose between a graceful stop and a hard terminate.

## API

Killswitch factories (also exported from `@reactive-agents/compose/killswitches`):

- `budgetLimit({ maxTokens?, maxCostUSD?, costPerToken?, onTrigger? })` — abort when token/cost budget is exceeded.
- `maxIterations(max | { max, onTrigger? })` — abort after N reasoning iterations.
- `timeoutAfter({ wallClock, onTrigger? })` — abort after a wall-clock duration (`'60s'`, `'5m'`, or ms).
- `watchdog({ noProgressFor, onTrigger? })` — abort when no tool progress is made within a window.
- `requireApprovalFor({ tools, approver, onDeny? })` — abort when a guarded tool call is denied by the approver.
- `killswitches.list()` — the registry of available killswitch names.

Each factory has a matching options type (`BudgetLimitOptions`, `MaxIterationsOptions`, `TimeoutAfterOptions`, `WatchdogOptions`, `RequireApprovalForOptions`).

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [full documentation](https://docs.reactiveagents.dev).
