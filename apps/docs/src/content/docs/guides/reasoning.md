---
title: Reasoning
description: 5 reasoning strategies — ReAct, Reflexion, Plan-Execute, Tree-of-Thought, and Adaptive meta-strategy.
sidebar:
  order: 7
---

The reasoning layer provides structured thinking strategies that go beyond simple LLM completions. Each strategy shapes how the agent breaks down and approaches a task. With 5 built-in strategies and support for custom ones, you can match the reasoning approach to the problem.

## Available Strategies

### ReAct (Default)

A **Thought → Action → Observation** loop that continues until the agent reaches a final answer. This is the most versatile strategy and the default when reasoning is enabled.

1. **Think** — The agent reasons about the current state
2. **Act** — If needed, emits `ACTION: tool_name({"param": "value"})` in JSON format
3. **Observe** — The tool is executed via ToolService and the real result is fed back
4. **Repeat** until `FINAL ANSWER:` is reached or max iterations hit

**Best for:** Tasks requiring tool use, multi-step reasoning, and iterative refinement.

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()          // ReAct strategy by default
  .withTools()              // Built-in tools (web search, file I/O, etc.)
  .build();

const result = await agent.run("What happened in AI this week?");
// ReAct loop: Think → ACTION: web_search({"query":"..."}) → Observe: [real results] → FINAL ANSWER
```

When `.withTools()` is added, the ReAct strategy executes real registered tools and uses their actual results as observations. Tool names are injected into the prompt context so the LLM knows what it can call. Without ToolService, the agent degrades gracefully — returning descriptive messages instead of tool results.

### Reflexion

A **Generate → Self-Critique → Improve** loop based on the [Reflexion paper](https://arxiv.org/abs/2303.11366) (Shinn et al., 2023):

1. **Generate** — Produce an initial response
2. **Critique** — Self-evaluate: identify inaccuracies, gaps, or ambiguities
3. **Improve** — Rewrite using the critique as feedback
4. **Repeat** until `SATISFIED:` or `maxRetries` reached

**Best for:** Quality-critical output — writing, analysis, summarization.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "reflexion" })
  .build();

const result = await agent.run("Write a concise explanation of quantum entanglement");
// Generates → Critiques → Improves → Returns polished output
```

**Configuration:**

| Option | Default | Description |
|--------|---------|-------------|
| `maxRetries` | 3 | Max generate-critique-improve cycles |
| `selfCritiqueDepth` | "deep" | "shallow" or "deep" critique |
| `kernelMaxIterations` | 3 | Max ReAct tool-call iterations per generate/improve pass |

**Cross-run learning:** Reflexion supports `priorCritiques` — critiques from previous runs on similar tasks, loaded from episodic memory. This lets the agent avoid repeating past mistakes:

```typescript
// The execution engine automatically loads prior critiques from episodic memory
// when the strategy is "reflexion" and memory is enabled.
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "reflexion" })
  .withMemory("1")  // Episodic memory stores/retrieves critiques
  .build();
```

**Trade-off:** Reflexion uses more tokens than ReAct (typically 3× per retry cycle) because each cycle requires a generate pass, a critique pass, and an improve pass. The additional cost is usually worth it for tasks where output quality matters more than speed — writing, detailed analysis, or any domain where a first-pass answer is rarely optimal.

### Plan-Execute-Reflect

A structured approach that generates a plan first, then executes each step:

1. **Plan** — Generate a numbered list of steps to accomplish the task
2. **Execute** — Work through each step sequentially, using tools if available
3. **Reflect** — Evaluate execution against the original plan
4. **Refine** — If reflection identifies gaps, generate a revised plan and re-execute

**Best for:** Complex tasks with a clear decomposition — project planning, multi-step research, structured analysis.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect" })
  .withTools()
  .build();

const result = await agent.run("Compare the GDP growth of the top 5 economies over the last decade");
// Plans steps → Executes each → Reflects on completeness → Refines if needed
```

**Configuration:**

| Option | Default | Description |
|--------|---------|-------------|
| `maxRefinements` | 2 | Max plan revision cycles |
| `reflectionDepth` | "deep" | "shallow" or "deep" reflection |
| `stepKernelMaxIterations` | 2 | Max ReAct tool-call iterations per plan step |

### Tree-of-Thought

A two-phase **plan-then-execute** strategy that uses breadth-first tree search to find the best approach, then executes it using real tools:

**Phase 1 — Planning (BFS tree search):**
1. **Expand** — Generate multiple candidate thoughts, grounded in available tools
2. **Score** — Evaluate each thought's promise (0.0–1.0)
3. **Prune** — Discard thoughts below `pruningThreshold`
4. **Deepen** — Expand surviving thoughts further (up to `depth` levels)

**Phase 2 — Execution (ReAct loop):**
5. **Execute** — Run a ReAct-style think/act/observe loop guided by the best path, calling real tools

**Best for:** Complex tasks with multiple valid approaches that also require tool use (GitHub queries, file operations, multi-source research).

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "tree-of-thought" })
  .withTools()
  .build();

const result = await agent.run("Research and summarize recent commits in this repo");
// Phase 1: Explores 3 branches × 3 depth levels → Prunes weak ideas → Selects best path
// Phase 2: Executes the plan with tool calls → FINAL ANSWER
```

