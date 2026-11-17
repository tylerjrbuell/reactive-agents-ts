# @reactive-agents/cost

> Cost control for Reactive Agents: complexity routing, semantic caching, and budget enforcement for TypeScript agents.

> **Stability:** unstable. `.withCostTracking()` on the builder is stable; the routing primitives exported here are not yet a builder policy and may change.

## Install

```bash
bun add @reactive-agents/cost
# or: npm install @reactive-agents/cost
```

The facade (`bun add reactive-agents`) re-exports this package.

## Usage

Enable spend tracking and budgets from the builder:

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("budget-agent")
  .withProvider("anthropic")
  .withCostTracking({ perRequest: 0.1, perSession: 1, daily: 5, monthly: 50 }) // USD
  .build();

const result = await agent.run("Summarize this document");
console.log(result.metadata.cost);
```

Use the routing primitives directly:

```ts
import { Effect } from "effect";
import { analyzeComplexity } from "@reactive-agents/cost";

const analysis = await Effect.runPromise(analyzeComplexity("Write a binary search tree in Rust"));
console.log(analysis.recommendedTier); // "haiku" | "sonnet" | "opus"
```

Omitted budget levels are not enforced beyond the framework defaults.

## API

| Export | Use it when |
|---|---|
| `CostService`, `CostServiceLive`, `createCostLayer` | You compose cost management into an Effect runtime |
| `analyzeComplexity`, `routeToModel` | You classify a task and pick a model tier |
| `estimateCost`, `estimateTokens` | You price a call before making it |
| `makeBudgetEnforcer`, `makeBudgetDb` | You enforce per-request, per-session, daily and monthly limits |
| `makeCostTracker` | You accumulate token and USD spend |
| `makeSemanticCache` | You cache responses by embedding similarity |
| `makePromptCompressor` | You shrink context-heavy requests |
| `BudgetExceededError`, `RoutingError` | You handle tagged cost errors |

## Documentation

- [Cost tracking](https://docs.reactiveagents.dev/features/cost-tracking/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+. Daily and monthly budgets persist to SQLite.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
