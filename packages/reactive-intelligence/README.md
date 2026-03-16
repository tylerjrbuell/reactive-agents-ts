# @reactive-agents/reactive-intelligence

Reactive intelligence layer for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

Real-time entropy sensing, adaptive control, and local learning that monitors agent reasoning quality and intervenes automatically — triggering early stops, context compression, or strategy switches when the agent is struggling.

## Installation

```bash
bun add @reactive-agents/reactive-intelligence
```

Or install everything at once:

```bash
bun add reactive-agents
```

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("smart-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withReactiveIntelligence()
  .build();

const result = await agent.run("Analyze market trends for Q1 2026");
```

### Direct Service Usage

```typescript
import {
  EntropySensorServiceLive,
  ReactiveControllerServiceLive,
  LearningEngineServiceLive,
  createReactiveIntelligenceLayer,
} from "@reactive-agents/reactive-intelligence";
```

## Architecture

### Entropy Sensor

Scores reasoning quality each iteration using 5 entropy sources:

| Source | What It Measures |
| --- | --- |
| Token entropy | LLM confidence from logprobs |
| Structural entropy | Format compliance, hedge words, thought density |
| Semantic entropy | Task alignment, novelty, repetition |
| Behavioral entropy | Tool reuse, action diversity, loop detection |
| Context pressure | Context window utilization and overflow risk |

### Reactive Controller

Consumes entropy scores and makes real-time decisions:

- **Early stop** — halt when entropy is consistently low (agent is confident)
- **Context compression** — trigger compaction when context pressure is high
- **Strategy switch** — switch reasoning strategy when the current one is looping

### Learning Engine

Improves agent performance over time without additional prompting:

- **Conformal calibration** — adjusts entropy thresholds to the specific model
- **Thompson Sampling bandit** — learns which strategies work best per task category
- **Skill synthesis** — extracts reusable skill fragments from successful runs

### Telemetry Client

Opt-in telemetry that reports anonymized run metrics (HMAC-signed, fire-and-forget) to improve the framework.

## Key Features

- **5-source entropy scoring** — composite signal with adaptive weights per model
- **Trajectory analysis** — classifies entropy trends as converging, flat, diverging, oscillating, or v-recovery
- **Model registry** — pre-calibrated baselines for common models (Claude, GPT-4, Gemini, Ollama)
- **EventBus-driven** — entropy scores publish as events, no polling required
- **Zero config** — `.withReactiveIntelligence()` enables everything with sensible defaults

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
