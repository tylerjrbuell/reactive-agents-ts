# Reactive Intelligence — Full Pipeline
**Date:** 2026-03-14
**Status:** Approved design
**Builds on:** `2026-03-13-reactive-intelligence-layer.md` (Phase 1 Entropy Sensor — shipped)
**Packages:** `@reactive-agents/reactive-intelligence` (existing), `@reactive-agents/runtime` (integration)
**External:** `reactiveagents-telemetry` (separate repo, deployed to reactiveagents.dev)

---

## Thesis

Reactive Agents gives away the framework, monetizes the intelligence. The open-source framework builds great agents. As a byproduct of running those agents, it generates structured data about what works — which context shapes, prompt variants, memory strategies, and tool configurations produce the highest-signal LLM responses for which models, task types, and complexity levels. That data is the product.

The agent treats every LLM call as a feedback loop: send context → get response → score signal quality → adjust what it sends next. Over many runs, it learns what works for each model/task combination. The moat is the accumulated knowledge — not the scoring algorithm.

Three levels of knowledge compound:
1. **Prompt templates** — "For cogito:14b on data-analysis tasks, use this system prompt variant"
2. **Context recipes** — "For local models on multi-tool tasks: compress tool schemas, set maxIterations=5, use plan-execute-reflect, include parameter hints"
3. **Behavioral strategies** — "When entropy is flat for 2+ iterations on a coding task with a 14B model, inject chain-of-thought scaffold and switch strategy"

---

## Architecture Overview

```
Agent run → Entropy Sensor (Phase 1, shipped)
                │
                ▼
        Reactive Controller (Phase 2)
        ├── 2A. Continue or Answer (early-stop)
        ├── 2C. Compress or Expand Context
        └── 2D. Switch or Stay (strategy switching)
                │
                ▼
        Local Learning Engine (Phase 3)
        ├── 3A. Conformal Calibration (per-model thresholds)
        ├── 3B. Contextual Bandit (prompt variant selection)
        └── 3C. Skill Synthesis (high-signal → reusable recipe)
                │
                ▼
        Telemetry Client (Phase 4)
        ├── Collect RunReport from execution context
        ├── Sign with HMAC-SHA256
        └── Non-blocking POST to reactiveagents.dev
                │
                ▼
        Telemetry Server (separate repo)
        ├── Store run_reports
        ├── Aggregate model_profiles
        ├── Promote validated skills
        └── (Future) Serve profiles to agents at bootstrap
```

---

## Phase 2: Reactive Controller

Three of the five spec'd controller decisions, selected for immediate user impact and data richness. 2B (branching) and 2E (attribution) are deferred — they require token-level logprobs which most providers don't support yet.

### 2A. Continue or Answer (Think Just Enough)

**Trigger:** `trajectory.shape === "converging"` AND `trajectory.derivative < -convergenceRate` for 2+ consecutive iterations.

**Action:** Signal the kernel to produce a final answer on the next iteration. Skip remaining budgeted iterations.

**Implementation:** In `kernel-runner.ts`, after entropy scoring, check trajectory. If converging for 2+ iterations and past the calibrated convergence threshold, set `state.meta.earlyStopSignaled = true`. The react-kernel checks this flag and appends "You have enough information. Produce your final answer now." to the next thought prompt.

**Expected impact:** 25–50% compute savings on tasks where the model converges early.

**Gate:** Validate on 20 runs that early-stopping produces equivalent or better final answers vs running to max iterations. Measure: answer quality (debrief outcome), tokens saved, iterations saved.

### 2C. Compress or Expand Context (ACON-inspired)

**Trigger:** `contextPressure.utilizationPct > 0.80`.

**Action:** Examine per-section signal density. Compress low-signal sections:
- Old tool results with low `signalDensity` → summarize to key findings
- Repetitive history entries → deduplicate semantically
- Verbose observations → extract facts only

Preserves: task description (never compressed), active skill instructions (never compressed), most recent tool results.

**Implementation:** New `ReactiveCompressor` service in `@reactive-agents/reactive-intelligence`. Receives context sections from `ContextWindowManager`, scores signal density per section, returns compressed context. Wired into kernel-runner between entropy scoring and next iteration.

**Expected impact:** 26–54% context reduction while preserving 95%+ task accuracy.

**Gate:** Validate on 10 long-horizon runs (>8 iterations) that compression produces equivalent final answers. Measure: context tokens before/after, answer quality, information loss.

### 2D. Switch or Stay (entropy-informed)

**Trigger:** `trajectory.shape === "flat"` for 3+ consecutive iterations AND `behavioralEntropy.loopDetectionScore > 0.7`.