**Configuration:**

| Option | Default | Description |
|--------|---------|-------------|
| `breadth` | 3 | Candidate thoughts per expansion |
| `depth` | 3 | Maximum tree depth |
| `pruningThreshold` | 0.5 | Minimum score to survive pruning |

### Adaptive (Meta-Strategy)

The Adaptive strategy doesn't reason itself — it **analyzes the task and delegates to the best sub-strategy**:

1. **Analyze** — Classify the task's complexity, type, and requirements
2. **Select** — Choose the optimal strategy based on the analysis
3. **Delegate** — Execute the selected strategy

**Selection logic:**
- Simple Q&A → ReAct
- Quality-critical writing → Reflexion
- Complex multi-step tasks → Plan-Execute-Reflect
- Creative/open-ended → Tree-of-Thought

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools()
  .build();

// Adaptive selects the best strategy per task
await agent.run("What's 2+2?");              // → Uses ReAct (simple)
await agent.run("Write a technical report");  // → Uses Reflexion (quality-critical)
await agent.run("Plan a microservices arch"); // → Uses Plan-Execute (complex)
```

Alternatively, enable adaptive routing via the `adaptive.enabled` flag while keeping a named default:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ adaptive: { enabled: true } })
  .withTools()
  .build();
// Every task is classified and routed to the best strategy automatically
```

## Strategy Comparison

| Strategy | LLM Calls | Best For | Trade-off |
|----------|-----------|----------|-----------|
| **ReAct** | 1 per iteration | Tool use, step-by-step tasks | Fastest, most versatile |
| **Reflexion** | 3 per retry cycle | Quality-critical output | Slower, higher quality |
| **Plan-Execute** | 2+ per plan cycle | Structured multi-step work | Predictable, thorough |
| **Tree-of-Thought** | 3× breadth × depth + execution | Creative + tool-using tasks | Most thorough: plans then executes |
| **Adaptive** | 1 + delegated | Mixed workloads | Auto-selects, slight overhead |

## Enabling Reasoning

```typescript
// Default strategy (ReAct)
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .build();

// Specific strategy
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "reflexion" })
  .build();
```

## Custom Strategies

Register custom reasoning strategies using the `StrategyRegistry`:

```typescript
import { StrategyRegistry } from "@reactive-agents/reasoning";
import { LLMService } from "@reactive-agents/llm-provider";
import { Effect } from "effect";

const registerMyStrategy = Effect.gen(function* () {
  const registry = yield* StrategyRegistry;

  yield* registry.register("my-custom", (input) =>
    Effect.gen(function* () {
      const llm = yield* LLMService;

      const response = yield* llm.complete({
        messages: [
          { role: "user", content: `${input.taskDescription}\n\nContext: ${input.memoryContext}` },
        ],
        systemPrompt: "You are an expert problem solver.",
        maxTokens: input.config.strategies.reactive.maxIterations * 500,
      });

      return {
        strategy: "my-custom",
        steps: [{ thought: "Custom reasoning", action: "none", observation: response.content }],
        output: response.content,
        metadata: {
          duration: 0,
          cost: response.usage.estimatedCost,
          tokensUsed: response.usage.totalTokens,
          stepsCount: 1,
          confidence: 0.9,
        },
        status: "completed" as const,
      };
    }),
  );
});
```

## Without Reasoning

When reasoning is not enabled, the agent uses a direct LLM loop:
- Send messages to the LLM
- If the LLM requests tool calls, execute them and append results
- Repeat until the LLM returns a final response (no tool calls)
- Stop when done or max iterations reached

This is faster and cheaper — suitable for simple Q&A, chat, or tasks where structured reasoning isn't needed.

## Tools + Reasoning Integration

When both `.withReasoning()` and `.withTools()` are enabled, tools are wired directly into the reasoning loop:

1. ToolService is provided to the ReasoningService layer at construction time
2. During ReAct, when the LLM emits `ACTION: tool_name(...)`, the strategy calls `ToolService.execute()` with the parsed arguments
3. The real tool result becomes the `Observation` fed back into the LLM
4. Available tool names are injected into the reasoning prompt so the LLM knows what's available

This means agents can genuinely interact with the world during reasoning — search the web, query databases, run calculations — and incorporate real results into their thinking.

All five strategies support tool integration. Tree-of-Thought uses tools in its execution phase (Phase 2), while ReAct, Plan-Execute, and Reflexion use them throughout their loops.

## Strategy Configuration

All strategies receive the full execution context from the engine, including:

| Field | Type | Description |
|-------|------|-------------|
| `resultCompression` | `ResultCompressionConfig` | Controls tool result preview size and scratchpad overflow |
| `contextProfile` | `ContextProfile` | Model-adaptive context thresholds (local/mid/large/frontier) |
| `agentId` | `string` | Real agent ID for tool execution attribution |
| `sessionId` | `string` | Session/task ID for tool execution attribution |
| `systemPrompt` | `string` | Custom system prompt (from persona or direct config) |

These are threaded through to every `executeReActKernel()` call, so tool compression, context budgets, and attribution work consistently across all strategies.

Custom strategies registered via `StrategyRegistry` receive all these fields automatically through the `StrategyFn` input type.
