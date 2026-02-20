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
Action: search("X")
Observation: [search results]
Thought: Based on the results, I can conclude...
FINAL ANSWER: [conclusion]
```

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
