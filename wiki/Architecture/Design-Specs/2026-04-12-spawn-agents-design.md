# spawn-agents: Parallel Sub-Agent Dispatch

**Date:** 2026-04-12
**Status:** Approved for implementation

## Problem

The existing `spawn-agent` tool dispatches exactly one sub-agent per tool call. An orchestrator agent that needs to fan out N independent subtasks must issue N sequential tool calls, waiting for each sub-agent to complete before starting the next. There is no way to express parallel intent in a single call.

Additionally, `isParallelBatchSafeTool` does not recognize `spawn-agent` as batch-safe, so even when an LLM emits multiple `spawn-agent` tool-use blocks in one response, the kernel runs them serially.

## Solution

Two coordinated changes:

1. **New `spawn-agents` tool** — accepts an array of tasks and dispatches them concurrently via `Effect.all` with `mode: "either"` (partial results by default). A single LLM tool call can fan out N sub-agents in parallel.
2. **`isParallelBatchSafeTool` fix** — adds `spawn-agent` to the parallel-safe set so the kernel batches multiple single-dispatch calls when the LLM emits them together.

---

## Architecture

### Files Changed

```
packages/tools/src/adapters/agent-tool-adapter.ts
  + createSpawnAgentsTool()         — new exported tool definition

packages/reasoning/src/strategies/kernel/utils/tool-utils.ts
  ~ isParallelBatchSafeTool()       — add spawn-agent to PARALLEL_SAFE_TOOLS set

packages/runtime/src/builder.ts
  + buildSingleSubAgentTask()       — extracted shared helper (was inline in spawnHandler)
  + spawnAgentsHandler              — parallel dispatch handler
  ~ withDynamicSubAgents()          — register spawn-agents alongside spawn-agent
  ~ buildEffect()                   — wire shared helper
```

### Extraction: `buildSingleSubAgentTask`

The existing `spawnHandler` in `builder.ts` contains ~260 lines of sub-agent construction logic: MCP tool proxying, persona composition, tool relevance filtering, sub-agent runtime creation, and result extraction. Rather than duplicating this for `spawnAgentsHandler`, this logic is extracted into a shared inner helper `buildSingleSubAgentTask(args, name): Effect<SubAgentResult>` inside `buildEffect`. Both `spawnHandler` and `spawnAgentsHandler` call it.

---

## Tool Definition: `spawn-agents`

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `tasks` | `Task[]` | yes | — | Array of sub-agent task descriptors (see Task shape below) |
| `failFast` | `boolean` | no | `false` | When `true`, abort all remaining agents on first failure. When `false`, run all to completion and return partial results. |
| `maxConcurrency` | `number` | no | `tasks.length` | Maximum simultaneous agents. Cap this when tool rate limits apply (e.g., set to `3` for API-heavy tasks). |

