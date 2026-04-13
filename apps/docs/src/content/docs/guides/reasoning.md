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
2. **Act** — If needed, invokes a tool via native function calling (tools are passed via API parameter; the model returns structured `tool_use` blocks)
3. **Observe** — The tool is executed via ToolService and the real result is fed back as a `tool_result` message
4. **Repeat** until the `final-answer` meta-tool is called or max iterations hit

**Best for:** Tasks requiring tool use, multi-step reasoning, and iterative refinement.

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()          // ReAct strategy by default
  .withTools()              // Built-in tools (web search, file I/O, etc.)
  .build();

const result = await agent.run("What happened in AI this week?");
// ReAct loop: Think → tool_use: web_search({query: "..."}) → tool_result: [real results] → final-answer
```

When `.withTools()` is added, the ReAct strategy passes tool definitions to the LLM via the API's native function calling parameter. The model returns structured `tool_use` blocks — no text parsing required. Tool results are fed back as `tool_result` messages. Without ToolService, the agent degrades gracefully — returning descriptive messages instead of tool results.

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
  .withMemory()  // Episodic memory stores/retrieves critiques
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

## Intelligent Context Synthesis

Between kernel iterations, **Intelligent Context Synthesis (ICS)** can rewrite the transcript into a tighter set of messages for the next LLM call — either via fast deterministic templates or an extra LLM pass (“deep” mode). Configure it on `.withReasoning()` with `synthesis`, `synthesisModel`, `synthesisProvider`, `synthesisStrategy`, and `synthesisTemperature`. You can override ICS **per named strategy** under `strategies.reactive`, `strategies.planExecute`, `strategies.treeOfThought`, or `strategies.reflexion` (e.g. fast globally but deep for ReAct only). The **adaptive** meta-strategy uses only the top-level synthesis fields until a concrete strategy runs. See [Intelligent Context Synthesis](/features/intelligent-context-synthesis/) for the full table, EventBus (`ContextSynthesized`), and resolution order.

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
2. During ReAct, the LLM returns structured `tool_use` blocks via native function calling — no text regex parsing. The strategy calls `ToolService.execute()` with the structured arguments
3. The real tool result is fed back as a `tool_result` message in the conversation history
4. Tool definitions (name, description, input schema) are passed via the API parameter so the LLM knows what's available

This means agents can genuinely interact with the world during reasoning — search the web, query databases, run calculations — and incorporate real results into their thinking.

All five strategies support tool integration. Tree-of-Thought uses tools in its execution phase (Phase 2), while ReAct, Plan-Execute, and Reflexion use them throughout their loops.

## Strategy Configuration

All strategies receive the full execution context from the engine, including:

| Field | Type | Description |
|-------|------|-------------|
| `resultCompression` | `ResultCompressionConfig` | Controls tool result preview size, overflow key storage, and optional code-transform pipe |
| `contextProfile` | `ContextProfile` | Model-adaptive context thresholds (local/mid/large/frontier) |
| `agentId` | `string` | Real agent ID for tool execution attribution |
| `sessionId` | `string` | Session/task ID for tool execution attribution |
| `systemPrompt` | `string` | Custom system prompt (from persona or direct config) |

These are threaded through to every `executeReActKernel()` call, so tool compression, context budgets, and attribution work consistently across all strategies.

Custom strategies registered via `StrategyRegistry` receive all these fields automatically through the `StrategyFn` input type.

---

## Structured Plan Engine

The Plan-Execute strategy was rewritten in v0.6.0 with a **type-safe structured plan engine** that replaces fragile text-parsed numbered lists with JSON schemas, SQLite persistence, and a 4-layer output pipeline.

### How It Works

```
1. Plan Generation   — LLM generates a structured JSON plan (typed schema, not free text)
2. Structured Output — 4-layer pipeline: prompt → JSON repair → schema validation → retry
3. Step Execution    — Hybrid dispatch: tool_call (direct) or analysis (single LLM call) or composite (scoped ReAct kernel)
4. Cross-Step Data   — {{from_step:sN}} interpolation passes outputs between steps
5. Reflection        — Graduated retry → patch → replan on failure
6. Persistence       — Plans stored in SQLite via PlanStoreService
```

### Plan Schema

The engine works with two core types from `packages/reasoning/src/types/plan.ts`:

**`PlanStep`** — a hydrated step with full execution metadata:

```typescript
interface PlanStep {
  id: string;           // Sequential ID: "s1", "s2", ...
  seq: number;          // 1-based sequence number
  title: string;        // Short human-readable title
  instruction: string;  // Full execution instruction for the LLM or tool
  type: "tool_call" | "analysis" | "composite";
  toolName?: string;    // Required when type is "tool_call"
  toolArgs?: Record<string, unknown>;  // Args passed directly to the tool
  toolHints?: readonly string[];       // Tool names scoped to composite steps
  dependsOn?: readonly string[];       // Step IDs this step depends on
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  result?: string;       // Output produced by this step
  error?: string;        // Error message if the step failed
  retries: number;       // Number of retry attempts made
  tokensUsed: number;
  startedAt?: string;
  completedAt?: string;
}
```

**`Plan`** — the top-level plan container:

```typescript
interface Plan {
  id: string;
  taskId: string;
  agentId: string;
  goal: string;
  mode: "linear" | "dag";
  steps: PlanStep[];
  status: "active" | "completed" | "failed" | "abandoned";
  version: number;
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
  totalCost: number;
}
```

The LLM is asked to produce an `LLMPlanOutput` — an array of `LLMPlanStep` objects (content-only, no metadata). The engine then calls `hydratePlan()` to assign sequential IDs (`s1`, `s2`, ...), set all statuses to `"pending"`, and stamp timestamps.

### Cross-Step References

Steps can reference outputs from earlier steps using `{{from_step:sN}}` interpolation inside `toolArgs` values. A variant with `:summary` truncates to the first 500 characters:

```typescript
// Plan step s1: fetch recent commits from GitHub
{
  id: "s1",
  type: "tool_call",
  toolName: "web-search",
  toolArgs: { query: "site:github.com/my-org/my-repo commits" }
}

