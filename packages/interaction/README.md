# @reactive-agents/interaction

Interaction modes and human-in-the-loop primitives for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

Five autonomy modes, configurable checkpoints, approval gates, escalation rules, and a preference learner that adapts mode selection over time. Designed for agents that occasionally need human judgment — without forcing every run to be supervised.

## Installation

```bash
bun add @reactive-agents/interaction
```

Or via the umbrella:

```bash
bun add reactive-agents
```

## The 5 Modes

| Mode            | Autonomy                       | When it activates                  |
| --------------- | ------------------------------ | ---------------------------------- |
| `autonomous`    | Full — no interruptions        | High confidence, routine tasks     |
| `supervised`    | Periodic checkpoints           | Moderate confidence                |
| `collaborative` | Human decides key steps        | Complex or ambiguous tasks         |
| `consultative`  | Human approves before acting   | High-cost or risky operations      |
| `interrogative` | Human provides all direction   | Information gathering only         |

Modes transition automatically based on `ModeTransitionRule`s and `EscalationCondition`s — an autonomous agent can escalate to `consultative` when entropy spikes or estimated cost crosses a threshold, then de-escalate when confidence recovers.

## Quick Example

> **Builder integration (Wave 6.6 honesty note):** there is no
> `.withInteraction()` builder wither — the example below previously called
> one, which never existed. The 5 modes are standalone Effect services
> (composed directly, as below). For gates the *builder* enforces on runs,
> use `.withApprovalPolicy()` (per-tool approval, block or detach mode) and
> `.withUserInteraction()` (durable `request_user_input` pauses) — those ride
> the kernel approval gate; the mode services here do not intercept tool calls.

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic", { model: "claude-sonnet-4-6" })
  .withApprovalPolicy({
    tools: ["file-write", "file-delete"],
    onApprove: async ({ toolName }) => ({ approved: await askHuman(toolName) }),
  })
  .build();
```

## Direct Service Usage

```typescript
import { Effect } from "effect";
import {
  InteractionManager,
  InteractionManagerLive,
  CheckpointService,
  ModeSwitcher,
} from "@reactive-agents/interaction";

const program = Effect.gen(function* () {
  const interaction = yield* InteractionManager;
  const switcher = yield* ModeSwitcher;

  yield* switcher.switchTo("collaborative", { reason: "user-requested" });
  const decision = yield* interaction.requestApproval({
    action: "delete-file",
    path: "/tmp/x",
  });
  return decision;
});
```

## Preference Learning

The `PreferenceLearner` records approval/rejection patterns and surfaces them as `UserPreference` records that can bias future mode selection — e.g. learning that the user always approves `web-search` calls but always wants to confirm filesystem writes.

```typescript
import { PreferenceLearner } from "@reactive-agents/interaction";

const prefs = yield* PreferenceLearner;
yield* prefs.record({
  action: "web-search",
  decision: "approve",
  context: { agentId, taskId },
});
const tolerance = yield* prefs.getTolerance(); // InterruptionTolerance
```

## Key Exports

| Export                                            | Purpose                                          |
| ------------------------------------------------- | ------------------------------------------------ |
| `InteractionManager`, `InteractionManagerLive`    | Top-level orchestrator for modes + checkpoints   |
| `ModeSwitcher`, `ModeSwitcherLive`                | Programmatic mode transitions                    |
| `CheckpointService`, `CheckpointServiceLive`      | Approval-point persistence                       |
| `NotificationService`, `NotificationServiceLive`  | Multi-channel notifications                      |
| `CollaborationService`, `CollaborationServiceLive` | Bidirectional agent ↔ human messaging           |
| `PreferenceLearner`, `PreferenceLearnerLive`      | Approval-pattern learner                         |
| `createInteractionLayer`                          | Factory for the runtime layer                    |
| `InteractionModeType`, `Checkpoint`, `Notification`, `InterruptRule`, `CollaborationSession`, `UserPreference` | Schemas + types |
| `InteractionError`, `ModeError`, `CheckpointError`, `NotificationError`, `InputTimeoutError` | Tagged errors |

## Documentation

- Full docs: [docs.reactiveagents.dev/guides/interaction-modes/](https://docs.reactiveagents.dev/guides/interaction-modes/)

## License

MIT
