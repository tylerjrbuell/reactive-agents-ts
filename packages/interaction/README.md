# @reactive-agents/interaction

> Interaction modes, checkpoints and approval-pattern learning for agents that sometimes need a human, built as Effect services.

> **Stability:** unstable. Not listed as stable in the stability reference; the service shapes may change between minors.

## Install

```bash
bun add @reactive-agents/interaction
# or: npm install @reactive-agents/interaction
```

The facade (`bun add reactive-agents`) re-exports this package.

## Usage

The five modes are standalone Effect services. They do not intercept tool calls. For approval gates the builder enforces on runs, use `.withApprovalPolicy()` and `.withUserInteraction()` (see the durable approval guide below).

```ts
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { InteractionManager, createInteractionLayer } from "@reactive-agents/interaction";

const program = Effect.gen(function* () {
  const interaction = yield* InteractionManager;
  yield* interaction.switchMode("agent-1", "supervised");
  return yield* interaction.getMode("agent-1");
});

const layer = createInteractionLayer().pipe(Layer.provide(EventBusLive));
console.log(await Effect.runPromise(program.pipe(Effect.provide(layer))));
```

Modes: `autonomous`, `supervised`, `collaborative`, `consultative`, `interrogative`. Transitions follow `ModeTransitionRule` and `EscalationCondition` settings in `InteractionConfig`.

## API

| Export | Use it when |
|---|---|
| `createInteractionLayer` | You provide all interaction services to an Effect program (needs `EventBus`) |
| `InteractionManager` | You want the top-level orchestrator for modes, notifications and checkpoints |
| `ModeSwitcher` | You switch or evaluate modes only |
| `CheckpointService` | You create and resolve approval checkpoints |
| `NotificationService` | You send and read notifications |
| `CollaborationService` | You run bidirectional agent and human sessions |
| `PreferenceLearner` | You learn which actions a user auto-approves |
| `InteractionError`, `ModeError`, `CheckpointError` | You handle tagged errors |

## Documentation

- [Interaction](https://docs.reactiveagents.dev/features/interaction/)
- [Durable approval (HITL)](https://docs.reactiveagents.dev/guides/durable-hitl/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
