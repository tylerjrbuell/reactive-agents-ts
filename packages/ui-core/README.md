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
| **Turn steps** | `foldTurnTrace`, `turnStepsOf`, `buildTurnSteps`, `persistedTurnStepsOf`, `summarizeTurn`, `finishTurnTrace` | "What is my agent doing?": an action-first step list per turn (tools called, retries grouped, failures with reason and fix), narration and thinking kept apart, plus a one-line summary. |
| **Turn transcript** | `turnTranscriptOf`, `persistedTurnTranscriptOf`, `buildTurnTranscript` | The turn as a modern agent chat reads: prose between iterations, tool work collapsed into expandable groups, then the answer. |
| **Chat view models** | `toolBadgesOf`, `subAgentCardOf`, `subAgentRollup`, `argHint`, `goalSummaryOf`, `isImplicitRequirement`, `findSubAgentGroup`, `turnStrategiesOf`, `formatTurnDuration`, `shortToolName` | Compact pieces a chat renders: one badge per tool in a group (failures coloured, fixed ones marked), a background-agent card per sub-agent (status, tools, duration, cost, one activity line, goal status; never raw tool JSON), goal checks without the implicit answer floor, the strategies a turn reported, and `12s` / `2m 05s` durations. |
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

## Show what the agent is doing (turn steps)

Fold a `density: "full"` stream into a turn trace, then render its steps. Each step is titled by the action the agent took, not by its thinking:

```ts
import { connectRunStream, foldTurnTrace, initialTurnTrace, turnStepsOf, summarizeTurn } from "@reactive-agents/ui-core";

let trace = initialTurnTrace();
for await (const event of connectRunStream({ endpoint: "/api/agent", body: { prompt } })) {
  trace = foldTurnTrace(trace, event);
  const steps = turnStepsOf(trace);
  const summary = summarizeTurn(steps, { ended: trace.ended, context: trace.context });
  render(steps, summary.line); // "6 steps · 11 calls (7 tools) · 3 failed, 3 fixed · failed · context 7.5k / 8.2k"
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

```ts
import { foldTurnTrace, initialTurnTrace, turnTranscriptOf } from "@reactive-agents/ui-core";

let trace = initialTurnTrace();
for await (const event of connectRunStream({ endpoint: "/api/agent", body: { prompt } })) {
  trace = foldTurnTrace(trace, event);
  for (const seg of turnTranscriptOf(trace)) {
    if (seg.kind === "prose") renderMarkdown(seg.text);
    else if (seg.kind === "tools") renderCollapsedRow(seg.label, seg.tools, seg.failed > seg.fixed, () => renderSteps(seg.steps));
    else if (seg.kind === "answer") renderAnswer(seg.text, { streaming: !seg.final });
    else renderEnding(seg.outcome); // failed / partial / abstained / files only (see below)
  }
}
```

| Segment | Fields | Notes |
|---------|--------|-------|
| `prose` | `text`, `iteration`, `step` | The model's narration. Provider thinking never appears here. Prose that repeats earlier prose, equals the answer, or is contained in a long answer is dropped, so the answer never renders twice. |
| `tools` | `label`, `tools`, `calls`, `failed`, `fixed`, `running`, `durationMs`, `steps` | Consecutive tool work with no prose between. `label` is `Ran 3 tools · 1 failed, 1 fixed`, or `Running get_website_stats` while a call runs. Expand a group into its `steps` (the `TurnStep` rows above: thinking, failure reasons, call detail). |
| `answer` | `text`, `final` | `final: false` is the live preview: text still streaming may yet turn into narration before a tool call, so render it muted. For a partial run, `text` is the model's draft without its `Unfinished:` list. |
| `ending` | `outcome` | Closes the turn when the run did not simply succeed (partial, failed, abstained, paused), or succeeded with no answer text but produced files. See "How a turn ended" below. |

It is live-safe (call it on every event) and works after a reload: `persistedTurnTranscriptOf(stored, answer)`. A stored trace with no narration reads as one tool group plus the answer. With your own steps, call `buildTurnTranscript(steps, { answer, pending, outcome })`.

### How a turn ended

The framework never writes harness text into `output`. A failed or abstained run completes with `output: ""` and its cause on `error`. A partial run ships the model's draft followed by an `Unfinished:` list. A run whose answer is a file can succeed with `output: ""`; the files are on `receipt.deliverables`. Read the ending from those fields with `turnOutcomeOf` (it takes a `StreamCompleted`, an `AgentResult` or an `AgentCompleted` payload); the fold stores it as `trace.ended` / `trace.outcome`, `finishTurnTrace` persists it, and `RunState.outcome` / `RunState.error` carry it in the run machine:

| `outcome.ending` | Show | Fields |
|---|---|---|
| `succeeded` | The answer. If `output` is empty, the produced files. | `deliverables` |
| `partial` | The draft, then what was left unfinished. | `draft`, `unfinished`, `error` |
| `failed` | The cause, not `output`. | `error`, `terminatedBy` |
| `abstained` | A decline with its reason, not an error. | `abstention.reason`, `abstention.missing`, `error` |
| `paused` | Waiting on an approval or a user answer. | |

`summarizeTurn` prints the same ending in its line (`… · abstained`). `TranscriptSegment` gained the `ending` kind: code that narrows on `kind` exhaustively must handle it.

### Compact pieces: tool badges, sub-agent cards, goal checks

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
const goals = goalSummaryOf(trace.checklist.root, { ended: true }); // { show, label: "Goals 3/4", status }

// What the run reported (never inferred from config).
turnStrategiesOf(trace, (t) => Object.values(t.subAgents).map((b) => b.trace)); // { main: "reactive", delegated: ["reflexion"] }
formatTurnDuration(trace.durationMs ?? 0); // "2m 05s"
```

The fold records `trace.strategy` (`StreamCompleted.metadata.strategyUsed`) and `trace.durationMs` (`metadata.duration`); `finishTurnTrace` persists both, so a plain answer now persists a small trace too.

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
