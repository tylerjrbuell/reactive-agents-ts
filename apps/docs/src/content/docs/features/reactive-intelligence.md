---
title: Reactive Intelligence
description: Real-time entropy sensing, adaptive control, and local learning for smarter agent reasoning.
sidebar:
  order: 6
---

Reactive Intelligence monitors reasoning quality in real time and takes corrective action automatically. Instead of waiting for an agent to exhaust its iteration budget, the system measures entropy — a composite signal of how uncertain or unfocused the agent's reasoning is — and intervenes early.

```
  Thought → Entropy Sensor → Composite Score → Controller → Decision
              (5 sources)      (0.0 – 1.0)     (evaluate)    (act)
                                                    ↓
                                              Learning Engine
                                            (calibrate + learn)
```

## Quick Start

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withReactiveIntelligence()  // Enable entropy sensing + telemetry
  .build();
```

With controller features enabled:

```typescript
.withReactiveIntelligence({
  controller: {
    earlyStop: true,           // Stop when entropy converges
    contextCompression: true,  // Compact context under pressure
    strategySwitch: true,      // Switch strategy on flat entropy
  },
  telemetry: true,             // Opt in to anonymous usage data (default in config is off)
})
```

## Entropy Sensor

Every reasoning step is scored across 5 independent entropy sources. Each produces a normalized 0–1 value where **lower = more focused reasoning**.

| Source | What It Measures | Requires |
|--------|-----------------|----------|
| **Token** | Logprob distribution spread — how confident the model is in its word choices | Logprob-capable provider (Ollama, OpenAI) |
| **Structural** | Format compliance, thought density, hedging language, vocabulary diversity | Always available |
| **Semantic** | Meaning drift between consecutive thoughts (cosine similarity of embeddings) | Embedding provider |
| **Behavioral** | Tool success rate, action diversity, loop patterns, completion approach | Always available |
| **Context Pressure** | Context window utilization and compression headroom | Always available |

### Composite Score

The 5 sources are combined into a single composite score using adaptive weights. Sources that aren't available (e.g., token entropy without logprob support) are excluded and remaining weights are redistributed.

```
composite = w_token * token + w_structural * structural
          + w_semantic * semantic + w_behavioral * behavioral
          + w_context * contextPressure
