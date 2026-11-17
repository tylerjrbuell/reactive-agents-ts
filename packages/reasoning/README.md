# @reactive-agents/reasoning

> Reasoning strategies and the composable kernel that runs the think, act, observe, verify loop for Reactive Agents.

> **Stability:** stable. `.withReasoning()` and the strategy names are stable; kernel internals (inner `KernelHooks` taps, the arbitrator, the strategy-switching heuristic) may change between minors.

## Install

```bash
bun add @reactive-agents/reasoning
# or: npm install @reactive-agents/reasoning
```

Most apps never import this package directly. `reactive-agents` (`bun add reactive-agents`) re-exports the builder, which wires reasoning for you. Install this one to call strategies or the kernel from your own Effect program.

## Usage

Enable reasoning through the builder (ReAct is the default strategy):

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning() // ReAct by default
  .withTools()
  .build();

const result = await agent.run("Analyze the trade-offs between TCP and UDP");
console.log(result.output);
```

Pick another strategy with `.withReasoning({ defaultStrategy: "reflexion" })`. ReAct is the default on every model tier. Heavier strategies cost more tokens and time on local models, with no measured quality gain in our tests. Which strategy fits which task: [Choosing a Reasoning Strategy](https://docs.reactiveagents.dev/guides/choosing-strategies/).

Strategy switching mid-run (when a loop is detected) is opt-in and off by default. See the reasoning guide for the option.

## API

| Export | Use it when |
|---|---|
| `executeReactive`, `executeReflexion`, `executePlanExecute`, `executeTreeOfThought`, `executeAdaptive` | You call a strategy directly from Effect code |
| `ReasoningService`, `ReasoningServiceLive` | You resolve strategies through the Effect service |
| `StrategyRegistry`, `StrategyRegistryLive` | You register or look up strategies |
| `arbitrate`, `applyTermination`, `arbitrateAndApply` | You work with the kernel's single termination decision |
| `defaultVerifier` | You run the default output checks on a candidate answer |
| `classifyToolRelevance` | You rank tools by relevance to a task |
| `CONTEXT_PROFILES`, `resolveProfile` | You need the per-tier context profiles |

The kernel (`think`, `act`, `observe`, `verify` capabilities, loop runner, state) is described in [The Composable Kernel](https://docs.reactiveagents.dev/concepts/composable-kernel/).

## Documentation

- [Reasoning guide](https://docs.reactiveagents.dev/guides/reasoning/)
- [Choosing a Reasoning Strategy](https://docs.reactiveagents.dev/guides/choosing-strategies/)
- [The Composable Kernel](https://docs.reactiveagents.dev/concepts/composable-kernel/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