### Task Shape (each element of `tasks`)

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task` | `string` | yes | Complete, self-contained task description. Must include all specific values the sub-agent needs — URLs, IDs, file paths, usernames, etc. Sub-agents have **zero** shared context. |
| `name` | `string` | yes | Descriptive kebab-case agent name (e.g. `"commit-summarizer"`, `"slack-notifier"`). Appears in logs and metrics. Must reflect the sub-agent's specific purpose. |
| `role` | `string` | no | Optional role to steer approach (e.g. `"researcher"`, `"code reviewer"`). |
| `instructions` | `string` | no | Optional behavioral guidance (e.g. `"Be concise"`, `"Focus on security issues"`). |
| `tone` | `string` | no | Optional tone (e.g. `"professional"`, `"concise"`, `"detailed"`). |
| `tools` | `string[]` | no | Optional whitelist of tool names this sub-agent can use. When set, only these tools are available. Default: all parent tools. |

### Return Shape

```ts
{
  results: Array<{
    name: string           // agent name from input
    success: boolean       // true if sub-agent completed successfully
    output: string         // final answer, or error message if failed
    tokensUsed: number
    stepsCompleted: number
    delegatedToolsUsed?: string[]  // tools the sub-agent actually called
  }>
  summary: {
    total: number
    succeeded: number
    failed: number
  }
}
```

### Tool Description (LLM-facing)

The tool description must communicate:

- **Use `spawn-agents` when:** You have 2+ tasks that are fully independent — none requires another's output as input. All can run simultaneously.
- **Use `spawn-agent` (singular) instead when:** Tasks have sequential dependencies (task B needs task A's output), or you are spawning exactly one sub-agent.
- **Task descriptions must be fully self-contained.** Each sub-agent starts with a fresh context window and zero knowledge of your conversation. Include all specific values: phone numbers, email addresses, URLs, repository names, file paths, IDs, usernames, dates. Never say "the repo" — say `github.com/owner/repo`.
- **`failFast: true`** is appropriate when tasks are all-or-nothing (e.g., steps of a deployment pipeline).
- **`maxConcurrency`** should be set when tasks make calls to rate-limited APIs.

---

## Execution Model

### Partial Results (default, `failFast: false`)

```ts
Effect.all(
  tasks.map((t) => buildSingleSubAgentTask(t.task, t.name, t)),
  {
    concurrency: maxConcurrency ?? tasks.length,
    mode: "either",   // collect both Either.Right (success) and Either.Left (failure)
  }
)
// map results: Either.Right → { success: true, output }
//              Either.Left  → { success: false, output: error.message }
```

### Fail-Fast (`failFast: true`)

```ts
Effect.all(
  tasks.map((t) => buildSingleSubAgentTask(t.task, t.name, t)),
  { concurrency: maxConcurrency ?? tasks.length }
  // default mode: "default" — first failure short-circuits
)
```

### Console Output

Each sub-agent already prints its own `┌── sub-agent: name ──` / `└──` bracket via the existing `spawnHandler` stdout writes. For parallel runs, these interleave naturally. No changes to console output format are needed.

---

## `isParallelBatchSafeTool` Fix

In `tool-utils.ts`, add `spawn-agent` to an explicit allowlist checked before the pattern-based logic:

```ts
// Explicitly safe tools — bypass pattern matching
const PARALLEL_SAFE_TOOLS = new Set(["spawn-agent"]);
if (PARALLEL_SAFE_TOOLS.has(name)) return true;
```

This is an explicit set rather than a `"spawn"` substring match to avoid accidentally marking unrelated future tools as batch-safe. When the LLM emits multiple `spawn-agent` tool-use blocks in a single response turn, the kernel groups them into one batch and runs them with `Effect.all` at full concurrency.

---

## Registration

In `withDynamicSubAgents()` inside `builder.ts`, register `spawn-agents` alongside the existing `spawn-agent`:

```ts
// existing
{ definition: createSpawnAgentTool(),  handler: spawnHandler  }
// new
{ definition: createSpawnAgentsTool(), handler: spawnAgentsHandler }
```

Both tools are registered when `.withDynamicSubAgents()` is called. No new builder method is needed.

---

## Testing

### Unit Tests — `packages/tools/src/tests/`

- `createSpawnAgentsTool()` returns the correct schema shape (name, parameters, returnType)
- `tasks` parameter is marked required, all Task sub-fields have correct types and required flags
- `failFast` parameter defaults to `false`
- `maxConcurrency` is optional with no default in schema

### Integration Tests — `packages/runtime/tests/spawn-agents.test.ts`

Using `withTestScenario` for deterministic sub-agent LLM responses:

| Test | Assertion |
|------|-----------|
| 3 tasks, default settings | All 3 complete; `summary.succeeded === 3` |
| 3 tasks, one sub-agent fails, `failFast: false` | Returns partial: 2 successes + 1 failure; `summary.failed === 1` |
| 3 tasks, one sub-agent fails, `failFast: true` | Effect fails; no partial results returned |
| `maxConcurrency: 1` | Results are correct; execution is serialized |
| `spawn-agent` batch-safe fix | Two `spawn-agent` calls in one response execute concurrently (verify via mock call order or timing) |
| Task with `tools` whitelist | Sub-agent only receives whitelisted tools |
| Task with persona fields | Sub-agent system prompt reflects role/instructions/tone |

---

## Non-Goals

- No new builder method (`.withParallelSubAgents()` etc.) — `spawn-agents` is registered automatically by the existing `.withDynamicSubAgents()`
- No changes to sub-agent runtime, `createSubAgentExecutor`, or `createLightRuntime`
- No changes to console output format
- No streaming of individual sub-agent results (results are collected and returned together)
