# @reactive-agents/react

> React hooks + components for Reactive Agents agentic UI — runs, durable interactions, inbox, generative UI, devtools.

[![npm](https://img.shields.io/npm/v/@reactive-agents/react?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/react)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

> **Stability: experimental.** The wire contract is versioned and additive-only, but signatures may change in a minor release. Pin a version for production use.

React bindings for AI agents, built on the headless [`@reactive-agents/ui-core`](https://www.npmjs.com/package/@reactive-agents/ui-core) engine — so streams are **resumable**, human-in-the-loop is **durable** (survives reloads), and generative UI is **registry-safe**. All hooks are thin reactivity wrappers over `ui-core`; the protocol, reconnect, and state logic live there.

## Install

```bash
bun add @reactive-agents/react
# or: npm install @reactive-agents/react
```

## Quick start

Server (Next.js App Router):

```ts
// app/api/agent/route.ts
import { ReactiveAgents, AgentStream } from "reactive-agents";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const agent = await ReactiveAgents.create().withProvider("anthropic").withTools().build();
  return AgentStream.toSSE(agent.runStream(prompt));
}
```

Client:

```tsx
import { useRun } from "@reactive-agents/react";

function Chat() {
  const { state, run } = useRun({ endpoint: "/api/agent" });
  return (
    <div>
      <button onClick={() => run("Explain quantum entanglement")}>Ask</button>
      <p style={{ whiteSpace: "pre-wrap" }}>{state.text}</p>
      {state.status === "streaming" && <span>●</span>}
      {state.error && <p style={{ color: "red" }}>{state.error}</p>}
    </div>
  );
}
```

## Hooks

| Hook | Purpose |
|------|---------|
| `useRun({ endpoint, objectMode?, auto?, attach? })` | Core run hook — returns `{ state, run, cancel, reattach }`. `state` is `ui-core`'s `RunState` (`status`, `text`, `output`, `object`, `cost`, `pendingInteraction`, `pendingApproval`, …). |
| `useResumableRun({ endpoint, runId, cursor? })` | Reattach to a durable run on mount and replay from a cursor (survives reloads). |
| `useInteractions({ interactionEndpoint })` | `respond(runId, interactionId, value)` for durable `request_user_input` — returns `{ respond, pending, error }`. |
| `useTaskInbox({ endpoint, pollMs? })` | Poll the durable-run inbox — `{ runs, loading, error, refresh }`. |
| `useRunCost` / `useRunSteps` | Live cost and tool/step trace derived from the run stream. |
| `useAgentStream` / `useAgent` | Streaming and one-shot classics (now rewired onto `useRun`). |

## Components

Headless-first (unstyled primitives with `data-*` attributes + render-prop/callback escape hatches); an optional styled reference layer ships from `@reactive-agents/react/styles`.

| Component | Purpose |
|-----------|---------|
| `AgentPrompt`, `ChoiceCard`, `ApprovalGate` | Render a durable interaction / approval and answer it. |
| `TaskInbox` | Email-like list of async agent jobs. |
| `CostMeter`, `StepTimeline` | Live cost + tool/step trace. |
| `AgentSurface` (+ `uiTreeSchema`, `ComponentRegistry`) | Safe generative UI — renders a registry-constrained node tree; hallucinated components are unrepresentable. |
| `AgentDevtools` | Floating dev overlay: runs, live event stream, cost burn, replay. |

## Testing

Record a real run once, replay it in CI with zero tokens (via `@reactive-agents/ui-core/testing`):

```tsx
import { mockAgentEndpoint, recordRunFixture } from "@reactive-agents/ui-core/testing";

const fixture = await recordRunFixture(agentStream);
// pass mockAgentEndpoint(fixture) as the fetchImpl to any hook
```

## Part of Reactive Agents

Part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI-agent framework on Effect-TS. See the [Web Integration guide](https://docs.reactiveagents.dev/guides/web-integration/), the [Agentic UI Core reference](https://docs.reactiveagents.dev/features/agentic-ui-core/), and the [full docs](https://docs.reactiveagents.dev).
