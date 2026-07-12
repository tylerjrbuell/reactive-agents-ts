---
title: Agentic UI Core
stability: experimental
description: >-
  The headless, framework-agnostic engine behind the React, Vue, and Svelte
  bindings — versioned wire protocol, resumable stream client, run state
  machine, safe generative UI, durable human-in-the-loop rails, and zero-token
  fixture testing.
sidebar:
  order: 15
---

`@reactive-agents/ui-core` is the **headless core** every Reactive Agents web binding shares. It is Effect-free, dependency-free, and browser-safe: it holds *all* the protocol parsing, stream reconnection, state transitions, and durable-rail request logic, so `@reactive-agents/react`, `/vue`, and `/svelte` are thin reactivity glue and a protocol fix lands in **one** place instead of three.

You normally consume it **through** a framework binding. Use it directly when building a new binding, a non-React/Vue/Svelte integration, a server-side consumer, or tests.

> **Positioning.** Everyone else ships "add AI chat" — a synchronous stream that dies with the page. `ui-core` exposes the layers underneath that decide whether an agent feature ships to production: **resumable** streams, **durable** human-in-the-loop, **safe** generative UI, and **zero-token** testing.

## Install

```bash
bun add @reactive-agents/ui-core
```

## The surface

| Area | Exports |
|------|---------|
| Wire protocol | `PROTOCOL_VERSION`, `UiStreamEvent`, `UiRunStatus`, `parseUiStreamEvent`, `isTerminalEvent`, `SeqStamped`, `PendingInteractionWire` |
| Stream client | `connectRunStream`, `ConnectOptions`, `FetchLike` |
| Run state machine | `initialRunState`, `reduceRunState`, `RunState`, `ReduceOptions` |
| Generative UI | `UiNode`, `isUiNode`, `uiTreeSchema`, `reconcileUiTree` |
| Inbox | `InboxRun`, `fetchInbox` |
| Durable rails | `InteractionResult`, `respondToInteraction`, `decideApproval` |
| Testing (`/testing`) | `RunFixture`, `recordRunFixture`, `fixtureToSSE`, `mockAgentEndpoint` |

## Wire protocol

A versioned, additive-only SSE event contract. Every event has a `_tag`; base tags mirror the server's `AgentStreamEvent`, and this kit adds durable/observability tags (`RunAttached`, `InteractionRequested`, `ApprovalRequested`, `RunPaused`, `CostDelta`, `Abstained`, `LimitExceeded`, plus reserved-for-v2 `UiTreeDelta`/`TrustEvent`/`StepEvent`).

```ts
import { parseUiStreamEvent, isTerminalEvent } from "@reactive-agents/ui-core";

const event = parseUiStreamEvent('{"_tag":"TextDelta","text":"hi"}'); // typed UiStreamEvent | null
isTerminalEvent(event!); // false — true for StreamCompleted/Error/Cancelled/LimitExceeded
```

## Driving a run

`connectRunStream` yields typed, sequence-stamped events; `reduceRunState` folds them into UI state. This pair is what every binding wraps.

```ts
import { connectRunStream, reduceRunState, initialRunState } from "@reactive-agents/ui-core";

let state = initialRunState();
for await (const event of connectRunStream({ endpoint: "/api/agent", body: { prompt: "Explain SSE" } })) {
  state = reduceRunState(state, event);
  // state.text grows token-by-token; state.status → "completed" | "awaiting-interaction" | "error" | …
}
```

`RunState` carries `{ status, runId, text, output, object, events, pendingInteraction, pendingApproval, abstention, cost, error, lastSeq }`. Pass `{ objectMode: true }` to `reduceRunState` to derive a partial object from streamed JSON via `parsePartialObject`.

### Resumable streams

Streams survive a page reload, tab close, or server restart. `connectRunStream` tracks the highest sequence number seen; in `attach` mode a mid-stream drop reconnects from `cursor = lastSeq` with exponential backoff up to `maxRetries` — no event lost or duplicated.

