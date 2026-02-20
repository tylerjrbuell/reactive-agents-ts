---
title: Reasoning
description: Understanding agent reasoning strategies — ReAct, Plan-Execute, Tree-of-Thought, and Reflexion.
---

The reasoning layer provides structured thinking strategies that go beyond simple LLM completions. Each strategy shapes how the agent breaks down and approaches a task.

## Available Strategies

### ReAct (Default)

A Thought → Action → Observation loop that continues until the agent reaches a final answer.

1. **Think** — The agent reasons about the current state
2. **Act** — If needed, the agent calls a tool
3. **Observe** — The agent incorporates the tool result
4. Repeat until `FINAL ANSWER:` is reached

Best for: Tasks requiring tool use, multi-step reasoning, and iterative refinement.

### Plan-Execute

1. Generate a structured plan with numbered steps
2. Execute each step sequentially
3. Verify against the original plan

Best for: Complex tasks with a clear decomposition up-front.

### Tree-of-Thought

Explores multiple reasoning branches in parallel, evaluating each branch for promise before continuing the most promising one.

Best for: Creative tasks and problems with multiple valid solution paths.

### Reflexion

A Generate → Self-Critique → Improve loop based on the [Reflexion paper](https://arxiv.org/abs/2303.11366) (Shinn et al., 2023):

1. **Generate** — Produce an initial response
2. **Critique** — Self-evaluate: identify inaccuracies, gaps, or ambiguities
3. **Improve** — Rewrite using the critique as feedback
4. Repeat until the critique is satisfied (`SATISFIED:`) or `maxRetries` is reached

Best for: Tasks where output quality matters more than speed — writing, analysis, summarization.

```typescript
import { executeReflexion } from "@reactive-agents/reasoning";
import { Effect } from "effect";

// Direct usage
const result = await Effect.runPromise(
  executeReflexion({
    taskDescription: "Write a concise explanation of quantum entanglement.",
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
          maxRetries: 3,          // Max generate-critique-improve cycles
          selfCritiqueDepth: "deep", // "shallow" | "deep"
        },
      },
    },
  }).pipe(Effect.provide(llmLayer)),
);

console.log(result.output);  // Final improved response
console.log(result.metadata.confidence); // 0–1
```

## Enabling Reasoning

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()  // Uses ReAct by default
  .build();

const result = await agent.run("Research the latest advances in CRISPR");
```

## Strategy Comparison

| Strategy | LLM Calls | Best For | Trade-off |
|----------|-----------|----------|-----------|
| ReAct | 1 per iteration | Tool use, step-by-step tasks | Fastest |
| Plan-Execute | 2+ | Structured multi-step work | Predictable |
| Tree-of-Thought | 3× breadth per depth | Open-ended exploration | Most tokens |
| Reflexion | 3 per retry cycle | Quality-critical output | Slower, higher quality |

## Custom Strategies

Register custom reasoning strategies using the `StrategyRegistry`:

```typescript
import { StrategyRegistry } from "@reactive-agents/reasoning";
import { Effect } from "effect";

const registerMyStrategy = Effect.gen(function* () {
  const registry = yield* StrategyRegistry;
  yield* registry.register("my-custom", (input) =>
    Effect.gen(function* () {
      // Your strategy implementation
      return {
        strategy: "my-custom",
        steps: [],
        output: "result",
        metadata: { duration: 0, cost: 0, tokensUsed: 0, stepsCount: 0, confidence: 1 },
        status: "completed",
      };
    }),
  );
});
```

## Without Reasoning

When reasoning is not enabled, the agent uses a direct LLM loop:
- Send messages to the LLM
- If the LLM requests tool calls, execute them
- Append results and repeat
- Stop when the LLM returns a final response

This is faster but less structured — suitable for simple Q&A or chat tasks.