```

Weights adjust based on iteration progress — early iterations weight structural/behavioral higher; later iterations weight semantic/behavioral as trajectory data accumulates.

### Trajectory Analysis

The sensor tracks entropy over time and classifies the trajectory shape:

| Shape | Pattern | Meaning |
|-------|---------|---------|
| **converging** | Scores decreasing | Agent is focusing, making progress |
| **flat** | Scores stable | Agent may be stuck in a loop |
| **diverging** | Scores increasing | Agent is becoming more uncertain |
| **v-recovery** | Drop then rise | Initial progress lost |
| **oscillating** | Alternating up/down | Unstable reasoning |

## Reactive Controller

When enabled, the controller evaluates entropy data after each reasoning step and can trigger **10 types of interventions** — 3 core decisions plus 7 intelligence decisions added by the Living Intelligence System:

### Early Stop

When entropy converges (decreasing scores for 2+ consecutive iterations) and the composite score drops below the convergence threshold, the controller signals an early stop — saving iterations that would have been wasted.

```typescript
// Typical early-stop scenario:
// Iteration 3: composite 0.45, shape: converging
// Iteration 4: composite 0.32, shape: converging
// Iteration 5: composite 0.25, shape: converging ← early stop triggered
// Saved 5 iterations (maxIterations was 10)
```

### Context Compression

When context pressure exceeds 80%, the controller recommends compressing tool results and older conversation history to free up context window space before the agent's output quality degrades.

### Strategy Switch

When entropy is flat for 3+ iterations with high behavioral loop scores, the controller recommends switching from the current reasoning strategy to an alternative (e.g., ReAct to plan-execute-reflect).

### Temperature Adjust

When semantic entropy diverges over 3+ iterations, the controller lowers the temperature by 0.1 to reduce hallucination risk.

### Skill Activate

When entropy patterns match a high-confidence skill's task categories, the controller pre-activates the skill by injecting its instructions into context.

### Prompt Switch

When entropy has been flat for 4+ iterations, the controller switches to a different prompt variant (selected by the Thompson Sampling bandit).

### Tool Inject

When high structural entropy signals a knowledge gap and tools are available, the controller injects a tool (preferring `web-search`) into the active tool set.

### Memory Boost

When the agent is stuck with keyword/recent retrieval, the controller switches to semantic RAG to provide better context.

### Skill Reinject

When context compaction removes skill content (detected via `<skill_content>` XML tags), the controller re-injects the skill.

### Human Escalate

When 3+ different decision types have been tried and entropy remains high, the controller emits an `AgentNeedsHuman` event and pauses.

### Creator Control

All controller decisions can be intercepted and overridden:

```typescript
.withReactiveIntelligence({
  onControllerDecision: (decision, ctx) => {
    if (decision.decision === "human-escalate") return "reject";
    return "accept";
  },
  constraints: {
    maxTemperatureAdjustment: 0.15,
    neverEarlyStop: false,
    protectedSkills: ["my-critical-skill"],
  },
  autonomy: "suggest",  // "full" | "suggest" | "observe"
})
```

## Local Learning Engine

The learning engine runs after each agent execution and improves future runs through three mechanisms:

### Conformal Calibration

Entropy thresholds (what counts as "high" or "converged") are calibrated per model from historical run data. A model that naturally produces higher structural entropy gets adjusted thresholds, avoiding false positives.

Calibration data is stored in SQLite and accumulates across runs.

### Thompson Sampling Bandit

For each `(model, taskCategory)` pair, the bandit tracks which reasoning strategy performs best. Over time, it learns patterns like "plan-execute-reflect works better than ReAct for multi-tool tasks on local models."

Task categories are classified automatically: `code-generation`, `research`, `data-analysis`, `communication`, `multi-tool`, `general`.

### Skill Synthesis

When a run succeeds with converging entropy, the learning engine extracts a reusable skill fragment — a snapshot of the configuration that worked (strategy, temperature, tool filtering mode, memory tier) for that task category. These fragments feed into the **Living Skills System**: they are stored as `SkillRecord` entities in SQLite, evolve through LLM-based refinement in the memory consolidation background cycle, and are applied to future runs automatically. See the [Living Skills guide](/guides/agent-skills) for the full skill lifecycle.

## Telemetry

Anonymous, aggregate entropy data is sent to `api.reactiveagents.dev` to build model performance profiles that benefit all users. No prompts, outputs, API keys, or personally identifiable information is collected.

Each report contains:
- Install ID (random UUID, no PII)
- Model ID and tier
- Strategy used and whether switching occurred
- Entropy trace (composite scores per iteration)
- Outcome (success/partial/failure) and termination reason
- Token count and duration

### Opting Out

```typescript
.withReactiveIntelligence({ telemetry: false })
```

Or disable telemetry entirely by passing `telemetry: { enabled: false }`.

## Dashboard Integration

When both `.withObservability()` and `.withReactiveIntelligence()` are enabled, the metrics dashboard includes a **Reasoning Signal** section:

```
🧠 Reasoning Signal
├─ Grade: B (good)     Signal: converging ↘
├─ Summary: Agent focused efficiently across 4 iterations
├─ Efficiency: 1,471 tokens per 1% entropy reduction
├─ Sources: structural 62% | behavioral 38%
├─ Trace: ████▓▒░  0.65 → 0.52 → 0.38 → 0.25
└─ Tip: Entropy converged — consider enabling earlyStop
```

The grade (A–F) is based on convergence quality and mean entropy. Actionable recommendations appear based on the signal pattern.

## EventBus Integration

Entropy scoring is event-driven. All reasoning strategies publish `ReasoningStepCompleted` events, and the entropy subscriber scores them automatically. This means entropy data is available for every strategy — including plan-execute-reflect, which has its own execution loop separate from the kernel runner.

Key events:
- `EntropyScored` — fired after each thought is scored (composite, sources, trajectory)
- `ReactiveDecision` — fired when the controller triggers an intervention (early-stop, compress, switch-strategy)

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReactiveIntelligence({ controller: { earlyStop: true } })
  .withEvents()
  .build();

agent.subscribe("EntropyScored", (event) => {
  console.log(`Step ${event.iteration}: entropy ${event.composite.toFixed(3)} [${event.trajectory.shape}]`);
});

agent.subscribe("ReactiveDecision", (event) => {
  console.log(`Decision: ${event.decision} — ${event.reason}`);
});
```

## Configuration Reference

```typescript
interface ReactiveIntelligenceConfig {
  entropy: {
    enabled: boolean;            // Master switch (default: true)
    tokenEntropy?: boolean;      // default: true
    semanticEntropy?: boolean;   // default: true
    trajectoryTracking?: boolean; // default: true
  };
  controller: {
    earlyStop?: boolean;           // default: true
    branching?: boolean;           // default: false
    contextCompression?: boolean;  // default: true
    strategySwitch?: boolean;      // default: true
    causalAttribution?: boolean;   // default: false
  };
  learning: {
    banditSelection?: boolean;   // default: true
    skillSynthesis?: boolean;    // default: true
    skillDir?: string;
  };
  telemetry?: boolean | {
    enabled: boolean;
    endpoint?: string;
  }; // default: false — set true or { enabled: true } to send reports
}
```