<!-- docs-skip-typecheck -->
```ts
for await (const event of connectRunStream({
  endpoint: "/api/agent",
  attach: { runId: "run_123", cursor: state.lastSeq }, // GET reattach + durable replay
})) {
  state = reduceRunState(state, event);
}
```

## Durable human-in-the-loop

When an agent calls `request_user_input` or hits an approval gate (see [Durable Human-in-the-Loop](/guides/durable-hitl/)), the run pauses **durably** and the stream carries a `pendingInteraction` / `pendingApproval`. Answer it from the same page, after a reload, or from another device — the run resumes from its checkpoint.

```ts
import { respondToInteraction, decideApproval } from "@reactive-agents/ui-core";

await respondToInteraction({
  endpoint: "/api/interaction",
  runId: state.pendingInteraction!.runId,
  interactionId: state.pendingInteraction!.interactionId,
  value: { choice: "ship it" },
});

await decideApproval({
  endpoint: "/api/approval",
  runId: state.pendingApproval!.runId,
  gateId: state.pendingApproval!.gateId,
  decision: "approve", // or "deny" with an optional reason
});
```

Both return `InteractionResult { success, output, error? }` and **never throw** — a failed POST returns `{ success: false, error }`, so bindings render honest error states without a try/catch.

## Safe generative UI

`uiTreeSchema(registry)` builds a structured-output schema whose node `type` is an **enum over your registry keys** — a model can only emit component types you registered. Hallucinated components are *unrepresentable*, not merely rejected. No `eval`, no arbitrary markup.

```ts
import { uiTreeSchema, reconcileUiTree, type UiNode } from "@reactive-agents/ui-core";

const registry = { card: 1, table: 1, row: 1 };
const schema = uiTreeSchema(registry); // → .withOutputSchema(schema) server-side

let tree: UiNode | undefined;
tree = reconcileUiTree(tree, { type: "card", props: { title: "Sales" } });
tree = reconcileUiTree(tree, { type: "card", props: { body: "…streamed later" } });
// → { type: "card", props: { title: "Sales", body: "…streamed later" } }
```

`reconcileUiTree` merges partial → accumulated: partial fields win, `props` shallow-merge, `children` merge positionally + recursively, a non-node partial leaves the tree untouched. Progressive-append semantics (no child removal/reorder).

## Async task inbox

`fetchInbox` pulls the durable-run inbox for the resolved identity — agent jobs that run detached, email-like.

```ts
import { fetchInbox } from "@reactive-agents/ui-core";
const runs = await fetchInbox({ endpoint: "/api/inbox" }); // InboxRun[] — throws on non-ok
```

## Zero-token testing

Record a real run's event stream once, then replay the exact SSE bytes for any request — no provider, no network, no flake — in Vitest/Playwright/Storybook.

<!-- docs-skip-typecheck -->
```ts
import { recordRunFixture, mockAgentEndpoint } from "@reactive-agents/ui-core/testing";

const fixture = await recordRunFixture(agentStream); // capture once
const fetchImpl = mockAgentEndpoint(fixture);        // replay everywhere

for await (const e of connectRunStream({ endpoint: "/api/agent", body: { prompt: "hi" }, fetchImpl })) { /* … */ }
```

`FetchLike` — the `(input, init?) => Promise<Response>` seam used across `connectRunStream`, `fetchInbox`, `respondToInteraction`, and friends — is what makes this injection cast-free (the global `fetch` satisfies it).

## Architecture

Dependency direction: `ui-core` depends on **nothing**; the framework bindings depend on `ui-core`; never the reverse. See the [Web Integration guide](/guides/web-integration/) to wire it into a Next.js / SvelteKit / Nuxt app, and [Durable Human-in-the-Loop](/guides/durable-hitl/) for the server-side pause/resume rails.