**Action:** Trigger strategy switch via existing `enableStrategySwitching` mechanism. The entropy trajectory provides a more nuanced trigger than the current binary circuit breaker.

**Implementation:** In `kernel-runner.ts`, after entropy scoring, check if trajectory has been flat for 3+ iterations with high loop detection. If so, trigger the existing strategy switching mechanism (already wired: `evaluateStrategySwitch()` → `dispatchStrategy()`). The entropy check fires BEFORE the existing circuit breaker, giving the controller first shot at recovery.

**Expected impact:** Earlier detection of stuck strategies. Current circuit breaker fires after N repeated actions. Entropy trajectory detects stagnation even when actions are technically different but semantically identical.

**Gate:** Validate that entropy-informed switching fires earlier and more accurately than current circuit breaker on 10 known-stuck-run scenarios.

### Controller Service Interface

```typescript
export class ReactiveControllerService extends Context.Tag("ReactiveControllerService")<
  ReactiveControllerService,
  {
    // Evaluate all active controller decisions for this iteration.
    // Returns a list of decisions to execute (may be empty).
    readonly evaluate: (params: {
      entropyScore: EntropyScore;
      kernelState: KernelState;
      calibration: ModelCalibration;
      config: ReactiveControllerConfig;
    }) => Effect.Effect<readonly ReactiveDecision[], never>;
  }
>() {}

type ReactiveDecision =
  | { readonly decision: "early-stop"; readonly reason: string }
  | { readonly decision: "compress"; readonly sections: readonly string[]; readonly estimatedSavings: number }
  | { readonly decision: "switch-strategy"; readonly from: string; readonly to: string; readonly reason: string };
```

**Integration point:** kernel-runner.ts, after entropy scoring, before loop detection. The controller evaluates and returns decisions. The kernel runner executes them (set earlyStopSignaled, trigger compression, trigger strategy switch).

---

## Phase 3: Local Learning Engine

### 3A. Conformal Calibration

Per-model threshold calibration using split conformal prediction (TECP 2025, ConU 2024).

**What it does:** After 20 completed runs with a model, computes statistically grounded thresholds:
- `highEntropyThreshold` — above this, the run is likely struggling (α=0.10, tightens to 0.05 after N≥50)
- `convergenceThreshold` — below this, the run has likely solved the problem (α=0.30)

**Storage:** `CalibrationStore` in `@reactive-agents/reactive-intelligence` (already stubbed). Persists calibration data to SQLite.

**Update cycle:** After each completed run, the mean composite entropy of the run is added to the calibration set. Thresholds recomputed if sample count crosses a boundary (20, 50, 100).

**Drift detection:** If recent scores exceed 2σ from calibration mean, emit `CalibrationDrift` event. Calibration set can be reset.

### 3B. Contextual Bandit for Prompt Selection

Thompson Sampling bandit that learns which prompt variants work for which model × task combinations.

```
Context vector: [modelId, taskCategory, toolCount bucket]
Arms: prompt template variants (react-system-v1, react-system-v2, react-system-local, etc.)
Reward: 1 - mean(composite_entropy) from the completed run
```

**Cold start:** First 5 runs per context bucket use uniform random selection. After 5, Thompson Sampling takes over.

**Prompt variants:** Stored in `@reactive-agents/prompts`. The bandit selects which variant to use at strategy-select phase. New variants can be registered by users or synthesized by the skill synthesis engine.

**Storage:** Beta distribution parameters (α, β) per arm per context bucket. Persisted to SQLite via a new `BanditStore`.

### 3C. Skill Synthesis

When a run completes with:
- `trajectory.shape === "converging"`
- `mean(composite_entropy) < highEntropyThreshold`
- `outcome === "success"`

The Learning Engine synthesizes a skill from the run's configuration:

1. Extract: prompt template ID, strategy, temperature, tool configuration, memory config, compression settings, max iterations
2. One small LLM call (~200 tokens): "What made this configuration effective? Distill into a reusable description."
3. Store as a `LearnedSkill` in procedural memory with performance metadata
4. Tag with model ID + task category for retrieval

**Skill retrieval:** At bootstrap, the agent queries procedural memory for skills matching the current model + task category. If found, the skill's configuration overrides defaults.

---

## Phase 4: Telemetry

### Opt-In/Out Posture

- **On by default** when `.withReactiveIntelligence()` is used
- **Opt-out** via `.withReactiveIntelligence({ telemetry: false })`
- **First-run console notice** (once per process):
  ```
  ℹ Reactive Intelligence telemetry enabled — anonymous entropy data helps improve the framework. Disable with { telemetry: false }
  ```