// Plan step s2: summarize what was found in s1
{
  id: "s2",
  type: "analysis",
  instruction: "Summarize these commit messages: {{from_step:s1}}",
  // Full s1 output is interpolated before the LLM call
}

// Or use :summary to truncate long outputs
{
  id: "s3",
  type: "tool_call",
  toolName: "file-write",
  toolArgs: {
    path: "./summary.md",
    content: "{{from_step:s2:summary}}"  // First 500 chars of s2's result
  }
}
```

Self-references are guarded at runtime — a step cannot reference its own output. If a `{{from_step:sN}}` pattern remains unresolved (because the referenced step hasn't completed or is the current step), the step fails with a descriptive error rather than silently passing a broken string to a tool.

### The 4-Layer Output Pipeline

Plan generation uses `extractStructuredOutput()` from `packages/reasoning/src/structured-output/pipeline.ts`, which runs four layers in sequence:

```
Layer 1 — High-signal prompting     Tier-adaptive prompt with schema example and rules.
                                    buildPlanGenerationPrompt() selects prompt complexity
                                    based on model tier (local / mid / large / frontier).

Layer 2 — JSON repair               extractJsonBlock() strips markdown fences and code
                                    blocks. repairJson() fixes trailing commas, single
                                    quotes, and truncated JSON before parsing.

Layer 3 — Schema validation         Effect Schema.decode() validates the repaired JSON
                                    against LLMPlanOutputSchema. Type errors surface as
                                    structured messages, not raw exceptions.

Layer 4 — Retry with feedback       On validation failure, re-prompts the LLM with the
                                    exact validation error so it can correct its output.
                                    Controlled by the maxRetries option (default: 2).
```

### Configuration

Configure the Plan-Execute strategy via `withReasoning()`. All fields live under `strategies.planExecute` in the `ReasoningConfig`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRefinements` | `number` | `2` | Max plan revision cycles after reflection |
| `reflectionDepth` | `"shallow" \| "deep"` | `"deep"` | Controls reflection prompt token budget (1500 vs 2500 tokens) |
| `stepRetries` | `number` | `1` | Retry attempts per step before falling back to patch |
| `stepKernelMaxIterations` | `number` | `3` | Max ReAct iterations for `composite`-type steps |
| `planMode` | `"linear" \| "dag"` | `"linear"` | Execution mode — `linear` runs steps sequentially |
| `patchStrategy` | `"in-place" \| "replan-remaining"` | — | How failed steps are repaired |

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({
    defaultStrategy: "plan-execute-reflect",
    strategies: {
      planExecute: {
        maxRefinements: 3,
        reflectionDepth: "deep",
        stepRetries: 2,
        stepKernelMaxIterations: 4,
        planMode: "linear",
      },
    },
  })
  .withTools()
  .withMemory()   // Enables PlanStoreService (SQLite plan persistence)
  .build();
