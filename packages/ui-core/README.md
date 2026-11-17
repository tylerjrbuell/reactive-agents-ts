# @reactive-agents/ui-core

> Framework-agnostic core for Reactive Agents UIs: wire protocol, resumable stream client, run state machine, turn view models and zero-token test fixtures.

[![npm](https://img.shields.io/npm/v/@reactive-agents/ui-core?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/ui-core)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/features/agentic-ui-core/)

> **Stability:** unstable. The wire protocol is versioned (`PROTOCOL_VERSION`) and additive-only after v1, but function signatures may change in a minor release. Pin a version.

Effect-free, dependency-free and browser-safe. `@reactive-agents/react`, `vue` and `svelte` are thin reactivity layers over this package. Use it directly to build a new binding, a non-React/Vue/Svelte integration, a server-side consumer or tests.

## Install

```bash
bun add @reactive-agents/ui-core
# or: npm install @reactive-agents/ui-core
```

## Usage

`connectRunStream` yields typed events and `reduceRunState` folds them into UI state. Every binding wraps this loop.

```ts
import { connectRunStream, reduceRunState, initialRunState } from "@reactive-agents/ui-core";

let state = initialRunState();
for await (const event of connectRunStream({ endpoint: "/api/agent", body: { prompt: "Explain SSE" } })) {
  state = reduceRunState(state, event);
  console.log(state.text); // grows token by token; state.status is "completed" at the end
}
```

Resume a durable run after a reload. `connectRunStream` reconnects from the last sequence it saw, with exponential backoff:

```ts
import { connectRunStream, reduceRunState, initialRunState } from "@reactive-agents/ui-core";

let state = initialRunState();
for await (const event of connectRunStream({
  endpoint: "/api/agent",
  attach: { runId: "run_123", cursor: state.lastSeq },
})) {
  state = reduceRunState(state, event);
}
```

Answer a durable human-in-the-loop request. Both calls return `{ success, output, error? }` and never throw:

```ts
import { respondToInteraction, decideApproval, initialRunState } from "@reactive-agents/ui-core";

const state = initialRunState(); // in an app, the state your reducer loop maintains
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
  decision: "approve",
});
```

Replay a recorded run in tests with no provider and no network:

```ts
import { connectRunStream } from "@reactive-agents/ui-core";
import { recordRunFixture, mockAgentEndpoint } from "@reactive-agents/ui-core/testing";

const agentStream = connectRunStream({ endpoint: "/api/agent", body: { prompt: "Explain SSE" } });
const fixture = await recordRunFixture(agentStream); // capture once
const fetchImpl = mockAgentEndpoint(fixture);        // pass to connectRunStream or any binding
```

## API

| Area | Exports | Use it when |
|---|---|---|
| Wire protocol | `PROTOCOL_VERSION`, `UiStreamEvent`, `parseUiStreamEvent`, `isTerminalEvent` | You read or validate the SSE event contract. |
| Stream client | `connectRunStream`, `ConnectOptions`, `FetchLike` | You open a new run (POST) or reattach (GET) with cursor reconnect. |
| Run state | `initialRunState`, `reduceRunState`, `RunState` | You fold events into `{ status, text, output, object, cost, pendingInteraction, pendingApproval, ... }`. |
| Turn steps | `foldTurnTrace`, `turnStepsOf`, `summarizeTurn`, `finishTurnTrace`, `persistedTurnStepsOf` | You show what the agent is doing: an action-first step list per turn. |
| Turn transcript | `turnTranscriptOf`, `persistedTurnTranscriptOf`, `turnOutcomeOf` | You render a turn as prose, collapsed tool groups, the answer and an ending (failed, partial, abstained, paused). |
| Chat view models | `toolBadgesOf`, `subAgentCardOf`, `subAgentRollup`, `goalSummaryOf`, `turnStrategiesOf` | You render badges, sub-agent cards and goal checks. |
| Display helpers | `formatCost`, `formatTokens`, `formatTurnDuration`, `statusOfRun`, `statusOfTurn` | You format cost, time and the shared status vocabulary. |
| Generative UI | `uiTreeSchema`, `reconcileUiTree`, `isUiNode`, `UiNode` | You let a model emit only registered components and merge partial trees. |
| Durable rails | `respondToInteraction`, `decideApproval`, `fetchInbox` | You answer an interaction, decide an approval or list the inbox. |
| Testing (`/testing`) | `recordRunFixture`, `fixtureToSSE`, `mockAgentEndpoint` | You replay runs in CI, Storybook or Playwright. |

`FetchLike` is the injection seam for every network call. The global `fetch` satisfies it, so mocks need no casts. The framework never writes harness text into `output`: a failed or abstained run completes with `output: ""` and its cause on `error`; read the ending with `turnOutcomeOf`.

## Documentation

- [Agentic UI core](https://docs.reactiveagents.dev/features/agentic-ui-core/)
- [Web integration guide](https://docs.reactiveagents.dev/guides/web-integration/)

## Runtime

Runs in the browser, Bun >= 1.1.0 (recommended) or Node.js 22.5+. No runtime dependencies.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