- Telemetry is ONLY active when `.withReactiveIntelligence()` is called — never for agents without the entropy sensor

### RunReport Data Model

```typescript
type RunReport = {
  // Identity (anonymous)
  readonly installId: string;       // random UUID, generated once per framework install
  readonly runId: string;           // unique run ID (ULID)

  // Model context
  readonly modelId: string;         // "cogito:14b", "claude-sonnet-4", "gpt-4o"
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly provider: string;        // "ollama", "anthropic", "openai", "gemini", "litellm"

  // Task context (no content)
  readonly taskCategory: string;    // auto-classified: "data-analysis", "code-generation", "research", "communication", "multi-tool", "simple-qa"
  readonly toolCount: number;       // how many tools were available
  readonly toolsUsed: readonly string[];  // which tools were actually called
  readonly strategyUsed: string;    // "reactive", "plan-execute-reflect", "adaptive", etc.
  readonly strategySwitched: boolean;

  // Entropy trace (the core data)
  readonly entropyTrace: readonly {
    readonly iteration: number;
    readonly composite: number;
    readonly sources: {
      readonly token: number | null;
      readonly structural: number;
      readonly semantic: number | null;
      readonly behavioral: number;
      readonly contextPressure: number;
    };
    readonly trajectory: {
      readonly derivative: number;
      readonly shape: string;
      readonly momentum: number;
    };
    readonly confidence: "high" | "medium" | "low";
  }[];

  // Outcome
  readonly terminatedBy: string;
  readonly outcome: "success" | "partial" | "failure";
  readonly totalIterations: number;
  readonly totalTokens: number;
  readonly durationMs: number;

  // Skill fragment (only for high-signal runs)
  readonly skillFragment?: {
    readonly promptTemplateId: string;
    readonly systemPromptTokens: number;
    readonly contextStrategy: {
      readonly compressionEnabled: boolean;
      readonly maxIterations: number;
      readonly temperature: number;
      readonly toolFilteringMode: "adaptive" | "static" | "none";
      readonly requiredToolsCount: number;
    };
    readonly memoryConfig: {
      readonly tier: string;
      readonly semanticLines: number;
      readonly episodicLines: number;
      readonly consolidationEnabled: boolean;
    };
    readonly reasoningConfig: {
      readonly strategy: string;
      readonly strategySwitchingEnabled: boolean;
      readonly adaptiveEnabled: boolean;
    };
    readonly convergenceIteration: number | null;
    readonly finalComposite: number;
    readonly meanComposite: number;
  };
};
```

**What is NOT sent:** Task descriptions, prompt content, tool arguments, tool results, LLM responses, memory content, user identity. Nothing that could reconstruct what the agent actually did.

**Size:** ~2-5KB per run. A Pi with a 1TB drive stores 200M+ run reports.

### Client Validation

Framework signature via HMAC-SHA256:

```
POST /v1/reports
Headers:
  X-RA-Client-Version: 0.8.0
  X-RA-Client-Signature: HMAC-SHA256(requestBody, signingKey)
  Content-Type: application/json
```

- Signing key embedded in `@reactive-agents/reactive-intelligence` package
- Server verifies signature matches — confirms request came from a real Reactive Agents installation
- Signing key rotates with major framework versions
- Prevents spam and bogus data injection
- Does NOT prevent determined reverse-engineering (acceptable — skill promotion logic filters bad data)

### Telemetry Client Implementation

On `AgentCompleted` event:

1. Collect entropy history from `state.meta.entropy.entropyHistory`
2. Collect tool stats from `toolCallLog` (ToolCallCompleted events)
3. Collect outcome from debrief pipeline
4. Auto-classify task category via keyword heuristic (NOT an LLM call)
5. If high-signal run (converging + successful + below threshold), attach skill fragment
6. Sign payload, fire non-blocking POST
7. No retry, no queue — if server is down, report is silently dropped
8. Zero impact on agent performance

### Install ID Generation

On first framework use, generate a random UUID and store in:
- `~/.reactive-agents/install-id` (global, not per-project)
- If file exists, read it. If not, generate and write.
- Not tied to user identity. No fingerprinting. Just a stable random ID for grouping runs from the same installation.

---

## Telemetry Server (Separate Repo)

**Repo:** `reactiveagents-telemetry` (private)
**Deploy:** Raspberry Pi at `reactiveagents.dev`
**Stack:** Bun + Hono + SQLite (WAL mode)

### Endpoints

```
POST /v1/reports              — receive RunReport, validate signature, store
GET  /v1/profiles/:modelId    — aggregated optimization profile for a model
GET  /v1/skills               — browse validated skill fragments
GET  /v1/stats                — public dashboard data (total runs, models, etc.)
GET  /health                  — uptime check
```

