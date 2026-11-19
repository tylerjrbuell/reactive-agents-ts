---
title: Local Model Performance
description: >-
  Tier-specific tuning, calibration, and performance characteristics for local
  LLM providers.
sidebar:
  order: 13
topic: local-models
related:
  - guides/local-models
  - cookbook/local-agent-ollama
---

Reactive Agents adjusts parts of its behavior to the model it runs on. Local models (Ollama) have different entropy distributions, latency profiles, and context windows than frontier models (OpenAI, Anthropic, Google). This page lists what changes by tier and what stays the same.

## Model Tier Detection

The reactive-intelligence layer resolves a tier (`local`, `frontier`, or `unknown`) for each model in this order:

1. A built-in registry entry for the model ID (exact match, then prefix match). See [Model-Specific Considerations](#model-specific-considerations).
2. Your own entries in `.withReactiveIntelligence({ models: { ... } })`.
3. The provider name:

| Provider | Tier when the model is not in the registry |
|----------|------|
| Ollama | `local` |
| OpenAI | `frontier` |
| Anthropic | `frontier` |
| Google Gemini | `frontier` |
| LiteLLM, Groq, xAI, others | `unknown` (LiteLLM proxies many providers, so the tier cannot be inferred) |

Before calibration data exists, the tier sets the fallback entropy floor the intervention dispatcher uses: `0.12` for `local`, `0.45` for `frontier`, `0.25` for `unknown`. Once a model has 20 or more calibration samples, the floor is derived from that model's own calibrated threshold instead.

## Entropy Calibration for Local Models

Local models exhibit higher baseline entropy and wider score distributions. The conformal calibration system measures each model rather than assuming a fixed range:

- **Uncalibrated defaults**: convergence `0.4`, high-entropy `0.8`, used for every tier until a model has enough data.
- **Calibrated thresholds**: computed per model once it has 20 or more scored iterations.

### Building Calibration Data

Calibration accumulates automatically during normal agent use. Each entropy score is recorded and thresholds recompute via conformal quantiles:

- **High-entropy threshold**: 90th percentile of historical scores
- **Convergence threshold**: 70th percentile (looser bound)

To persist calibration across runs, provide a database path:

<!-- docs-skip-typecheck -->
```typescript
.withReactiveIntelligence({
  calibrationDbPath: "./data/calibration.sqlite",
})
```

### Monitoring Calibration Health

When a model's behavior shifts (e.g., after updating model weights), the system detects calibration drift and publishes a `CalibrationDrift` event:

<!-- docs-skip-typecheck -->
```typescript
const unsubscribe = await agent.subscribe("CalibrationDrift", (event) => {
  // event.modelId, event.expectedMean, event.observedMean, event.deviationSigma
  console.warn(`Calibration drift on ${event.modelId}: consider resetting calibration data`);
});
```

## Controller Behavior by Tier

### Early Stop

Early stop uses the same rule on every tier. It fires when the entropy trajectory has been converging for 2 consecutive iterations and the latest score is at or below the model's convergence threshold. It never fires before iteration 2, and it waits while the run has produced no output (except on the last allowed iteration). Within 2 iterations of the iteration cap, it also stops a run whose trajectory is flat, oscillating, or converging, unless that pass produced new evidence. The tier matters only through calibration: a noisier local model gets its own, measured convergence threshold.

### Context Pressure and Auto-Checkpoint

Local models often have smaller context windows than frontier models. The kernel uses the model's context-profile tier to decide when to save a checkpoint (soft threshold) and when to offer only the final-answer tool (hard threshold), as a fraction of the context window:

| Context-profile tier | Auto-checkpoint (soft) | Final answer only (hard) |
|--------|-------|----------|
| `local` | 0.75 | 0.80 |
| `mid` | 0.80 | 0.85 |
| `large` | 0.85 | 0.90 |
| `frontier` | 0.90 | 0.95 |

### Strategy Switching

When the entropy trajectory stays flat for 3 iterations with a high loop score, the controller may recommend switching strategies. The rule is the same on every tier. The switch only happens when you set `.withReasoning({ enableStrategySwitching: true })`. It is off by default. In a [2026-11-05 ablation](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md) on cogito:8b (2 tasks, 8 runs per task per arm, 32 runs), switching showed no accuracy lift (-6.2pp, within noise) and cost 28.1% more billed tokens. A first pass on qwen3:4b and cogito:8b (5 tasks, 3 runs each) was too small to decide. Details: [Automatic Strategy Switching](/guides/choosing-strategies/#automatic-strategy-switching).

## Performance Tuning Tips

### Keep Early Stop On

Early stop is on by default when reactive intelligence is enabled. It ends a run once entropy has converged instead of spending the remaining iterations:

<!-- docs-skip-typecheck -->
```typescript
.withReactiveIntelligence({
  controller: {
    earlyStop: true, // default; stops once entropy converges
  },
})
```

`controller.contextCompression` is deprecated and has no effect of its own: the evaluator behind it was removed. Context pressure is handled by the auto-checkpoint thresholds above.

### Use Appropriate Reasoning Strategies

Start with `reactive` (the default). Heavier strategies cost more tokens and time on local models and showed no measured quality gain in our tests. The evidence summary is on one page: [Local Model Recommendations](/guides/choosing-strategies/#local-model-recommendations).

### Model-Specific Considerations

The built-in registry covers these local models. Any other model gets a 32,768-token context limit, no logprob support, and a tier from its provider (see above). Add your own entries with `.withReactiveIntelligence({ models: { ... } })`.

| Model | Context limit | Logprob support |
|-------|---------|-----------------|
| `gemma4:e4b` | 32,768 | No |
| `qwen3:4b` | 32,768 | No |
| `qwen3:14b` | 32,768 | Yes |
| `qwen3.5:14b` | 32,768 | Yes |
| `cogito:14b` | 32,768 | Yes |
| `llama3.3:70b` | 131,072 | Yes |

Logprob support enables the token-entropy signal. Without it, the token signal gets zero weight in the composite score and the other signals carry it.

### Native Function Calling

The harness detects whether a model supports native function calling. When it does not, the harness falls back to parsing tool calls from the model's text output. The agent code is the same either way:

- **Native FC** (supported models): direct tool calls through the provider API
- **Text FC fallback**: tool calls parsed from the model's text, which can need a retry when the text is malformed

## Related

- [Harness Control Flow](/features/harness-control-flow/): full entropy, controller, and decision pipeline
- [LLM Providers](/features/llm-providers/): provider configuration and adapter hooks
- [Reactive Intelligence](/features/reactive-intelligence/): entropy sensor and learning engine internals
