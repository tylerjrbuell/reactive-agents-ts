---
title: Local Model Performance
description: Tier-specific tuning, calibration, and performance characteristics for local LLM providers.
sidebar:
  order: 8
---

Reactive Agents automatically adapts its behavior based on the model tier. Local models (Ollama, LiteLLM) have different entropy distributions, latency profiles, and capability envelopes compared to frontier models (OpenAI, Anthropic, Google). The framework accounts for these differences at every level.

## Model Tier Detection

The tier is inferred from the provider configuration:

| Provider | Tier | Detection |
|----------|------|-----------|
| Ollama | `local` | Provider name |
| LiteLLM | `local` | Provider name |
| OpenAI | `frontier` | Provider name |
| Anthropic | `frontier` | Provider name |
| Google | `frontier` | Provider name |
| Groq | `frontier` | Provider name |

The tier affects entropy scoring weights, controller thresholds, and meta-tool behavior.

## Entropy Calibration for Local Models

Local models exhibit higher baseline entropy and wider score distributions. The conformal calibration system accounts for this:

- **Uncalibrated defaults** use conservative thresholds (convergence: 0.4, high-entropy: 0.8) suitable for both tiers.
- **Calibrated thresholds** adapt automatically after 20+ scored iterations. Local models typically produce higher thresholds (convergence: ~0.5, high-entropy: ~0.85) reflecting their noisier output.

### Building Calibration Data

Calibration accumulates automatically during normal agent use. Each entropy score is recorded and thresholds recompute via conformal quantiles:

- **High-entropy threshold**: 90th percentile of historical scores
- **Convergence threshold**: 70th percentile (looser bound)

To persist calibration across runs, provide a database path:

```typescript
.withReactiveIntelligence({
  calibrationDbPath: "./data/calibration.sqlite",
})
```

### Monitoring Calibration Health

When a model's behavior shifts (e.g., after updating model weights), the system detects calibration drift:

```typescript
eventBus.subscribe("CalibrationDrift", (event) => {
  // event.modelId, event.expectedMean, event.observedMean, event.deviationSigma
  console.warn(`Calibration drift on ${event.modelId} — consider resetting calibration data`);
});
```

## Controller Behavior by Tier

The reactive controller adapts its strategy based on the model tier:

### Early Stop

| Aspect | Local | Frontier |
|--------|-------|----------|
| Min iterations before stopping | Higher (models need more steps) | Lower |
| Convergence threshold | Higher (noisier output) | Lower |
| Confidence required | Medium | High |

### Context Compression

Local models typically have smaller context windows (4K–32K vs 128K–200K). The context pressure sensor triggers compression earlier:

| Aspect | Local | Frontier |
|--------|-------|----------|
| Compression trigger | ~60% utilization | ~80% utilization |
| Auto-checkpoint threshold | 0.75 soft / 0.80 hard | 0.80 soft / 0.85 hard |

### Strategy Switching

When entropy trajectory is flat (no improvement), the controller may recommend switching strategies. Local models get more patience before triggering a switch.

## Performance Tuning Tips

### Reduce Token Waste

```typescript
.withReactiveIntelligence({
  controller: {
    earlyStop: true,          // Critical for local models — saves 30-50% of iterations
    contextCompression: true, // Prevent context overflow on small-window models
  },
})
```

### Use Appropriate Reasoning Strategies

Local models work best with:

- **`reactive`** (default) — single-pass tool calling with entropy monitoring
- **`plan-execute`** — explicit planning for complex multi-step tasks

More sophisticated strategies (e.g., `tree-of-thought`) may underperform on local models due to increased token overhead.

### Model-Specific Considerations

| Model | Context | Logprob Support | Notes |
|-------|---------|-----------------|-------|
| Ollama (Llama 3.x) | 8K–128K | Yes | Good all-around; enable token entropy |
| Ollama (Mistral) | 32K | Yes | Strong at structured output; lower entropy variance |
| Ollama (Cogito) | 8K–32K | Yes | Reasoning-focused; benefits from early-stop |
| Ollama (Gemma) | 8K | Partial | Smaller context needs aggressive compression |

### Native Function Calling

The harness automatically detects whether a model supports native function calling. When unavailable, it falls back to text-based JSON tool call parsing. This is transparent to the agent but affects latency:

- **Native FC** (supported models): Direct tool calls via provider API — lower latency, more reliable
- **Text FC fallback**: Tool calls parsed from LLM text output — higher latency, may need retry

## Related

- [Harness Control Flow](/features/harness-control-flow/) — Full entropy → controller → decision pipeline
- [LLM Providers](/features/llm-providers/) — Provider configuration and adapter hooks
- [Reactive Intelligence](/features/reactive-intelligence/) — Entropy sensor and learning engine internals
