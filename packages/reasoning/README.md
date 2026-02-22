# @reactive-agents/reasoning

Reasoning strategies for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Adds structured thinking to agents via ReAct, Plan-Execute, Tree-of-Thought, and Reflexion strategies.

## Installation

```bash
bun add @reactive-agents/reasoning effect
```

## Strategies

| Strategy | Description | LLM Calls | Best For |
|----------|-------------|-----------|----------|
| `reactive` | ReAct: Think → Act → Observe loop | 1/iteration | Tool-using agents |
| `plan-execute-reflect` | Plan all steps, then execute | 2+ | Multi-step tasks |
| `tree-of-thought` | Explore multiple branches | 3× breadth/depth | Complex reasoning |
| `reflexion` | Generate → Critique → Improve loop | 3/retry | Quality-critical output |
| `adaptive` | Analyze task → auto-select best strategy | 1 + delegated | Mixed workloads |

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()  // defaults to ReAct
  .build();

const result = await agent.run("Analyze the trade-offs between TCP and UDP");
```

## ReAct Strategy

The default. A Thought → Action → Observation loop:

```
Thought: I need to find information about X
ACTION: web_search({"query": "X"})
Observation: [actual search results from the registered tool]
Thought: Based on the results, I can conclude...
FINAL ANSWER: [conclusion]
```

When `ToolService` is present (via `.withTools()` on the agent builder), ACTION calls execute real registered tools and return real results as observations. Tool arguments must be valid JSON. If a plain string is provided, it is mapped to the first required parameter of the tool definition.

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()      // ReAct strategy
  .withTools()          // built-in tools available during reasoning
  .build();

const result = await agent.run("What are the latest AI developments?");
// The ReAct loop will call web_search with real args and use the result
```

When ToolService is absent, a clear descriptive message is returned as the observation instead — the agent degrades gracefully without crashing.

## Reflexion Strategy

A Generate → Self-Critique → Improve loop based on the [Reflexion paper](https://arxiv.org/abs/2303.11366):

```
[ATTEMPT 1] Initial response...
[CRITIQUE 1] The response is missing X and Y. The explanation of Z is inaccurate.
[ATTEMPT 2] Improved response addressing X, Y, and correcting Z...
[CRITIQUE 2] SATISFIED: The response is now accurate and complete.
```

Use Reflexion when output quality matters more than latency:

```typescript
import { executeReflexion } from "@reactive-agents/reasoning";
import { Effect } from "effect";

const result = await Effect.runPromise(
  executeReflexion({
    taskDescription: "Write a concise technical explanation of RAFT consensus.",
    taskType: "explanation",
    memoryContext: "",
    availableTools: [],
    config: {
      defaultStrategy: "reflexion",
      adaptive: { enabled: false, learning: false },
      strategies: {
        reactive: { maxIterations: 10, temperature: 0.7 },
        planExecute: { maxRefinements: 2, reflectionDepth: "deep" },
        treeOfThought: { breadth: 3, depth: 3, pruningThreshold: 0.5 },
        reflexion: {
          maxRetries: 3,             // Max critique-improve cycles
          selfCritiqueDepth: "deep", // "shallow" | "deep"
        },
      },
    },
  }).pipe(Effect.provide(llmLayer)),
);

console.log(result.output);
console.log(result.metadata.confidence); // 0.6–1.0
console.log(result.status); // "completed" | "partial"
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts/guides/reasoning/](https://tylerjrbuell.github.io/reactive-agents-ts/guides/reasoning/)
