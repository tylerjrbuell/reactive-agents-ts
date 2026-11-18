# @reactive-agents/compose

> Prebuilt killswitches that stop or terminate a Reactive Agents run when an iteration, token, cost, time, progress or tool-approval limit is crossed.

> **Stability:** stable (scoped). The killswitches (`maxIterations`, `budgetLimit`, `timeoutAfter`, `watchdog`, `requireApprovalFor`), `RunHandle` and the `.compose()` callback form are stable; `.withBudget` and the `HarnessConfig` fields of `.withHarness({ ... })`, which keep growing, are unstable and may change between `0.x` minors. See the [stability policy](https://docs.reactiveagents.dev/reference/stability/).

[![npm](https://img.shields.io/npm/v/@reactive-agents/compose?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/compose)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/reference/compose-api/)

## Install

```bash
bun add @reactive-agents/compose
# or: npm install @reactive-agents/compose
```

The `reactive-agents` facade also exposes these under `reactive-agents/compose/killswitches`.

## Usage

Each killswitch is a factory returning `(harness: Harness) => void`. Pass it to the builder's `.compose()`:

```ts
import { ReactiveAgents } from "reactive-agents";
import { maxIterations, budgetLimit, timeoutAfter } from "@reactive-agents/compose";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic") // needs ANTHROPIC_API_KEY
  .compose(maxIterations(10))                      // stop after 10 think loops
  .compose(budgetLimit({ maxTokens: 50_000 }))     // stop when the token budget is spent
  .compose(timeoutAfter({ wallClock: "60s" }))     // stop after 60 seconds
  .build();
```

Every killswitch takes `onTrigger: "stop" | "terminate"` (default `"stop"`): `stop` ends the run gracefully, `terminate` ends it hard. `requireApprovalFor` uses `onDeny` for the same choice.

## API

| Export | Use it when |
|---|---|
| `maxIterations(max \| { max, onTrigger? })` | You want a hard cap on reasoning iterations. |
| `budgetLimit({ maxTokens?, maxCostUSD?, costPerToken?, onTrigger? })` | You want to stop on token or cost spend. Cost uses the run meter when present, else `costPerToken` (default `0.000001`). |
| `timeoutAfter({ wallClock, onTrigger? })` | You want a wall-clock deadline (`"60s"`, `"5m"`, `"1h"` or milliseconds). |
| `watchdog({ noProgressFor, onTrigger? })` | You want to stop a run that makes no progress (no completed tool batch or LLM exchange) for a window. |
| `requireApprovalFor({ tools, approver, onDeny? })` | Named tools must pass a synchronous `approver` before they run; a denial aborts the run. |
| `killswitches.list()` | You want the registered killswitch names. |

Option types: `MaxIterationsOptions`, `BudgetLimitOptions`, `TimeoutAfterOptions`, `WatchdogOptions`, `RequireApprovalForOptions`. The factories are also exported from `@reactive-agents/compose/killswitches`.

## Limitations

- Limits are checked at phase boundaries (before `think`, before `act`), so a run can overshoot a limit by up to one phase.
- `requireApprovalFor` approvers are synchronous. For async approval, resolve it before building the killswitch.

## Documentation

- [Compose API reference](https://docs.reactiveagents.dev/reference/compose-api/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
