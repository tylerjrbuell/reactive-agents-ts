---
name: interaction-autonomy
description: Configure one of 5 human-agent interaction modes (autonomous through interrogative) and implement mode-switching, approval gates, and collaborative workflows.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Interaction and Autonomy

## Agent objective

Produce a builder with `.withInteraction()` enabled and the correct initial mode configured, with guidance on how to switch modes at runtime and handle approval checkpoints.

## When to load this skill

- Configuring how much autonomy an agent has vs. how much human oversight is required
- Building a supervised agent that pauses for approval at key decision points
- Implementing a collaborative mode where agent and user work together in real-time
- Switching modes dynamically based on task risk or user preference

## The 5 interaction modes

| Mode | Description | Use when |
|------|-------------|----------|
| `"autonomous"` | Fire-and-forget — agent runs independently | Trusted automation, scheduled tasks |
| `"supervised"` | Agent pauses at milestones for human approval | High-stakes actions, untrusted environments |
| `"collaborative"` | Real-time back-and-forth with the user | Creative work, exploration, complex tasks |
| `"consultative"` | Agent observes and provides suggestions | Advisory bots, decision support |
| `"interrogative"` | User drills into agent state and reasoning | Debugging, transparency, audit |

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

// Supervised agent — pauses at milestones for approval
const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 20 })
  .withTools({ allowedTools: ["web-search", "file-read", "file-write", "checkpoint"] })
  .withInteraction()   // enables interaction layer with all 5 modes
  .withSystemPrompt(`
    You are operating in supervised mode.
    Before writing any files, checkpoint your plan and wait for approval.
  `)
  .build();
```

## Key patterns

### Enabling interaction

```ts
.withInteraction()
// Enables the InteractionManager, ModeSwitcher, NotificationService,
// CheckpointService, CollaborationService, and PreferenceLearner.
// Default mode: "autonomous"
```

### Mode usage

```ts
// "autonomous" — agent runs to completion without interruption
// Best for: background tasks, cron jobs, trusted pipelines
const agent = ReactiveAgents.create()
  .withInteraction()
  .withSystemPrompt("Complete the task without interruption.")
  .build();

// "supervised" — agent must receive approval before continuing past checkpoints
// Best for: production deployments, high-risk tool calls
const agent = ReactiveAgents.create()
  .withInteraction()
  .withGuardrails()
  .withBehavioralContracts({ requireApprovalFor: ["file-write", "send-email"] })
  .build();

// "collaborative" — agent and user exchange messages during execution
// Best for: interactive chat, pair programming workflows

// "consultative" — agent surfaces observations and suggestions
// Best for: advisory dashboards, recommendation engines

// "interrogative" — user can query agent state mid-execution
// Best for: debugging, explainability, audit
```

### Accessing InteractionManager at runtime

```ts
import { InteractionManager } from "@reactive-agents/interaction";
import { Effect } from "effect";

// Switch mode at runtime (e.g., escalate from autonomous to supervised):
const program = Effect.gen(function* () {
  const manager = yield* InteractionManager;
  yield* manager.switchMode(agentId, "supervised");
  const currentMode = yield* manager.getMode(agentId);
  console.log("Now in mode:", currentMode);
});
```

### Approval checkpoints in supervised mode

In `"supervised"` mode, the agent can pause and request human approval:

```ts
// System prompt instructs the agent to use the checkpoint tool:
.withSystemPrompt(`
  When you are about to take an irreversible action (file writes, API calls),
  use the checkpoint tool to save your plan and pause for review.
  Only proceed after receiving confirmation.
`)
.withTools({ allowedTools: ["checkpoint", "file-read", "file-write"] })
.withInteraction()
```

The checkpoint tool (`SAVE` mode) records state; the approval flow is handled by your application layer reading the checkpoint and calling `agent.resume()`.

### Combining with kill switch for mode transitions

```ts
const agent = ReactiveAgents.create()
  .withInteraction()
  .withKillSwitch()  // enables pause/resume for approval gates
  .build();

const handle = agent.run(task);

// Pause for approval:
await handle.pause();
// ... user reviews ...
await handle.resume();
```

## Builder API reference

| Method | Notes |
|--------|-------|
| `.withInteraction()` | Enables the full interaction layer (all 5 modes) |
| `.withKillSwitch()` | Enables pause/resume/stop for approval gates (recommended with supervised mode) |

## Pitfalls

- `.withInteraction()` enables the layer but does not set the initial mode — the agent defaults to `"autonomous"` unless the system prompt or runtime code switches it
- Mode switching is per-agent-ID — ensure the correct `agentId` is used when calling `InteractionManager.switchMode()`
- `"supervised"` mode without `.withKillSwitch()` means approval checkpoints can be described in the system prompt but cannot programmatically pause execution — pair them together
- Default approval timeout in `InteractionManager` is 5 minutes — if no approval arrives, the agent proceeds or times out based on policy
- `"collaborative"` and `"interrogative"` modes require a live communication channel between the agent and the user — these modes are designed for real-time UI integrations (see ui-integration skill)
