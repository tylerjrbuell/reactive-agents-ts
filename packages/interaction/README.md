# @reactive-agents/interaction

Interaction modes for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Gives agents 5 levels of autonomy — from fully autonomous to human-in-the-loop collaborative — with dynamic transitions based on confidence and cost.

## Installation

```bash
bun add @reactive-agents/interaction effect
```

## The 5 Modes

| Mode | Autonomy | When it activates |
|------|----------|------------------|
| `autonomous` | Full — no interruptions | High confidence, routine tasks |
| `supervised` | Periodic checkpoints | Moderate confidence |
| `collaborative` | Human decides key steps | Complex or ambiguous tasks |
| `consultative` | Human approves before acting | High-cost or risky operations |
| `interrogative` | Human provides all direction | Information gathering only |

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withInteraction({
    defaultMode: "supervised",
    onCheckpoint: async (ctx) => {
      // Called when agent wants human approval
      console.log("Agent wants to: ", ctx.proposedAction);
      return { approved: true };
    },
  })
  .build();
```

Modes transition automatically — an autonomous agent escalates to `consultative` if it detects a high-cost operation, then de-escalates when confidence recovers.

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts/guides/interaction-modes/](https://tylerjrbuell.github.io/reactive-agents-ts/guides/interaction-modes/)
