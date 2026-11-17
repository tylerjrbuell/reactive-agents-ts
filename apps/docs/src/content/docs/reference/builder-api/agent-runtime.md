---
title: "ReactiveAgent: running and streaming"
description: >-
  Reference for the ReactiveAgent facade returned by build(): run, runStream, runEffect, streamObject, multimodal input, resource management, cancel, health, lifecycle control and events.
sidebar:
  order: 9
topic: config-reference
related:
  - reference/builder-api
  - features/streaming
  - reference/builder-api/agent-result
  - guides/hooks
---

The facade returned by `build()`: running a task, streaming, multimodal input, resource management, cancellation, health and the event subscription surface. Part of the [builder reference](/reference/builder-api/).

## Multimodal task input

`run()`, `runStream()`, `runEffect()` and `chat()` accept a `TaskInput`: a plain string, or an array of typed content parts (`text`, `image`, `audio`, `file`). A text-only array behaves exactly like the string.

```typescript
import { ReactiveAgents, modelInputCapabilities } from "reactive-agents";

const agent = await ReactiveAgents.create().withProvider("anthropic").build();
const pngBase64 = "iVBORw0KGgo="; // your image bytes, base64-encoded

const result = await agent.run([
  { type: "text", text: "What is in this picture?" },
  { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
]);

// Ask before you send (Cortex-style attachment pickers):
const caps = modelInputCapabilities("anthropic", "claude-sonnet-4-6"); // { vision, audioIn?, authoritative }
```