### Storage Schema

```sql
CREATE TABLE run_reports (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  provider TEXT NOT NULL,
  task_category TEXT NOT NULL,
  strategy_used TEXT NOT NULL,
  outcome TEXT NOT NULL,
  terminated_by TEXT NOT NULL,
  total_iterations INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  entropy_trace TEXT NOT NULL,     -- JSON array
  skill_fragment TEXT,             -- JSON, nullable
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_model ON run_reports(model_id);
CREATE INDEX idx_category ON run_reports(task_category);
CREATE INDEX idx_outcome ON run_reports(outcome);

CREATE TABLE model_profiles (
  model_id TEXT PRIMARY KEY,
  sample_count INTEGER,
  mean_entropy REAL,
  convergence_rate REAL,
  optimal_strategy TEXT,
  optimal_temperature REAL,
  optimal_max_iterations INTEGER,
  avg_tokens REAL,
  avg_duration_ms REAL,
  high_entropy_threshold REAL,
  convergence_threshold REAL,
  profile_json TEXT,
  updated_at TEXT
);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  task_category TEXT NOT NULL,
  sample_count INTEGER,
  mean_entropy REAL,
  convergence_rate REAL,
  recipe_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
```

### Skill Promotion Logic

A skill fragment becomes a validated skill when:
- 10+ runs with similar configuration (same model + task category)
- Produce converging entropy trajectories
- Produce successful outcomes
- Mean entropy below the model's calibrated high-entropy threshold

This is the quality gate — skills are measured, not reviewed.

### Profile Aggregation

Model profiles are rebuilt periodically (every 100 new reports or daily, whichever comes first):
1. Query all reports for a model
2. Compute: mean entropy, convergence rate, strategy success rates, optimal temperature range
3. Compute conformal thresholds from the distribution
4. Store as model_profiles row

---

## Builder API Changes

```typescript
// Phase 2 + 3 + 4 — full reactive intelligence
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReactiveIntelligence({
    // Entropy Sensor (Phase 1, already shipped)
    entropy: { enabled: true },

    // Reactive Controller (Phase 2)
    controller: {
      earlyStop: true,
      contextCompression: true,
      strategySwitch: true,
    },

    // Learning Engine (Phase 3)
    learning: {
      calibration: true,        // conformal calibration after 20 runs
      banditSelection: true,    // contextual bandit for prompt variants
      skillSynthesis: true,     // extract skills from high-signal runs
    },

    // Telemetry (Phase 4)
    telemetry: true,            // default: true (opt-out with false)
    telemetryEndpoint: "https://reactiveagents.dev/v1/reports",  // default
  })
  .build();
```

---

## Implementation Order

1. **Phase 2A: Early-stop controller** — highest immediate impact, simplest to implement
2. **Phase 2D: Entropy-informed strategy switching** — builds on existing switching mechanism
3. **Phase 3A: Conformal calibration** — CalibrationStore already stubbed, enables threshold-based decisions
4. **Phase 2C: Context compression** — requires calibrated thresholds to know when to fire
5. **Phase 3B: Contextual bandit** — requires calibration data for reward computation
6. **Phase 3C: Skill synthesis** — requires bandit + calibration + enough run data
7. **Phase 4: Telemetry client** — can ship alongside any of the above, independent
8. **Telemetry server** — separate repo, independent timeline

Each phase has its own validation gate (specified in the phase descriptions above). Do not proceed to the next phase until the gate passes.

---

## What's NOT in Scope

- User accounts or authentication (beyond client signature validation)
- Paid marketplace or billing
- Skill browsing UI or web dashboard
- Cross-agent real-time sharing
- 2B (entropy-guided branching) — requires widespread logprob support
- 2E (prompt causal attribution) — deferred to post-v1.0
- Telemetry server deployment automation — manual Pi setup for v1

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Early-stop token savings | 25%+ on converging runs | Compare tokens used with/without early-stop on 20 runs |
| Context compression ratio | 30%+ on long-horizon runs | Before/after token counts on 10 runs with >8 iterations |
| Strategy switch accuracy | Fires before circuit breaker in 80%+ of stuck runs | Compare iteration counts on 10 known-stuck scenarios |
| Calibration convergence | Thresholds stable after 20 runs | Standard deviation of thresholds across rolling windows |
| Telemetry report size | <5KB mean | Measure across 100 reports |
| Telemetry latency impact | <5ms added to agent completion | Benchmark with/without telemetry enabled |
| Skill promotion rate | 5%+ of runs produce validated skills after 1000 reports | Count promoted skills / total reports |
