# @reactive-agents/react

> React hooks and components that stream a Reactive Agents run into your UI, with durable human-in-the-loop, an inbox and registry-safe generative UI.

[![npm](https://img.shields.io/npm/v/@reactive-agents/react?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/react)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/guides/web-integration/)

> **Stability:** unstable. The wire contract is versioned and additive-only, but hook and component signatures may change in a minor release. Pin a version.

## Install

```bash
bun add @reactive-agents/react
# or: npm install @reactive-agents/react
```

## Usage

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

All hooks are thin wrappers over [`@reactive-agents/ui-core`](https://www.npmjs.com/package/@reactive-agents/ui-core), which owns the protocol, reconnect and state logic.

## API

| Export | Use it when |
|---|---|
| `useRun({ endpoint, objectMode?, auto?, attach? })` | You need the core run hook. Returns `{ state, run, cancel, reattach }`. |
| `useResumableRun({ endpoint, runId, cursor? })` | A durable run must reattach and replay after a reload. |
| `useInteractions({ interactionEndpoint })` | You answer a durable `request_user_input`. |
| `useTaskInbox({ endpoint, pollMs? })` | You list durable runs as an inbox. |
| `useRunCost`, `useRunSteps` | You show live cost or the tool and step trace. |
| `useAgentStream`, `useAgent` | You want the streaming or one-shot classics. |
| `AgentPrompt`, `ChoiceCard`, `ApprovalGate` | You render a durable interaction or approval. |
| `TaskInbox`, `CostMeter`, `StepTimeline` | You want headless inbox, cost and trace components. |
| `AgentSurface`, `uiTreeSchema`, `ComponentRegistry` | You render model-generated UI from a registry of allowed components. |
| `AgentDevtools` | You want a dev overlay with runs, events and cost. |

Components are headless-first (`data-*` attributes and render props). A styled reference layer ships from `@reactive-agents/react/styles`. For zero-token tests, record and replay runs with `@reactive-agents/ui-core/testing`.

## Documentation

- [Web integration guide](https://docs.reactiveagents.dev/guides/web-integration/)
- [Agentic UI core](https://docs.reactiveagents.dev/features/agentic-ui-core/)

## Runtime

React 18 or newer in the browser. Server code that builds the agent needs Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