- Image parts reach the provider request. If the model is known (a probe or the static capability table) not to accept images, the run fails before any model call with `UnsupportedModalityError { partType, model }`. For models the framework only guesses about, the part is sent and a real provider refusal surfaces as an error.
- Audio fails fast only when `supportsAudioIn` is explicitly `false` for a known model; otherwise the provider layer decides (a stub or the part's `transcript`).
- `file` parts pass through to the provider layer. Durable runs store the text projection of the task, so a resumed run does not re-send media.
- `chat()` with media routes the turn through the agentic path (the direct path is text-only).

## Resource Management

Agents that use MCP servers (stdio transport) or other subprocess-based resources **must be disposed** after use, otherwise the process will hang on open pipes. Three patterns are available:

### Pattern 1 — `await using` (recommended)

Uses the [Explicit Resource Management](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html) protocol introduced in TypeScript 5.2. The agent is disposed automatically when the enclosing block exits, whether normally or via an exception.

<!-- docs-skip-typecheck -->
```typescript
await using agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMCP({ name: "filesystem", transport: "stdio", command: "npx", args: ["@modelcontextprotocol/server-filesystem", "."] })
  .withReasoning()
  .build();

const result = await agent.run("List the project files.");
console.log(result.output);
// agent.dispose() is called automatically here
```

Requires `"lib": ["ES2022", "ESNext"]` or `"target": "ES2022"` in your `tsconfig.json`.

### Pattern 2 — `runOnce()` (one-shot)

If you only need a single result and don't want to manage the agent handle at all, use the builder's `runOnce()` method. It builds, runs, and disposes in one call.

```typescript
const result = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withMCP({
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '.'],
    })
    .withReasoning()
    .runOnce('List the project files.')

console.log(result.output)
// Resources already cleaned up
```

### Pattern 3 — `dispose()` (explicit)

Call `dispose()` manually in a `finally` block when you need to reuse the agent across multiple calls before cleaning up.

```typescript
const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withReasoning()
    .build()

try {
    const r1 = await agent.run('First task')
    const r2 = await agent.run('Second task')
    console.log(r1.output, r2.output)
} finally {
    await agent.dispose()
}
```

| Pattern       | When to use                                                 |
| ------------- | ----------------------------------------------------------- |
| `await using` | General purpose — automatic cleanup, works with `try/catch` |
| `runOnce()`   | Single-shot scripts and one-liners                          |
| `dispose()`   | Multiple sequential runs before teardown                    |

## `run(input, options?): Promise<AgentResult>`

Run a task with the given input. Returns the result with output and metadata.

Options: `{ taskId?, history?, onApproval?, workspace?, skills? }`. `skills: { activate: [...] }` pins skills for this run only (needs `.withSkills()`; see [Agent Skills](/guides/agent-skills/)). `workspace` sets the
working directory for this run only (overrides `.withTools({ workspace })`; see
[Working directory](/guides/tools/scoping-and-policy/#working-directory-workspace)); a path that is
not an existing directory rejects the run before anything executes. With
`.withApprovalPolicy({ mode: "detach" })` and no durable runs, a gated tool call
**waits in process** until `approveRun`/`denyRun` (or `onApproval`) answers, then
the same run continues. On a durable agent with
`.withApprovalPolicy({ mode: "detach" })`, a gated tool call **pauses**: the
result carries `status: "awaiting-approval"` + `pendingApproval` (resume with
`approveRun`/`denyRun`). A paused result has `success: false` and no
`terminatedBy`: the run has not ended. The run's `workspace` is stored with the
durable run, so the resumed run works in the same directory. Pass `onApproval` to decide every gated call
in this one call — `(pending) => boolean | { approve, reason }` (sync or async);
it answers the live wait, or drives the durable pause→decide→resume loop, and
`run()` returns the final result. See [Human-in-the-loop](/guides/durable-hitl/).

## `runStream(input, options?): AsyncGenerator<AgentStreamEvent>`

Token and phase streaming. Options: `{ density?: "tokens" | "full", signal?: AbortSignal, workspace?: string, skills?: { activate?: string[] } }`. `skills` pins skills for this turn, the same as `run()`. Default density comes from `.withStreaming()` or `"tokens"`. Ends with `StreamCompleted`, `StreamError`, or `StreamCancelled`. An invalid `workspace` ends the stream with one `StreamError`. A run waiting live for a person emits `ApprovalRequested` (`runId`, `gateId`, `toolName`, `args`) at either density and keeps the stream open; answer with `approveRun`/`denyRun` and the same stream continues (`stop()` or `terminate()` while waiting denies the call or cancels the run). A durable run that pauses ends with a `StreamCompleted` carrying `status: "awaiting-approval"` (or `"awaiting-interaction"`), `pendingApproval` / `pendingInteraction`, `success: false` and no `terminatedBy`, the same as `run()`. `StreamCompleted.evidenceDelta` matches `AgentResult.evidenceDelta`.

Chat turns take a per-turn `workspace` as well: `chat(msg, { useTools: true, workspace })` and `session.runStream(msg, { workspace })` (tool and streaming paths).

`AgentResult.evidenceDelta` is the new evidence the run produced: the sum of its kernel assessments' `evidenceDelta` (`0` = none; absent when the run never assessed). A tool-path `ChatReply` carries `goalAchieved`, `outstandingCriteria` and `evidenceDelta` from its run, so `goalRunOf(reply)` works on a chat turn. A tool-path `ChatReply` from a durable run that paused carries `status` (`"awaiting-approval"` or `"awaiting-interaction"`) and `pendingApproval` / `pendingInteraction`, like a paused `StreamCompleted`. Check `reply.status` before you treat `reply.message` as a final answer.

## `runEffect(input: string, options?: { taskId?, workspace? }): Effect.Effect<AgentResult, Error>`

Run a task as an Effect for composition (see [Effect-TS primer](/concepts/effect-ts/)).

## `streamObject(input): AsyncGenerator<{ object: DeepPartial<T> }>`

Stream typed structured output field-by-field as it fills in. Requires `.withOutputSchema()`. Each yield carries a deep-partial of the schema type; the final yield is the validated object. See [Typed Structured Output](/guides/structured-output/).

## `health(): Promise<HealthResult>`

Requires `.withHealthCheck()` to be enabled.

Returns a structured health snapshot of all agent subsystems. Use for readiness probes, liveness checks, and monitoring dashboards.

```typescript
const health = await agent.health()
console.log(health.status) // "healthy" | "degraded" | "unhealthy"

for (const check of health.checks) {
    console.log(`${check.name}: ${check.status} — ${check.message}`)
}
```

```typescript
interface HealthResult {
    status: 'healthy' | 'degraded' | 'unhealthy'
    checks: Array<{
        name: string
        status: 'pass' | 'warn' | 'fail'
        message?: string
        durationMs?: number
    }>
}
```

## `cancel(taskId: string): Promise<void>`

Cancel a running task by its ID.

## `getContext(taskId: string): Promise<unknown>`

Get the execution context of a running or completed task.

## Lifecycle Control

Requires `.withKillSwitch()` to be enabled.

| Method              | Signature                           | Description                                                                   |
| ------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `pause()`           | `() => Promise<void>`               | Pause execution at the next phase boundary. Blocks until `resume()` is called |
| `resume()`          | `() => Promise<void>`               | Resume a paused agent                                                         |
| `stop(reason)`      | `(reason: string) => Promise<void>` | Stop the run within ~100 ms, even mid-model-call or mid-loop. Emits `AgentStopping` + `AgentStopped`; `run()` rejects with `KillSwitchTriggeredError` |
| `terminate(reason)` | `(reason: string) => Promise<void>` | Immediate termination: aborts the run signal (in-flight requests that forward it are cut) and triggers the kill switch. `AgentTerminated` is published before `terminate()` resolves, so disposing right after still delivers it |

`stop()` and `terminate()` both end the run without a result. `stop()` is observed by a lifecycle poll inside every guarded phase (the reasoning loop included), so its latency is bounded by that poll (~100 ms) plus the time the interrupted step takes to unwind. `terminate()` interrupts at once through the abort signal.

## Event Subscription

Requires an EventBus to be wired (any feature that enables it, e.g., `.withObservability()`).

`subscribe` is overloaded — pass a tag for type-narrowed access, or omit it for a catch-all:

```typescript
// ── Tag-filtered: event is narrowed to the exact payload type ──────────────
const unsub = await agent.subscribe('AgentCompleted', (event) => {
    // TypeScript knows event has: taskId, agentId, success, totalIterations,
    // totalTokens, durationMs — no _tag check, no cast needed
    console.log(`Done in ${event.durationMs}ms, ${event.totalTokens} tokens`)
})
unsub()

// ── Catch-all: receives the full AgentEvent union ──────────────────────────
const unsub2 = await agent.subscribe((event) => {
    // Discriminate via event._tag when handling multiple types in one handler
    if (event._tag === 'ToolCallStarted') console.log(`Tool: ${event.toolName}`)
    if (event._tag === 'LLMRequestStarted') console.log(`Model: ${event.model}`)
})
unsub2()
```

TypeScript signatures:

<!-- docs-skip-typecheck -->
```typescript
// Tag-filtered — event type is automatically narrowed
subscribe<T extends AgentEventTag>(
  tag: T,
  handler: (event: Extract<AgentEvent, { _tag: T }>) => void,
): Promise<() => void>;

// Catch-all — full AgentEvent union
subscribe(handler: (event: AgentEvent) => void): Promise<() => void>;
```

The `AgentEventTag` and `TypedEventHandler<T>` helpers are exported from `@reactive-agents/core` for use in your own service code:

<!-- docs-skip-typecheck -->
```typescript
import { Effect } from 'effect'
import type { AgentEventTag, TypedEventHandler } from '@reactive-agents/core'

// Build a typed handler outside of an inline callback
const onStepComplete: TypedEventHandler<'ReasoningStepCompleted'> = (event) => {
    // event.thought, event.action, event.observation — all typed
    return Effect.log(`Step ${event.step}: ${event.thought ?? event.action}`)
}

yield * eventBus.on('ReasoningStepCompleted', onStepComplete)
```

**Subscribable event tags:**

| Tag                          | Payload fields                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `AgentStarted`               | `taskId`, `agentId`, `provider`, `model`, `timestamp`                              |
| `AgentCompleted`             | `taskId`, `agentId`, `success`, `totalIterations`, `totalTokens`, `durationMs`     |
| `LLMRequestStarted`          | `taskId`, `requestId`, `model`, `provider`, `contextSize`                          |
| `LLMRequestCompleted`        | `taskId`, `requestId`, `tokensUsed`, `durationMs`                                  |
| `ReasoningStepCompleted`     | `taskId`, `strategy`, `step`, `thought\|action\|observation`                       |
| `ToolCallStarted`            | `taskId`, `toolName`, `callId`                                                     |
| `ToolCallCompleted`          | `taskId`, `toolName`, `callId`, `success`, `durationMs`                            |
| `FinalAnswerProduced`        | `taskId`, `strategy`, `answer`, `iteration`, `totalTokens`                         |
| `GuardrailViolationDetected` | `taskId`, `violations`, `score`, `blocked`                                         |
| `ExecutionPhaseEntered`      | `taskId`, `phase`                                                                  |
| `ExecutionPhaseCompleted`    | `taskId`, `phase`, `durationMs`                                                    |
| `ExecutionHookFired`         | `taskId`, `phase`, `timing`                                                        |
| `ExecutionCancelled`         | `taskId` — also published once when a `runStream()` is aborted (signal, `terminate()`, or the consumer stops reading) before the run ended |
| `MemoryBootstrapped`         | `agentId`, `tier`                                                                  |
| `MemoryFlushed`              | `agentId`                                                                          |
| `AgentPaused`                | `agentId`, `taskId`                                                                |
| `AgentResumed`               | `agentId`, `taskId`                                                                |
| `AgentStopped`               | `agentId`, `taskId`, `reason`                                                      |
| `TaskCompleted`              | `taskId`, `success`                                                                |
| `GatewayStarted`             | `agentId`, `timestamp`                                                             |
| `GatewayStopped`             | `agentId`, `reason`                                                                |
| `GatewayEventReceived`       | `agentId`, `eventId`, `source`, `category`                                         |
| `ProactiveActionInitiated`   | `agentId`, `eventId`, `action`                                                     |
| `ProactiveActionCompleted`   | `agentId`, `eventId`, `success`, `durationMs`                                      |
| `ProactiveActionSuppressed`  | `agentId`, `eventId`, `reason`                                                     |
| `PolicyDecisionMade`         | `agentId`, `eventId`, `action`, `policyTag`                                        |
| `HeartbeatSkipped`           | `agentId`, `consecutiveSkips`, `reason`                                            |
| `EventsMerged`               | `agentId`, `mergedCount`, `mergeKey`                                               |
| `BudgetExhausted`            | `agentId`, `tokensUsed`, `dailyBudget`                                             |
| `StrategySwitchEvaluated`    | `taskId`, `fromStrategy`, `recommendedStrategy`, `rationale`, `willSwitch`         |
| `StrategySwitched`           | `taskId`, `fromStrategy`, `toStrategy`, `switchNumber`, `stepsCarriedOver`         |
| `ProviderFallbackActivated`  | `taskId`, `fromProvider`, `toProvider`, `reason`, `attemptNumber`                  |
| `DebriefCompleted`           | `taskId`, `agentId`, `debrief`                                                     |
| `ChatTurn`                   | `taskId`, `sessionId`, `role`, `content`, `routedVia`, `tokensUsed?`               |
| `MemorySnapshot`             | `taskId`, `iteration`, `working`, `episodicCount`, `semanticCount`, `skillsActive` |
| `ContextPressure`            | `taskId`, `utilizationPct`, `tokensUsed`, `tokensAvailable`, `level`               |
| `TokenUsage`                 | `callId`, `tokensTotal`, `tokensIn?`, `tokensOut?`, `estimated`, `cacheReadTokensIn?`, `cacheCreationTokensIn?`, `model`, `provider`, `durationMs`, `costUsd`, `iteration?` |
| `AgentHealthReport`          | `agentId`, `status`, `checks[]`, `uptimeMs`                                        |
| `AgentConnected`             | `agentId`, `runId`, `cortexUrl`                                                    |
| `AgentDisconnected`          | `agentId`, `runId`, `reason`                                                       |
