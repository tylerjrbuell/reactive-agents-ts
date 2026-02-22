---
title: Custom Reasoning Strategies
description: Build and register your own reasoning strategies for specialized agent behavior.
sidebar:
  order: 3
---

While the 5 built-in strategies cover most use cases, you can register custom reasoning strategies for specialized behavior.

## Strategy Interface

Every strategy is a function that takes an input and returns a `ReasoningResult` as an Effect:

```typescript
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ReasoningResult } from "@reactive-agents/reasoning";
import type { ReasoningConfig } from "@reactive-agents/reasoning";

type StrategyFn = (input: {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}) => Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService      // Strategy receives LLMService in its context
>;
```

The strategy function has access to `LLMService` (and optionally `ToolService`) through the Effect context — the framework provides these automatically when executing the strategy.

## Example: Chain-of-Verification Strategy

A strategy that generates a response, extracts claims, verifies each one, and revises:

```typescript
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { StrategyRegistry } from "@reactive-agents/reasoning";

const executeChainOfVerification = (input) =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const steps = [];
    const startTime = Date.now();

    // Step 1: Generate initial response
    const initial = yield* llm.complete({
      messages: [
        { role: "user", content: input.taskDescription },
      ],
      systemPrompt: `Context: ${input.memoryContext}`,
    });

    steps.push({
      thought: "Generated initial response",
      action: "generate",
      observation: initial.content,
    });

    // Step 2: Extract verifiable claims
    const claims = yield* llm.complete({
      messages: [
        { role: "user", content: `Extract all factual claims from this text as a numbered list:\n\n${initial.content}` },
      ],
    });

    steps.push({
      thought: "Extracted claims for verification",
      action: "extract_claims",
      observation: claims.content,
    });

    // Step 3: Verify each claim
    const verification = yield* llm.complete({
      messages: [
        { role: "user", content: `For each claim, assess if it is accurate, inaccurate, or uncertain. Explain your reasoning:\n\n${claims.content}` },
      ],
    });

    steps.push({
      thought: "Verified claims",
      action: "verify",
      observation: verification.content,
    });

    // Step 4: Revise based on verification
    const revised = yield* llm.complete({
      messages: [
        { role: "user", content: `Original response:\n${initial.content}\n\nVerification results:\n${verification.content}\n\nRevise the response to correct any inaccuracies and strengthen uncertain claims.` },
      ],
    });

    steps.push({
      thought: "Revised response based on verification",
      action: "revise",
      observation: revised.content,
    });

    const totalTokens =
      initial.usage.totalTokens +
      claims.usage.totalTokens +
      verification.usage.totalTokens +
      revised.usage.totalTokens;

    return {
      strategy: "chain-of-verification",
      steps,
      output: revised.content,
      metadata: {
        duration: Date.now() - startTime,
        cost: initial.usage.estimatedCost + claims.usage.estimatedCost +
              verification.usage.estimatedCost + revised.usage.estimatedCost,
        tokensUsed: totalTokens,
        stepsCount: steps.length,
        confidence: 0.9,
      },
      status: "completed" as const,
    };
  });
```

## Registering the Strategy

Register your strategy at runtime using the `StrategyRegistry`:

```typescript
import { StrategyRegistry } from "@reactive-agents/reasoning";
import { Effect } from "effect";

const registerStrategy = Effect.gen(function* () {
  const registry = yield* StrategyRegistry;
  yield* registry.register("chain-of-verification", executeChainOfVerification);
});
```

To use it with the builder, register it as a lifecycle hook at bootstrap time, then reference the strategy name:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "chain-of-verification" })
  .withHook({
    phase: "bootstrap",
    timing: "before",
    handler: (ctx) =>
      registerStrategy.pipe(Effect.map(() => ctx)),
  })
  .build();
```

## Strategies with Tool Access

Your strategy can optionally use ToolService for tool execution:

```typescript
import { ToolService } from "@reactive-agents/tools";

const executeMyStrategy = (input) =>
  Effect.gen(function* () {
    const llm = yield* LLMService;

    // ToolService is optional — degrade gracefully if not available
    const toolServiceOpt = yield* Effect.serviceOption(ToolService);

    if (toolServiceOpt._tag === "Some") {
      const toolService = toolServiceOpt.value;
      // Use tools during reasoning
      const result = yield* toolService.execute("web_search", { query: input.taskDescription });
      // ... incorporate tool result into reasoning
    }

    // ... rest of strategy
  });
```

When the agent is built with `.withTools()`, ToolService is automatically provided to your strategy.

## Strategy Best Practices

1. **Track all costs** — Accumulate `usage.estimatedCost` and `usage.totalTokens` from every LLM call
2. **Use `steps` array** — Record each reasoning step with thought, action, and observation for debugging
3. **Set confidence** — Estimate confidence (0-1) in the `metadata` — this feeds into interaction mode decisions
4. **Handle errors** — Wrap tool calls and LLM calls in error handling to prevent strategy crashes
5. **Respect config** — Use values from `input.config.strategies` for configurable behavior like max iterations
6. **Return early** — If the task is simple, don't force complex reasoning — return quickly with high confidence

## Listing Available Strategies

```typescript
const program = Effect.gen(function* () {
  const registry = yield* StrategyRegistry;
  const strategies = yield* registry.list();
  console.log("Available strategies:", strategies);
  // ["reactive", "reflexion", "plan-execute-reflect", "tree-of-thought", "adaptive", "chain-of-verification"]
});
```
