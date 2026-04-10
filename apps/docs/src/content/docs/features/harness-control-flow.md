---
title: Harness Control Flow
description: How the kernel's entropy sensor, reactive controller, and calibration system work together to guide agent reasoning.
sidebar:
  order: 7
---

The harness control flow is the real-time feedback loop that monitors and steers agent reasoning. It connects three systems — the **entropy sensor**, the **reactive controller**, and the **calibration store** — into a single evaluation pipeline that runs after every kernel iteration.

```
  Kernel Step → Entropy Sensor → Score History → Controller → Decisions
                   (5 sources)                    (10 evaluators)
                       ↓                               ↓
                 Calibration Store ←─── Learning Engine
                 (conformal thresholds)
```

## Pipeline Overview

After each Think/Act/Observe cycle, the **reactive observer** (`reactive-observer.ts`) runs two phases:

1. **Entropy scoring** — the latest thought is scored across 5 sources (token, structural, semantic, behavioral, context pressure). The composite score and trajectory are appended to `entropyHistory`.

2. **Controller evaluation** — the controller receives the full entropy history and calibrated thresholds, then runs 10 decision evaluators to determine whether action is needed.

This happens automatically when `.withReactiveIntelligence()` is enabled.

## Calibration Flow

The controller's decision quality depends on accurate thresholds. Without calibration, the system uses hardcoded defaults (convergence: 0.4, high-entropy: 0.8). With calibration data, thresholds adapt to each model's actual entropy distribution.

### How Calibrated Thresholds Reach the Controller

1. At each controller evaluation, the observer calls `EntropySensorService.getCalibration(modelId)`.
2. The sensor loads stored calibration from the `CalibrationStore` (SQLite-backed).
3. If calibration data exists (≥20 samples), the stored conformal thresholds are used. Otherwise, uncalibrated defaults are returned.
4. The controller evaluators use these thresholds for their decisions.

```typescript
// Automatic — no user code needed
// The observer loads calibration before every controller evaluation:
const calibration = await sensor.getCalibration(modelId);
// → { highEntropyThreshold: 0.72, convergenceThreshold: 0.35, calibrated: true, sampleCount: 25 }
```

### Persistent Calibration

By default, the calibration store uses an in-memory SQLite database. To persist calibration across runs:

```typescript
.withReactiveIntelligence({
  calibrationDbPath: "./data/calibration.sqlite",
  controller: { earlyStop: true },
})
```

Calibration data accumulates across agent runs, producing more accurate thresholds over time.

### Drift Detection

When a model's entropy distribution shifts significantly, the system detects **calibration drift** by comparing recent scores against the overall mean (±2σ). When drift is detected:

- A `CalibrationDrift` event is emitted via EventBus.
- The event includes the expected mean, observed mean, and deviation sigma.
- Downstream observers can use this to trigger recalibration or alerting.

```typescript
eventBus.subscribe("CalibrationDrift", (event) => {
  console.log(`Model ${event.modelId} drifted: expected=${event.expectedMean}, observed=${event.observedMean}`);
});
```

## Controller Evaluators

The reactive controller runs 10 decision evaluators in sequence. Each evaluator examines entropy signals and may produce a decision:

| Evaluator | Decision | Trigger |
|-----------|----------|---------|
| **Early Stop** | `early-stop` | Entropy converging for N iterations below convergence threshold |
| **Strategy Switch** | `switch-strategy` | Flat entropy trajectory suggesting current strategy is ineffective |
| **Context Compression** | `compress` | Context pressure exceeds compression threshold |
| **Temperature Adjust** | `temp-adjust` | Entropy too high or too low relative to calibrated thresholds |
| **Skill Activate** | `skill-activate` | Entropy pattern matches a known skill's activation profile |
| **Prompt Switch** | `prompt-switch` | Current prompt variant underperforming based on entropy signals |
| **Tool Inject** | `tool-inject` | Entropy pattern suggests a specific tool would help |
| **Memory Boost** | `memory-boost` | Switch from keyword to semantic memory retrieval |
| **Skill Reinject** | `skill-reinject` | Reactivate a previously successful skill |
| **Human Escalate** | `human-escalate` | All automated interventions exhausted |

## Decision Lifecycle

Controller decisions are:

1. **Published** as `ReactiveDecision` events on the EventBus for observability.
2. **Stored** on `KernelState.meta.controllerDecisions` for the termination oracle.
3. **Accumulated** in `controllerDecisionLog` for the `pulse` meta-tool to report.

The termination oracle checks for `early-stop` decisions and signals the kernel runner to exit the loop, potentially saving multiple iterations.

## Configuration

```typescript
.withReactiveIntelligence({
  entropy: {
    enabled: true,
    tokenEntropy: true,       // Requires logprob-capable provider
    semanticEntropy: true,    // Requires embedding provider
    trajectoryTracking: true, // Track entropy shape over time
  },
  controller: {
    earlyStop: true,          // Stop when entropy converges
    contextCompression: true, // Compact context under pressure
    strategySwitch: true,     // Switch strategy on flat entropy
  },
  calibrationDbPath: "./data/calibration.sqlite",
})
```

## Related

- [Reactive Intelligence](/features/reactive-intelligence/) — Full entropy sensor and learning engine documentation
- [Observability](/features/observability/) — EventBus tracing and structured logging
