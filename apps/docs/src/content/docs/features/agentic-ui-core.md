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
topic: web-ui
related:
  - guides/web-integration
  - cookbook/nextjs-ai-agent
  - features/streaming
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
| Turn steps | `initialTurnTrace`, `foldTurnTrace`, `turnStepsOf`, `buildTurnSteps`, `persistedTurnStepsOf`, `summarizeTurn`, `finishTurnTrace` |
| Turn transcript | `turnTranscriptOf`, `persistedTurnTranscriptOf`, `buildTurnTranscript`, `turnOutcomeOf` |
| Chat view models | `toolBadgesOf`, `subAgentCardOf`, `subAgentRollup`, `goalSummaryOf`, `turnStrategiesOf`, `formatTurnDuration`, `argHint`, `shortToolName`, `isImplicitRequirement`, `findSubAgentGroup` |
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

## Show what the agent is doing (turn steps)

Fold a `density: "full"` stream into a turn trace, then render its steps. Each step is titled by the action the agent took, not by its thinking:

<!-- docs-skip-typecheck -->
```ts
import { connectRunStream, foldTurnTrace, initialTurnTrace, turnStepsOf, summarizeTurn } from "@reactive-agents/ui-core";

let trace = initialTurnTrace();
for await (const event of connectRunStream({ endpoint: "/api/agent", body: { prompt } })) {
  trace = foldTurnTrace(trace, event);
  const steps = turnStepsOf(trace);
  const summary = summarizeTurn(steps, { ended: trace.ended, context: trace.context });
  render(steps, summary.line); // "6 steps · 11 calls (8 tools) · 3 failed, 3 fixed · failed · context 7.5k / 8.2k"
}
```

Each `TurnStep` gives you:

| Field | Use it for |
|-------|-----------|
| `label` | The row title: `get_website_metrics ×4 · 3 failed → ok`, or `No tool call`. |
| `actions` | Calls grouped per tool (`calls`, `failed`, `recovered`). Retries of a failing tool fold into the step where it first failed. |
| `narration` | The model's own prose for the step. Dropped when it repeats this step's thinking, the final answer, or an earlier step (then `sameAsStep` names that step). |
| `thinking` | The provider's reasoning (thinking models). Show it collapsed; it is never the title. |
| `failures` | Each failed call's `reason` (first line, wrapping removed) and `fixedBy` (the later call that succeeded, and its step). |
| `status` | `running`, `done`, or `failed` (a failure no later call fixed). |

To persist a turn, store `finishTurnTrace(trace)`; after a reload rebuild the same steps with `persistedTurnStepsOf(stored, answer)`. With your own data, call `buildTurnSteps({ iterations, calls, answer })`.

## Render a turn like a modern agent chat (turn transcript)

Steps answer "what did my agent do?". A chat wants the turn to read as the agent *talking*: its prose between iterations as message text, the tool work in between collapsed to one line ("Ran 4 tools · 1 failed"), and the answer last. `turnTranscriptOf` projects the same fold into that reading order:

<!-- docs-skip-typecheck -->
```ts
import { connectRunStream, foldTurnTrace, initialTurnTrace, turnTranscriptOf } from "@reactive-agents/ui-core";

let trace = initialTurnTrace();
for await (const event of connectRunStream({ endpoint: "/api/agent", body: { prompt } })) {
  trace = foldTurnTrace(trace, event);
  for (const seg of turnTranscriptOf(trace)) {
    if (seg.kind === "prose") renderMarkdown(seg.text);
    else if (seg.kind === "tools") renderCollapsedRow(seg.label, seg.tools, seg.failed > seg.fixed, () => renderSteps(seg.steps));
    else if (seg.kind === "answer") renderAnswer(seg.text, { streaming: !seg.final });
    else renderEnding(seg.outcome); // failed / partial / abstained / interrupted / files only (see below)
  }
}
```

| Segment | Fields | Notes |
|---------|--------|-------|
| `prose` | `text`, `iteration`, `step` | The model's narration. Provider thinking never appears here. Prose that repeats earlier prose, equals the answer, or is contained in a long answer is dropped, so the answer never renders twice. |
| `tools` | `label`, `tools`, `calls`, `failed`, `fixed`, `running`, `durationMs`, `steps` | Consecutive tool work with no prose between. `label` is `Ran 3 tools · 1 failed, 1 fixed`, or `Running get_website_stats` while a call runs. Expand a group into its `steps` (the `TurnStep` rows above: thinking, failure reasons, call detail). |
| `answer` | `text`, `final` | `final: false` is the live preview: text still streaming may yet turn into narration before a tool call, so render it muted. For a partial run, `text` is the model's draft without its `Unfinished:` list. |
| `ending` | `outcome` | Closes the turn when the run did not simply succeed (partial, failed, abstained, paused, interrupted), or succeeded with no answer text but produced files. See "How a turn ended" below. |

