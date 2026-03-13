---
name: a2a-specialized-agents
description: Build specialized multi-agent systems using A2A servers, local agent-tools, and remote-agent delegation.
compatibility: Reactive Agents projects using .withA2A(), .withAgentTool(), and .withRemoteAgent().
metadata:
  author: reactive-agents
  version: "1.0"
---

# A2A Specialized Agents

Use this skill when building coordinator/specialist agent architectures in the Reactive Agents framework.

## Agent objective

When implementing delegated-agent systems, generate code that:

- Separates coordinator responsibilities from specialist responsibilities.
- Keeps delegation contracts explicit and minimal.
- Preserves observability across parent and delegated execution paths.

## What this skill does

- Configures A2A endpoints for inter-agent task handoff.
- Registers specialist agents as callable tools from a coordinator.
- Defines safe delegation boundaries with schema validation and timeouts.

## Accurate builder patterns

```ts
const coordinator = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("anthropic")
  .withTools()
  .withA2A({ port: 8000, basePath: "/api/agents" })
  .withAgentTool("research-delegate", {
    name: "researcher",
    description: "Delegates deep research tasks",
  })
  .build();
```

## Use cases

- Research + synthesis pipelines with specialist sub-agents.
- Ops coordinators delegating to repo, docs, or messaging agents.
- Cross-runtime collaboration via remote A2A endpoints.

## Expected implementation output

- A clear separation between a "coordinator" agent and one or more "specialist" agents.
- The coordinator uses `.withAgentTool()` to register the specialist.
- The specialist has a focused persona and a limited set of tools.
- The coordinator's prompt includes instructions on when to delegate.

## Code Examples

### Local Agent-as-Tool

This pattern is for agents running in the same process. A "coordinator" agent can use another agent as a tool, delegating specific sub-tasks to it.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

// 1. Build a specialist agent with a focused role
const researcher = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("test") // Use a real provider in production
  .withTestResponses({
    "quantum": "Based on my research, quantum computing uses qubits which can exist in superposition, enabling parallel computation of multiple states simultaneously.",
  })
  .build();

// 2. Build a coordinator that uses the specialist as a tool
const coordinator = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("test")
  .withTools()
  // Register the local agent as a callable tool
  .withAgentTool("research-delegate", {
    name: "researcher",
    description: "Delegates research tasks to a specialist researcher agent",
    // Pass the agent instance directly
    agent: researcher,
  })
  .build();

// 3. Run the coordinator, which can now delegate to the researcher
const result = await coordinator.run("Explain quantum computing in simple terms");

console.log(result.output);
// Expected: A summary that incorporates the researcher's findings.
```

### Remote Agent Delegation (A2A)

For agents running in separate processes or on different machines, you can use the A2A (Agent-to-Agent) protocol.

**Specialist Agent (Server):**
```typescript
// specialist-server.ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const specialist = await ReactiveAgents.create()
  .withName("remote-researcher")
  .withProvider("anthropic")
  .withSystemPrompt("You are a world-class researcher. Provide concise, factual answers.")
  // Expose this agent via an HTTP server
  .withA2A({ port: 8081, basePath: "/api" })
  .build();

console.log("Remote researcher is listening on port 8081...");
// The agent will now handle requests at http://localhost:8081/api/remote-researcher
```

**Coordinator Agent (Client):**
```typescript
// coordinator-client.ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const coordinator = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("anthropic")
  .withTools()
  // Register the remote agent by name and URL
  .withRemoteAgent("remote-research-delegate", "http://localhost:8081/api/remote-researcher")
  .build();

const result = await coordinator.run("Use the remote delegate to explain quantum computing.");
console.log(result.output);
```

## Pitfalls to avoid

- Delegating without strict tool input/output contracts.
- Missing timeout/cancellation handling for remote delegation.
- No observability correlation between coordinator and specialist runs.
