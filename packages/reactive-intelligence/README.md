# @reactive-agents/reactive-intelligence

> Entropy sensing and an intervention controller that watch each reasoning step and stop or redirect agents that are struggling.

> **Stability:** experimental. Entropy thresholds, scoring functions and the calibration schema may change in any release.

## Install

```bash
bun add @reactive-agents/reactive-intelligence
# or: npm install @reactive-agents/reactive-intelligence
```

The `reactive-agents` facade (`bun add reactive-agents`) re-exports the builder that enables this package.

## Usage

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("smart-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning()
  .withReactiveIntelligence()
  .build();

const result = await agent.run("Summarize the trade-offs of event sourcing");
// EntropyScored events publish per iteration.
// ReactiveDecision events fire when the controller decides on an intervention.
```

What it does:

- **Entropy sensor.** Scores each step from token, structural, semantic, behavioral and context-pressure sources, blended per model. Higher means more uncertain.
- **Controller.** Proposes interventions through `InterventionDispatcherService`: `early-stop`, `switch-strategy` (only when strategy switching is enabled) and `tool-failure-redirect`. Interventions only take effect through the kernel's reactive observer.
- **Learning.** Per-model calibration (`CalibrationStore`), a strategy bandit (`BanditStore`) and skill synthesis. Telemetry is opt-in.

Controller options, tuning and the event list: [Reactive Intelligence](https://docs.reactiveagents.dev/features/reactive-intelligence/).

## API

| Export | Use it when |
|---|---|
| `createReactiveIntelligenceLayer` | You build the runtime layer yourself |
| `EntropySensorServiceLive` | You score entropy outside the builder |
| `ReactiveControllerService`, `ReactiveControllerServiceLive` | You evaluate controller decisions |
| `InterventionDispatcherService`, `defaultInterventionRegistry`, `registerHandler` | You add or inspect intervention handlers |
| `LearningEngineService`, `CalibrationStore`, `BanditStore` | You use calibration or the strategy bandit |
| `MODEL_REGISTRY`, `lookupModel` | You read per-model baselines |
| `SkillResolverService`, `SkillDistillerService` | You resolve or distill skills |
| `TelemetryClient` | You inspect the opt-in telemetry pipeline |

## Documentation

- [Reactive Intelligence](https://docs.reactiveagents.dev/features/reactive-intelligence/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