It is live-safe (call it on every event) and works after a reload: `persistedTurnTranscriptOf(stored, answer)`. A stored trace with no narration reads as one tool group plus the answer. With your own steps, call `buildTurnTranscript(steps, { answer, pending, outcome })`.

`TranscriptSegment` has four kinds (`prose`, `tools`, `answer`, `ending`); code that narrows on `kind` exhaustively must handle `ending`.

### How a turn ended

The framework never writes harness text into `output`. A failed or abstained run completes with `output: ""` and its cause on `error`. A partial run ships the model's draft followed by an `Unfinished:` list. A run whose answer is a file can succeed with `output: ""`; the files are on `receipt.deliverables`. Read the ending from those fields with `turnOutcomeOf` (it takes a `StreamCompleted`, an `AgentResult` or an `AgentCompleted` payload). The fold stores it as `trace.ended` / `trace.outcome`, `finishTurnTrace` persists it, and `RunState.outcome` / `RunState.error` carry it in the run machine:

| `outcome.ending` | Show | Fields |
|---|---|---|
| `succeeded` | The answer. If `output` is empty, the produced files. | `deliverables` |
| `partial` | The draft, then what was left unfinished. A run the user stopped is also `partial`, with `interruptedBy: "user"`. | `draft`, `unfinished`, `error`, `interruptedBy`, `userInterrupt` |
| `failed` | The cause, not `output`. | `error`, `terminatedBy` |
| `abstained` | A decline with its reason, not an error. | `abstention.reason`, `abstention.missing`, `error` |
| `paused` | Waiting on an approval or a user answer. | |
| `interrupted` | The turn was stopped before its run completed (the user stopped it, or the connection closed). | `interruptedBy` (`"user"` or `"disconnect"`), `userInterrupt`, `error` |

`summarizeTurn` prints the same ending in its line (`… · abstained`).

### Compact pieces: tool badges, sub-agent cards, goal checks

<!-- docs-skip-typecheck -->
```ts
import { toolBadgesOf, subAgentCardOf, subAgentRollup, goalSummaryOf, turnStrategiesOf, formatTurnDuration } from "@reactive-agents/ui-core";

// A tool group as badges: `web-search ×3`, a red `fetch` for an unfixed failure, `+2` overflow.
const { badges, overflow, unfixed } = toolBadgesOf(group.steps, { max: 4 });

// One card per sub-agent; the detail (its own transcript) belongs in a drill-in panel.
const cards = Object.values(trace.subAgents).map((b) =>
  subAgentCardOf({ name: b.run.name, status: b.status, ending: b.trace.outcome?.ending, startedAt: b.startedAt, endedAt: b.endedAt, costUsd: b.costUsd, calls: b.trace.calls, output: b.output }, Date.now()),
);
subAgentRollup(cards).label; // "4 agents · 2 running"

// Goal checks without the floor every run has ("produce a substantive answer…"): `show` is false
// when only that implicit row exists and it did not fail.
const goals = goalSummaryOf(trace.checklist!.root, { ended: true }); // { show, label: "Goals 3/4", status }

// What the run reported (never inferred from config).
turnStrategiesOf(trace, (t) => Object.values(t.subAgents).map((b) => b.trace)); // { main: "reactive", delegated: ["reflexion"] }
formatTurnDuration(trace.durationMs ?? 0); // "2m 05s"
```

The fold records `trace.strategy` (`StreamCompleted.metadata.strategyUsed`) and `trace.durationMs` (`metadata.duration`); `finishTurnTrace` persists both, so a plain answer persists a small trace too. `argHint`, `shortToolName`, `isImplicitRequirement` and `findSubAgentGroup` are the smaller helpers these use.

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

## What's Next

- [Web Integration](/guides/web-integration/) — React, Vue, and Svelte bindings built on this engine
- [Streaming](/features/streaming/) — the token-delivery layer `ui-core`'s stream client consumes
- [Durable Human-in-the-Loop](/guides/durable-hitl/) — the server-side approval rails this package's client half drives
