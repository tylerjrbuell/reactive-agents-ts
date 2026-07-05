# @reactive-agents/ui-core

> Headless core for Reactive Agents UI bindings — wire protocol, resumable stream client, run state machine, generative-UI tree, durable-rail controllers, and fixture testing.

[![npm](https://img.shields.io/npm/v/@reactive-agents/ui-core?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/ui-core)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

> **Stability: experimental.** The wire protocol is versioned (`PROTOCOL_VERSION`) and additive-only after v1, but signatures may still change in a minor release. Pin a version for production use.

**Effect-free. Dependency-free. Browser-safe.** This package is the framework-agnostic engine that the React, Vue, and Svelte bindings share. It holds *all* the protocol parsing, stream reconnection, state transitions, and durable-rail request logic — so a binding (`@reactive-agents/react`, `/vue`, `/svelte`) is a thin layer of reactivity glue, and a protocol fix lands in one place instead of three.

You usually consume `ui-core` **through** a framework binding. Reach for it directly when you are building a new binding, a non-React/Vue/Svelte integration, a server-side consumer, or testing.

## Install

```bash
bun add @reactive-agents/ui-core
# or: npm install @reactive-agents/ui-core
```

## What's in the box

| Area | Exports | Purpose |
|------|---------|---------|
| **Wire protocol** | `PROTOCOL_VERSION`, `UiStreamEvent`, `UiRunStatus`, `parseUiStreamEvent`, `isTerminalEvent`, `SeqStamped`, `PendingInteractionWire` | Versioned, additive-only SSE event contract between server endpoints and UI. Single source of truth. |
| **Stream client** | `connectRunStream`, `ConnectOptions`, `FetchLike` | Resumable SSE reader: cursor-based reconnect + exponential backoff. New-run (POST) or attach/reattach (GET) mode. |
| **Run state machine** | `initialRunState`, `reduceRunState`, `RunState`, `ReduceOptions` | Pure reducer folding the event stream into `{ status, text, output, object, cost, pendingInteraction, pendingApproval, ... }`. |
| **Generative UI** | `UiNode`, `isUiNode`, `uiTreeSchema`, `reconcileUiTree` | Safe, registry-constrained dynamic UI trees + progressive partial-tree merge. |
| **Inbox** | `InboxRun`, `fetchInbox` | Durable-run task-inbox fetch. |
| **Durable rails** | `InteractionResult`, `respondToInteraction`, `decideApproval` | Client → server POST for human-in-the-loop: answer a `request_user_input` interaction or approve/deny a gate; run resumes durably. |
| **Testing** (`/testing`) | `RunFixture`, `recordRunFixture`, `fixtureToSSE`, `mockAgentEndpoint` | Record a real agent run once, replay it in CI/Storybook/Playwright with zero tokens and zero network. |

## Drive a run in ~10 lines

`connectRunStream` yields typed events; `reduceRunState` folds them into UI state. This is exactly what every binding wraps.

```ts
import { connectRunStream, reduceRunState, initialRunState } from "@reactive-agents/ui-core";

let state = initialRunState();
for await (const event of connectRunStream({ endpoint: "/api/agent", body: { prompt: "Explain SSE" } })) {
  state = reduceRunState(state, event);
  render(state.text); // grows token-by-token; state.status → "completed" at the end
}
```

### Resume a run after a reload (cursor reattach)

```ts
// Reconnect to a durable run and replay only events after `cursor`.
for await (const event of connectRunStream({
  endpoint: "/api/agent",
  attach: { runId: "run_123", cursor: state.lastSeq },
})) {
  state = reduceRunState(state, event);
}
```

`connectRunStream` tracks the highest sequence seen; on a mid-stream network drop (in `attach` mode) it reconnects from `cursor = lastSeq` with exponential backoff up to `maxRetries`, so no event is lost or duplicated.

## Durable human-in-the-loop

When an agent calls `request_user_input` (or hits an approval gate), the run pauses durably and the stream carries a `pendingInteraction` / `pendingApproval`. Answer it from anywhere — the same page, a reload, or another device — and the run resumes from its checkpoint:

```ts
import { respondToInteraction, decideApproval } from "@reactive-agents/ui-core";

// answer a form/choice/confirmation the agent asked for
await respondToInteraction({
  endpoint: "/api/interaction",
  runId: state.pendingInteraction!.runId,
  interactionId: state.pendingInteraction!.interactionId,
  value: { choice: "ship it" },
});

// approve or deny a durable approval gate
await decideApproval({
  endpoint: "/api/approval",
  runId: state.pendingApproval!.runId,
  gateId: state.pendingApproval!.gateId,
  decision: "approve",
});
```

Both return an `InteractionResult { success, output, error? }` and **never throw** — a failed POST comes back as `{ success: false, error }`, so bindings render honest error states without a try/catch.

## Safe generative UI

`uiTreeSchema(registry)` builds a structured-output schema whose node `type` is an **enum over your registry's keys** — so a model can only emit component types you registered. Hallucinated components are *unrepresentable*, not merely rejected. No `eval`, no arbitrary markup.

```ts
import { uiTreeSchema, reconcileUiTree, type UiNode } from "@reactive-agents/ui-core";

const registry = { card: 1, table: 1, row: 1 };
const schema = uiTreeSchema(registry); // pass to .withOutputSchema(...) server-side

// progressively merge streamed partial trees into one tree:
let tree: UiNode | undefined;
tree = reconcileUiTree(tree, { type: "card", props: { title: "Sales" } });
tree = reconcileUiTree(tree, { type: "card", props: { body: "…streamed later" } });
// → { type: "card", props: { title: "Sales", body: "…streamed later" } }
```

`reconcileUiTree` merges partial → accumulated: partial fields win, `props` shallow-merge, `children` merge positionally and recursively, and a non-node partial leaves the tree untouched. It is progressive-append semantics (no child removal/reorder).

## Zero-token testing

Record a real run's event stream once, then replay the exact SSE bytes for any request — no provider, no network, no flake:

```ts
import { recordRunFixture, mockAgentEndpoint } from "@reactive-agents/ui-core/testing";

const fixture = await recordRunFixture(agentStream);      // capture once (dev)
const fetchImpl = mockAgentEndpoint(fixture);             // replay in tests

// inject into any binding or connectRunStream via its fetchImpl seam
for await (const e of connectRunStream({ endpoint: "/api/agent", body: { prompt: "hi" }, fetchImpl })) { /* … */ }
```

`FetchLike` is the injection seam used throughout (`connectRunStream`, `fetchInbox`, `respondToInteraction`, …) — a minimal `(input, init?) => Promise<Response>` that the global `fetch` satisfies, so mocks need no casting.

## Architecture

```
server (SSE) ──UiStreamEvent──▶ connectRunStream ──▶ reduceRunState ──▶ RunState
                                       ▲                                    │
                              cursor reconnect                      binding renders
                                                                            │
UI ──respondToInteraction / decideApproval / fetchInbox──▶ server (durable rails)
```

Dependency direction: `ui-core` depends on **nothing**; `@reactive-agents/{react,vue,svelte}` depend on `ui-core`. Never the reverse.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI-agent framework built on Effect-TS. See the [Web Integration guide](https://docs.reactiveagents.dev/guides/web-integration/), the [Agentic UI Core reference](https://docs.reactiveagents.dev/features/agentic-ui-core/), and the [full docs](https://docs.reactiveagents.dev).
