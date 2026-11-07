# @reactive-agents/reactive-intelligence

Metacognitive layer for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

Real-time entropy sensing, adaptive intervention dispatch, and local learning. Monitors agent reasoning quality every iteration through 5 entropy sources, triggers interventions (early-stop, strategy switch, tool-failure redirect) when the agent is struggling, and learns from outcomes via conformal calibration, Thompson Sampling, and skill synthesis.

## Installation

```bash
bun add @reactive-agents/reactive-intelligence
```

Or via the umbrella:

```bash
bun add reactive-agents
```

## Quick Example

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("smart-agent")
  .withProvider("anthropic", { model: "claude-sonnet-4-6" })
  .withReasoning()
  .withReactiveIntelligence()
  .build();

const result = await agent.run("Analyze market trends for Q1 2026");
// EntropyScored events publish per iteration
// ReactiveDecision events fire when an intervention dispatches
```

## Architecture

### Entropy Sensor — 5 sources

| Source                | What it measures                                              | Module                            |
| --------------------- | ------------------------------------------------------------- | --------------------------------- |
| Token entropy         | LLM confidence from logprobs                                  | `computeTokenEntropy`             |
| Structural entropy    | Format compliance, hedge words, thought density               | `computeStructuralEntropy`        |
| Semantic entropy      | Task alignment, novelty, repetition (centroid-based)          | `computeSemanticEntropy`          |
| Behavioral entropy    | Tool reuse, action diversity, loop detection                  | `computeBehavioralEntropy`        |
| Context pressure      | Context-window utilization and overflow risk                  | `computeContextPressure`          |

`computeCompositeEntropy` blends them with adaptive weights per model. `computeEntropyTrajectory` classifies trends as **converging**, **flat**, **diverging**, **oscillating**, or **v-recovery**.

### Reactive Controller — interventions

Consumes entropy scores and dispatches interventions through `InterventionDispatcherService`. Three interventions ship, each with a handler whose effect reaches the run:

- **early-stop** — ends a run whose entropy has converged, or a spinning run near its iteration cap (stands down while the run still produces evidence)
- **switch-strategy** — escalates a flat, high-entropy loop the kernel already redirected; only proposed when strategy switching is enabled and not exhausted
- **tool-failure-redirect** — nudges the model after a same-tool failure streak; ends the run only if the model then repeats the identical failing call

Every decision is published as a `ReactiveDecision` event. A run-wide census (2026-11-06) removed temperature-adjust, context-compression, tool-injection, skill-activation, stall-detect and harness-harm: none of them changed a run.

Custom intervention handlers register via `registerHandler()`; the default registry lives in `defaultInterventionRegistry`.

> **Note:** Earlier 0.10.x builds shipped `createReactiveIntelligenceLayer` without the dispatcher service wired in (resulting in 0 dispatches). v0.10.2 includes the fix — the dispatcher is part of the default layer.

### Learning Engine

- **Conformal calibration** — `computeConformalThreshold` adjusts entropy thresholds to the specific model using prior observations; `CalibrationStore` persists per-model state
- **Community profiles** — `fetchCommunityProfile` pulls shared baselines (opt-in) so users start with reasonable thresholds
- **Thompson Sampling bandit** — `BanditStore` + `selectArm` / `updateArm` learn which strategies (ReAct, Plan-Execute, ToT, Reflexion) work best per task category
- **Task classifier** — `classifyTaskCategory` maps inputs to category labels for the bandit
- **Skill synthesis** — `extractSkillFragment` mines successful runs into reusable skill fragments (`SkillFragment`)

### Telemetry Client

Opt-in HMAC-signed telemetry (`TelemetryClient`, `signPayload`, `getOrCreateInstallId`) reports anonymized run metrics to improve community calibration profiles. Fire-and-forget; never blocks the agent.

### Skill Layer

`SkillResolverService` resolves which skills apply to a task; `SkillDistillerService` produces new skills from runs. `resolve()` returns the catalog and an `activatable` map with the same names, so every skill the catalog offers can be loaded with `activate-skill`. Filesystem skills carry their directory; learned skills carry their stored body and no directory.

## Direct Service Usage

```typescript
import { Effect } from "effect";
import {
  EntropySensorServiceLive,
  ReactiveControllerServiceLive,
  InterventionDispatcherServiceLive,
  LearningEngineServiceLive,
  createReactiveIntelligenceLayer,
} from "@reactive-agents/reactive-intelligence";
```

## Key Features

- **5-source entropy scoring** — composite signal with adaptive weights per model
- **Trajectory analysis** — 5 trend classifications with stable detection
- **Pre-calibrated model registry** — `MODEL_REGISTRY` ships baselines for Claude (Sonnet, Haiku), GPT-4, Gemini, Ollama (qwen3, cogito, llama variants)
- **EventBus-driven** — `EntropyScored`, `ContextWindowWarning`, `CalibrationDrift`, `ReactiveDecision` events publish through `@reactive-agents/core` `EventBus`
- **Zero-config** — `.withReactiveIntelligence()` enables sensing + control + learning with sensible defaults

## Key Exports

| Export                                                                 | Purpose                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------ |
| `createReactiveIntelligenceLayer`                                      | Factory for the runtime layer                    |
| `EntropySensorServiceLive`                                             | Composite entropy sensor                         |
| `ReactiveControllerService`, `ReactiveControllerServiceLive`           | Decision-making loop                             |
| `InterventionDispatcherService`, `InterventionDispatcherServiceLive`   | Intervention registry + dispatcher               |
| `LearningEngineService`, `LearningEngineServiceLive`                   | Calibration + bandit + skill synthesis           |
| `TelemetryClient`, `signPayload`, `getOrCreateInstallId`               | Opt-in telemetry pipeline                        |
| `BanditStore`, `selectArm`, `updateArm`                                | Thompson Sampling primitives                     |
| `CalibrationStore`, `computeCalibration`, `computeConformalThreshold`  | Per-model threshold calibration                  |
| `MODEL_REGISTRY`, `lookupModel`                                        | Pre-calibrated model baselines                   |
| `SkillResolverService`, `SkillDistillerService`                        | Skill resolution + distillation                  |
| `defaultInterventionRegistry`, `registerHandler`                       | Custom intervention handlers                     |

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Reactive intelligence guide: [docs.reactiveagents.dev/guides/reactive-intelligence/](https://docs.reactiveagents.dev/guides/reactive-intelligence/)

## License

MIT