```

### Hybrid Step Dispatch

Each `PlanStep` has a `type` that determines how it is executed:

| Step Type | Execution | When to Use |
|-----------|-----------|-------------|
| `tool_call` | Direct `ToolService.execute()` call — no LLM involved | Single deterministic tool call with known args |
| `analysis` | Single LLM completion — no tools, no loop | Reasoning, summarization, writing tasks |
| `composite` | Scoped ReAct kernel — tools filtered to `toolHints` | Multi-tool sub-tasks within a larger plan |

The `toolHints` field on a `composite` step limits which tools the scoped ReAct kernel can see, preventing the sub-agent from reaching outside its scope.

### Error Recovery

| Situation | Recovery Strategy |
|-----------|------------------|
| Step fails, retries remain | Retry the same step with the previous error message appended |
| Step fails, no retries left | Patch: ask the LLM to rewrite only the failed and pending steps via `buildPatchPrompt()` |
| Patch also fails | The step is marked `"failed"` and execution continues; reflection decides whether to replan |
| All steps completed but goal unmet | Augment: generate supplementary steps to fill gaps identified by the reflector |

When the reflector returns `UNSATISFIED` but all steps completed successfully (no failures to patch), the engine generates **supplementary steps** via `buildAugmentPrompt()`. These new steps are appended to the plan and executed in the next iteration. This handles the common case where a combined search returns incomplete data — the reflector identifies what's missing and the augmentation path fills the gaps with targeted follow-up steps.

Re-execution of completed steps is prevented by `computeWaves` skipping steps with `status === "completed"`, so side-effecting steps (file writes, API calls) are never re-run.

### Planner Decomposition and Tool Quantity Enforcement

The plan generation prompt instructs the LLM to create **separate `tool_call` steps for each distinct entity** rather than combining them into a single query. For example, "fetch prices for XRP, XLM, ETH, and Bitcoin" produces 4 individual web-search steps instead of one combined search that may miss items.

When the classifier determines per-tool call counts (e.g. `web-search×4`), these quantities are:

1. **Surfaced in the planner prompt** as a `TOOL CALL REQUIREMENTS` section
2. **Enforced post-generation** — if the plan has fewer `tool_call` steps than required, synthetic steps are injected to cover the deficit

This ensures the plan respects the classifier's analysis of what the task requires.

### Plan Persistence

When `.withMemory()` is enabled, the `PlanStoreService` (backed by `bun:sqlite`) automatically persists:

- The full `Plan` object on creation
- Step status transitions (`pending` → `in_progress` → `completed` / `failed`) in real time

This means plan state survives agent restarts and can be inspected for debugging or auditing. The persistence layer is optional — when memory is not configured, planning proceeds in-memory with no behavioral change.

## Adaptive Strategy — Sub-Strategy Reporting

When using `defaultStrategy: "adaptive"`, the framework selects a concrete sub-strategy at runtime (ReAct, Plan-Execute, or Reflexion). `agentResult.metadata.strategyUsed` now reports the **actual sub-strategy that produced the output**, not `"adaptive"`:

```typescript
const result = await agent.run("Research and write a report");

console.log(result.metadata.strategyUsed);
// "reactive" — not "adaptive"
```

The `[think]` observability log also shows the selection inline:

```
◉ [think]   12 steps | 8,432 tok | 18.4s (adaptive→reactive)
```

The EventBus `ReasoningStepCompleted` event still carries `strategy: "adaptive"` for subscribers that need to know the entry point. `result.metadata.selectedStrategy` carries the sub-strategy for downstream use.

## Required Tools and Per-Tool Budget

When tools must be called before the agent can declare success, use `.withRequiredTools()`. The required-tools gate now includes hardening for real-world research tasks.

### Gate Hardening Behaviors

- **Relevant-tools pass-through**: tools classified as relevant are allowed even while required output tools are still pending
- **Satisfied-required re-calls**: once a required tool has been called at least once, it can be called again for follow-up research
- **Output tools stay available**: output/finalization tools are never blocked by search budgets

This avoids a common failure mode where agents are forced into rigid "one tool once" sequences and cannot complete coherent research + synthesis runs.

### Per-Tool Call Budget (`maxCallsPerTool`)

Auto-budgeting now follows **intent mode**, not tool-name heuristics:

- **Parallel mode** (`.withReasoning({ parallelToolCalls: true })`, default): when required tools are classified with `minCalls`, the runtime derives `maxCallsPerTool` from those required quantities plus a retry buffer of 2 (for example, `web-search×4` → `maxCallsPerTool["web-search"] = 6`). The buffer allows for exploratory combined searches, failed attempts, and guard-blocked calls that don't count as successful completions.
- **Sequential mode** (`.withReasoning({ parallelToolCalls: false })`): the runtime does **not** auto-apply per-tool call budgets, preserving the one-call-at-a-time loop behavior.

When a budget exists and a tool reaches it, further calls are blocked and the agent is nudged toward synthesis. This prevents repeated loops while still honoring required-tool quotas.

### Dynamic Stopping — Novelty Signal

The framework includes a **novelty-based synthesis nudge**: if the last observation adds less than 20% new information compared to the accumulated research context (word-token Jaccard overlap), the continuation hint is replaced with:

```
Research context is sufficient (last search: 8% new information — diminishing returns).
Do NOT search again. Call file-write now to produce the output.
```

This fires automatically — no configuration required. It is one of three dynamic stopping layers alongside per-tool budgeting and task-phase transition (when search tools are satisfied and only output tools remain, `synthesisPrompt` fires instead of a generic progress message).

## Native Function Calling Fallback

Native provider `toolCalls` are always preferred. If a model emits JSON tool calls in plain text instead, the harness applies a fallback parser:

- Supports fenced ` ```json ` blocks and bare JSON payloads
- Accepts common schemas: `name/arguments`, `tool/parameters`, `tool_name/args`, `name/input`
- Validates tool names against the active tool registry
- Normalizes underscore-style names to hyphenated tool names

This fallback path improves reliability for local or mid-tier models that occasionally emit tool calls as plain text rather than structured provider events.
