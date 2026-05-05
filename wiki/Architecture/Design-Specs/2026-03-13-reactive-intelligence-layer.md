# Reactive Intelligence Layer
**Date:** 2026-03-13
**Status:** Research-validated spec
**Package:** `@reactive-agents/reactive-intelligence` (new)
**Replaces:** `2026-03-13-prompt-engine-signal-scorer.md` (superseded)

---

## Thesis

The name "Reactive Agents" is not branding — it is the architectural thesis. A reactive agent **senses its own uncertainty in real time and adapts its reasoning, context, and strategy accordingly**. It does not blindly execute a prompt and hope for the best. It monitors the entropy of its own thought process, recognizes when it is confused, confident, stuck, or drifting, and makes real-time decisions about what to do next.

This is the metacognitive layer that separates a reactive agent from a prompt-and-pray pipeline.

No existing framework combines token-level entropy monitoring, adaptive reasoning depth, entropy-guided branching, signal-preserving context compression, and bandit-driven prompt optimization into a single coherent system. Each exists in isolation in recent research papers. The Reactive Intelligence Layer unifies them under one principle: **entropy is the universal control signal for agent behavior**.

---

## Research Foundations

Every algorithmic choice in this spec maps to a validated research finding. This section is the permanent reference — implementations must trace back to these sources.

### Process Reward Models (PRM) — the architectural framing
The entire system is a lightweight PRM: it assigns a scalar quality signal to each intermediate reasoning step. PRM research validates step-level scoring as more informative than outcome-level for multi-step reasoning. During inference, positive steps are accepted; negative or neutral steps trigger search expansion or backtracking — precisely the Reactive Controller's behavior.

*"The Lessons of Developing Process Reward Models in Mathematical Reasoning" (Jan 2025, arxiv:2501.07301)*
*"Enhancing LLM Agents with Automated Process Supervision" (EMNLP 2025)*
*"R-PRM: Reasoning-Driven Process Reward Modeling" (EMNLP 2025, arxiv:2503.21295)*

### Think Just Enough — adaptive reasoning depth via entropy
Sequence-level token entropy at the first reasoning step serves as a confidence signal for early stopping. Advanced reasoning models exhibit an **emergent confidence awareness**: they know when they have solved a problem, and entropy reveals it. Achieves 25–50% compute savings with zero accuracy loss. The entropy threshold varies per model but calibrates with a few examples.

*"Think Just Enough: Sequence-Level Entropy as a Confidence Signal for LLM Reasoning" (Oct 2025, arxiv:2510.08146)*

### EAGer — entropy-aware branching at decision points
Monitors per-token entropy during decoding. Branches to alternative reasoning paths **only at high-entropy tokens** — avoiding regeneration of identical low-entropy continuations. Achieves 40–65% token reduction vs parallel decoding. Unused compute budget from easy problems is redirected to hard ones.

*"EAGER: Entropy-Aware GEneRation for Adaptive Inference-Time Scaling" (Oct 2025, arxiv:2510.11170)*
*"Entropy-Gated Branching for Efficient Test-Time Reasoning" (Mar 2025, arxiv:2503.21961)*

### AdaDec — pause-and-rerank at uncertainty spikes
When token-level Shannon entropy exceeds a learned threshold, decoding pauses and a lookahead rerank is triggered. Many errors arise from local ranking mistakes — the correct token is present but not ranked first. Pausing and reranking at these moments improves Pass@1 accuracy by up to 15.5%. The threshold is learned per-model via logistic regression, not hand-tuned.

*"AdaDec: Uncertainty-Guided Adaptive Decoding for LLM-based Code Generation" (Jun 2025, arxiv:2506.08980)*

### ACON — signal-preserving context compression for long-horizon agents
Compresses both observations and interaction histories while preserving diverse signal types: factual history, action-outcome relationships, evolving state, success preconditions, and decision cues. 26–54% memory reduction with 95%+ accuracy preserved. Gradient-free, works with closed-source models. Compression guidelines are optimized in natural language space by analyzing paired trajectories where full context succeeds but compressed context fails.

*"ACON: Optimizing Context Compression for Long-horizon LLM Agents" (Oct 2025, arxiv:2510.00615)*

### TECP — token entropy as a statistically grounded uncertainty measure
Treats the cumulative token entropy of a generated sequence as a nonconformity score and integrates it with split conformal prediction for coverage-guaranteed thresholds. Works black-box — requires only input-output access. Outperforms prior self-uncertainty-quantification methods across 6 LLMs and 2 benchmarks.

*"TECP: Token-Entropy Conformal Prediction for LLMs" (Sep 2025, arxiv:2509.00461)*

### Conformal Prediction — statistical threshold guarantees
Conformal prediction over a calibration set produces thresholds with finite-sample coverage guarantees. The nonconformity score from the calibration set determines the threshold at the desired coverage level. Distribution-free and model-agnostic.

*"ConU: Conformal Uncertainty in LLMs with Correctness Coverage Guarantees" (EMNLP 2024, arxiv:2407.00499)*
*"Selective Conformal Uncertainty in Large Language Models" (ACL 2025)*

### SelfCheckGPT — consistency without N samples
Hallucinated content is not reproducible — consistent facts produce consistent embeddings across samples. Applied within a single run: compare the current thought's embedding against the centroid of all prior thoughts. Low distance = repetition (bad). High distance = novel progress (good). No N-sample overhead.

*"SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection" (EMNLP 2023, arxiv:2303.08896)*

### Contextual Bandits — online prompt optimization
Prompt variant selection framed as a contextual multi-armed bandit problem. Different prompt variants are arms; response quality is the reward. Bandits learn in real-time which variants work for which model × task contexts, outperforming static A/B splits.

*"Multi-Armed Bandits Meet Large Language Models" (May 2025, arxiv:2505.13355)*
*"PAK-UCB: Prompt-Aware Contextual Bandit for Generative Model Selection" (OpenReview 2025)*
*"Learning to Route LLMs from Bandit Feedback" (Oct 2025, arxiv:2510.07429)*

### LM-Polygraph — heuristics as strong baselines
Benchmarked 20+ uncertainty quantification methods across 11 tasks. Finding: simple heuristic methods (probability of most likely sequence, vocabulary diversity) are surprisingly effective for short, structured outputs. Complex methods only outperform on long-form tasks. This validates building and validating heuristic scoring before investing in expensive layers.

*"Benchmarking Uncertainty Quantification Methods for LLMs with LM-Polygraph" (TACL 2025, arxiv:2406.15627)*

### Metacognitive Architecture — the design pattern
A truly self-improving agent requires intrinsic metacognitive learning: a secondary system that monitors the primary agent's reasoning, evaluates progress, and adjusts strategy. This is not self-reflection via prompting — it is a structural architectural layer that operates independently of the agent's reasoning.

*"Position: Truly Self-Improving Agents Require Intrinsic Metacognitive Learning" (Jun 2025, arxiv:2506.05109)*
*"Emergent Introspective Awareness in Large Language Models" (Anthropic, Jan 2025)*

---

## Architecture

The Reactive Intelligence Layer is a metacognitive system — a secondary layer that monitors and controls the primary agent's reasoning without being part of that reasoning. It consists of three systems, built and validated in order.

```
                              ┌─────────────────────────┐
                              │    Learning Engine       │
                              │  (Phase 3)               │
                              │                          │
                              │  Contextual bandit       │
                              │  Conformal calibration   │
                              │  Skill synthesis         │
                              │  Cross-agent sharing     │
                              └────────────┬─────────────┘
                                           │ optimizes thresholds,
                                           │ promotes variants
                              ┌────────────▼─────────────┐
                              │   Reactive Controller    │
                              │  (Phase 2)               │
                              │                          │
                              │  5 decisions per iter:   │
                              │  continue/answer         │
                              │  focus/explore           │
                              │  compress/expand         │
                              │  switch/stay             │
                              │  attribute/proceed       │
                              └────────────┬─────────────┘
                                           │ entropy signals
                              ┌────────────▼─────────────┐
  KernelRunner ──────────────►│    Entropy Sensor        │
  (onThought, onAction,      │  (Phase 1)               │
   onObservation)             │                          │
                              │  Token entropy           │
                              │  Structural entropy      │
                              │  Semantic entropy        │
                              │  Behavioral entropy      │
                              │  Context pressure        │
                              │  Entropy trajectory      │
                              └────────────┬─────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │  EventBus   │
                                    │  + Dashboard │
                                    └─────────────┘
```

---

## System 1: Entropy Sensor (Phase 1)

The measurement foundation. Outputs decomposable, per-token-granularity entropy signals across five sources. Ships first. Operates in observe-only mode until validated.

**Terminology note:** "Entropy" is used in two senses: (1) **information-theoretic entropy** — Shannon entropy of token probability distributions (sources 1A, 1C), and (2) **signal entropy** — metaphorical, meaning disorder/uncertainty in the agent's behavior (sources 1B, 1D). The composite score blends both into a single [0,1] signal where lower = higher signal quality. Source names use the narrower meaning; the composite uses the broader one.

### 1A. Token Entropy (TECP-inspired)

**Available when:** Ollama (all models), OpenAI (`logprobs: true`)
**Cost:** Zero — computed from data already returned by the LLM API

The primary signal for models that expose logprobs. Computed per the TECP algorithm:

```
For each token t_i in the response with top-k logprob distribution {(token_j, lp_j)}:

  1. Convert to probabilities:    p_j = exp(lp_j)
  2. Normalize top-k:             p_j_norm = p_j / Σ p_j
  3. Per-token entropy:           H(t_i) = -Σ (p_j_norm × log₂(p_j_norm))
  4. Normalize by max entropy:    H_norm(t_i) = H(t_i) / log₂(k)    → [0, 1]

Outputs:
  tokenEntropies: number[]           — per-token H_norm array (full granularity)
  sequenceEntropy: number            — mean(tokenEntropies), length-normalized
  toolCallEntropy: number            — mean entropy over JSON tool call region only
  peakEntropy: number                — max(tokenEntropies) — worst uncertainty spike
  entropySpikes: {position, value}[] — tokens where H_norm > spike_threshold
```

**Why per-token, not just sequence-level:** EAGer and AdaDec both operate at token granularity. A sequence-level average obscures the entropy spikes where the model is actually uncertain. If we only store the mean, we can never retrofit branching or pause-and-rerank without rebuilding from scratch. Store the full `tokenEntropies` array.

**Temperature 0 handling:** At temperature 0 (greedy decoding), entropy collapses by construction — the model is forced to pick the highest-probability token. When `temperature === 0`, token entropy is discounted: `weight = 0.15` instead of the standard weight. The other sensor sources carry the load.

**Length normalization is mandatory.** Multiple 2024-2025 calibration papers confirm raw logprobs are length-biased. `sequenceEntropy` always divides by `N_tokens`.

### 1B. Structural Entropy (heuristic, always available)

**Available:** Always — zero dependencies, sync, <1ms
**Cost:** O(n) string operations

The most reliable sensor source for structured reasoning outputs (ReAct thoughts, plan steps). LM-Polygraph validates: simple heuristics are surprisingly effective for short, formatted outputs.

```typescript
type StructuralEntropy = {
  formatCompliance: number;       // [0,1] does output match expected structure?
                                  // Strategy-specific:
                                  //   ReAct: Thought: → Action: → JSON tool call
                                  //   Plan-Execute: Step N: markers in order
                                  //   ToT: branching with scoring
  orderIntegrity: number;         // [0,1] are structural elements in correct sequence?
                                  //   Thought: before Action:, Action: before Observation:
                                  //   wrong order = strong low-signal indicator
  thoughtDensity: number;         // [0,1] ratio of reasoning content vs filler/repetition
                                  //   computed: unique_meaningful_words / total_words
  vocabularyDiversity: number;    // [0,1] type-token ratio
                                  //   reuses checkSemanticEntropyHeuristic from @reactive-agents/verification
  hedgeScore: number;             // [0,1] 1.0 = no hedging, 0.0 = maximum hedging
                                  //   hedge phrases: "maybe", "I think", "not sure", "possibly"
                                  //   formula: 1 - min(0.3, hedgeCount × 0.1)
                                  //   cap matches @reactive-agents/verification hedgePenalty cap
  jsonParseScore: number;         // [0,1] for tool calls: 1.0 = valid JSON, 0.5 = fixable,
                                  //   0.0 = unparseable. Not binary — partial parse = partial score
}
```

### 1C. Semantic Entropy (embedding-based, cross-iteration)

**Available when:** Embedding service configured
**Cost:** 1 embedding call per iteration (~50ms, ~100 tokens)
**Skipped when:** No embedding service, or iteration 1

Applies the SelfCheckGPT consistency principle across iterations within a single run. No N-sample overhead.

```
Maintain:
  thoughtEmbeddings[]: embedding of each prior thought
  centroid: running centroid of thoughtEmbeddings (incrementally updated)
  taskEmbedding: embed(taskDescription), computed once

Compute:
  taskAlignment = cosineSimilarity(currentEmbedding, taskEmbedding)
    → low = drifting off-task

  noveltyScore = 1 - cosineSimilarity(currentEmbedding, centroid)
    → high = new ground (good), low = repetition (bad)
    → incrementally: newCentroid = (oldCentroid × n + currentEmbedding) / (n + 1)

  adjacentRepetition = cosineSimilarity(currentEmbedding, thoughtEmbeddings[-1])
    → > 0.95 = near-verbatim repetition — high-confidence loop detection
```

```typescript
type SemanticEntropy = {
  taskAlignment: number;         // cosine sim to task description [0,1]
  noveltyScore: number;          // distance from centroid of all prior thoughts [0,1]
  adjacentRepetition: number;    // cosine sim to immediately prior thought [0,1]
  available: boolean;
}
```

### 1D. Behavioral Entropy (PRM, accumulated per-run)

**Available:** Always after iteration 1
**Cost:** Sync, O(1) — reads from KernelState

The process reward signal. Aggregates behavioral facts that are directly predictive of final run quality.

```typescript
type BehavioralEntropy = {
  toolSuccessRate: number;       // successful_tool_calls / total_tool_calls [0,1]
  actionDiversity: number;       // min(1, Set(action_names).size / iteration) [0,1]
                                 //   clamped to 1.0 — can exceed 1 if multiple actions per iter
                                 //   low = repeating same actions (stuck)
  loopDetectionScore: number;    // [0,1] 0 = clean, 1 = definite loop
                                 //   formalizes existing circuit breaker from v0.8
  completionApproach: number;    // [0,1] presence of completion markers
                                 //   "therefore", "the answer is", final-answer tool call
                                 //   weighted by iteration position — expected to rise over time
}
```

### 1E. Context Pressure

**Available:** Always
**Cost:** Sync

Measures context window utilization and estimates signal density per section. Reuses the `estimateTokens()` utility from `@reactive-agents/core` for token counting, but does NOT depend on `ContextWindowManager` as a service — the Entropy Sensor builds its own section-level view from the `KernelState` (system prompt, tool results, history). The section breakdown is computed at score time from data already available in `KernelState.meta`.

```typescript
type ContextPressure = {
  utilizationPct: number;        // currentTokens / modelContextLimit [0,1]
  sections: ContextSection[];    // per-section token estimate + signal density
  atRiskSections: string[];      // labels of sections near truncation boundary
  compressionHeadroom: number;   // estimated tokens recoverable from low-signal sections
}

type ContextSection = {
  label: string;                 // "system-prompt" | "tool-results" | "history" | "task" | "skill"
  tokenEstimate: number;
  signalDensity: number;         // estimated signal per token [0,1]
                                 //   task: always 1.0
                                 //   tool-results: 1.0 if recent, decays with age
                                 //   history: decays with iteration distance
                                 //   system-prompt: 0.7 (static, important but unchanging)
                                 //   skill: 0.8 (high value, specialized instructions)
  position: "near" | "mid" | "far";
}
```

### 1F. Entropy Trajectory (the reactive signature)

**Available:** After iteration 2
**Cost:** Sync — computed from accumulated entropy scores

The trajectory of entropy across iterations is itself a signal — more informative than any single-step score. Think Just Enough shows that falling entropy = model converging on an answer. This is the "reactive" signature made measurable.

```typescript
type EntropyTrajectory = {
  history: number[];             // composite entropy per iteration [0,1]
  derivative: number;            // slope of recent 3 iterations
                                 //   negative = converging (good)
                                 //   zero = flat/stuck
                                 //   positive = diverging/confused
  momentum: number;              // exponentially weighted moving average
                                 //   smooths out single-iteration noise
  shape: "converging" | "flat" | "diverging" | "v-recovery" | "oscillating";
                                 //   classified from trajectory pattern
                                 //   "converging" → Phase 2 can early-stop
                                 //   "flat" → stuck, needs intervention
                                 //   "v-recovery" → was confused, now recovering — do not intervene
                                 //   "oscillating" → unstable, context or prompt issue
}
```

**Iteration-position-aware weighting:** A composite entropy of 0.6 at iteration 1 means something different than 0.6 at iteration 8. Apply sigmoid weighting:

```
sigmoid(x) = 1 / (1 + exp(-x))

iterationWeight(i, maxIter) = sigmoid((i - maxIter/2) × 4/maxIter)
  → low weight at early iterations (exploration is normal)
  → high weight at late iterations (should be converging)
  → example: maxIter=10, i=2 → sigmoid(-2.4) ≈ 0.08; i=8 → sigmoid(1.2) ≈ 0.77
```

This eliminates the "productive exploration scored as low-signal" false positive class.

---

### Composite Entropy Score

```typescript
type EntropyScore = {
  composite: number;              // [0,1] weighted combination — lower = better signal
  sources: {
    token: number | null;         // null if logprobs unavailable
    structural: number;
    semantic: number | null;      // null if no embedding service
    behavioral: number;
    contextPressure: number;
  };
  trajectory: EntropyTrajectory;
  confidence: "high" | "medium" | "low";
  modelTier: "frontier" | "local" | "unknown";
  iteration: number;
  iterationWeight: number;        // sigmoid position weight
  timestamp: number;

  // Per-token detail — stored for Phase 2 branching/reranking
  tokenEntropies?: readonly number[];
  entropySpikes?: readonly { position: number; value: number }[];
}
```

**Weighting (adaptive, not fixed):**

Initial defaults — replaced by conformal calibration after MIN_CALIBRATION_RUNS:

| Source | Weight (logprobs available) | Weight (logprobs unavailable) |
|---|---|---|
| Token entropy | 0.30 | — |
| Structural entropy | 0.25 | 0.40 |
| Semantic entropy | 0.15 | 0.25 |
| Behavioral entropy | 0.20 | 0.25 |
| Context pressure | 0.10 | 0.10 |

Weights are marked as **empirically tunable** — these are initial estimates. The Learning Engine (Phase 3) can adjust them per model via the contextual bandit.

**Confidence tiers:**
- `"high"` — token + structural + semantic + behavioral (all 4 core sources)
- `"medium"` — 2–3 sources
- `"low"` — structural + behavioral only

---

### Conformal Calibration

Replaces arbitrary thresholds with statistically grounded bounds. Uses split conformal prediction (ConU 2024, TECP 2025).

```
Calibration phase (MIN_CALIBRATION_RUNS = 20 per model):

  For each calibration run:
    Collect composite entropy scores per iteration: {e_1, e_2, ..., e_n}
    Use the MEAN composite entropy of the run as the nonconformity score
    (aggregating per-iteration scores into a single run-level score)

  Nonconformity scores: R_i = mean(e_1...e_n)  for run i

  At desired false-positive rate α = 0.10:
    q̂ = quantile(R_1...R_N, ⌈(N+1)(1-α)⌉ / N)
    highEntropyThreshold = q̂

  Result: threshold with coverage guarantee that ≤10% of normal runs
  are misclassified as high-entropy for THIS specific model.

  NOTE: α=0.10 (not 0.05) because with N=20, α=0.05 yields
  ⌈21×0.95⌉/20 = 20/20 — the max of calibration scores, which is
  too conservative. α=0.10 gives ⌈21×0.90⌉/20 = 19/20, the second-
  highest score — a usable threshold. As N grows past 50, α can be
  tightened to 0.05. The convergenceThreshold uses α=0.30 for a
  looser bound (appropriate for early-stop decisions).
```

```typescript
type ModelCalibration = {
  modelId: string;
  calibrationScores: readonly number[];
  sampleCount: number;
  highEntropyThreshold: number;    // conformal, α=0.10 (tightens to 0.05 after N≥50)
  convergenceThreshold: number;    // conformal, α=0.30 — trajectory "converged" if below
  calibrated: boolean;             // true after sampleCount >= 20
  lastUpdated: number;
  driftDetected: boolean;          // true if recent scores exceed 2σ from calibration mean
}
```

**Before calibration:** Entropy Sensor operates in observe-only mode with wide defaults. No thresholds fire. Dashboard displays raw entropy values for developer inspection.

**After calibration:** Thresholds have mathematical coverage guarantees. Phase 2 decisions can rely on them.

**Calibration drift:** If a model's entropy distribution shifts significantly (model update, context length change, different task type), the sensor emits a `CalibrationDrift` event. The calibration set can be reset or extended.

---

## System 2: Reactive Controller (Phase 2)

Five decisions per iteration, each mapped to a specific research-validated technique. Built and validated one at a time — each sub-phase has its own gate.

### 2A. Continue or Answer? (Think Just Enough)

**Research basis:** Think Just Enough — entropy trajectory as a confidence signal for early stopping.

When `trajectory.shape === "converging"` and `trajectory.derivative < -convergenceRate` for 2+ consecutive iterations, the agent has likely solved the problem. The controller can:
- Signal the kernel to produce a final answer on the next iteration
- Skip remaining budgeted iterations

**Expected impact:** 25–50% compute savings on tasks where the model converges early.

**Gate:** Validate on 20 runs that early-stopping produces equivalent or better final answers vs running to max iterations. Measure: answer quality (via EvalService), tokens saved, iterations saved.

### 2B. Focus or Explore? (EAGer-inspired)

**Research basis:** EAGer — branch only at high-entropy tokens.

When `entropySpikes` contains tokens above the calibrated spike threshold, the current reasoning step has decision points where the model is uncertain. The controller can:
- For strategies that support branching (ToT, Adaptive): trigger exploration of alternative paths at those specific positions
- For ReAct: log the spike positions and inject a "consider alternatives" hint into the next iteration's context

**Expected impact:** 40–65% token reduction vs naive parallel exploration, with better coverage of solution space.

**Gate:** Validate that entropy spikes correlate (Spearman ρ > 0.5) with actual decision points in reasoning (measured by human annotation on 30 labeled examples).

### 2C. Compress or Expand Context? (ACON-inspired)

**Research basis:** ACON — signal-preserving context compression.

When `contextPressure.utilizationPct > 0.80`, the controller examines per-section signal density and compresses low-signal sections:
- Old tool results with low `signalDensity` → summarize to key findings
- Repetitive history entries → deduplicate semantically
- Verbose observations → extract facts only

Compression preserves: factual history, action-outcome relationships, task description (never compressed), active skill instructions (never compressed).

**Expected impact:** 26–54% context reduction while preserving 95%+ task accuracy.

**Gate:** Validate on 10 long-horizon runs (>8 iterations) that compression produces equivalent final answers. Measure: context tokens before/after, answer quality, information loss (BERTScore between compressed and full context).

### 2D. Switch or Stay? (entropy-informed strategy switching)

**Research basis:** PRM — step-level scoring for strategy evaluation.

When `trajectory.shape === "flat"` for 3+ consecutive iterations AND `behavioralEntropy.loopDetectionScore > 0.7`:
- The current strategy is not making progress
- Trigger strategy switch (already exists: `withReasoning({ enableStrategySwitching: true })`)
- The entropy trajectory provides a more nuanced trigger than the current binary circuit breaker

**Expected impact:** Earlier detection of stuck strategies. Current circuit breaker fires after N repeated actions. Entropy trajectory detects stagnation even when actions are technically different but semantically identical.

**Gate:** Validate that entropy-informed switching fires earlier and more accurately than current circuit breaker on 10 known-stuck-run scenarios.

### 2E. Attribute or Proceed? (prompt causal analysis)

**Research basis:** Novel application — no existing framework does this.

When the controller has fired 2+ adaptations (2A–2D) without improvement, the problem may be the prompt itself. The controller runs a **lightweight ablation**:
- Generate 3–5 prompt variants with different sections simplified or removed
- Score each with structural + token entropy only (fast, no embedding needed)
- The section whose removal most improves entropy is attributed as the cause

Output: `PromptCausalReport` — developer-actionable. "System prompt instruction 3 causes elevated tool-call entropy on cogito:14b after iteration 4."

**Expected impact:** Transforms "agent is confused" into "this prompt section confuses this model." This is the insight no other framework provides.

**Cost:** 3–5 LLM calls. Only fires diagnostically when the agent is already struggling — not per-iteration. **Guard:** Attribution fires at most once per run and only after 2+ prior adaptations failed to improve entropy. If total run token budget remaining is <20%, attribution is skipped (not worth spending budget on diagnosis when there's no budget left for recovery).

**Gate:** Validate on 10 known-bad-prompt scenarios that the attributed section, when fixed, improves run quality.

---

## System 3: Learning Engine (Phase 3)

Optimizes the system over time using accumulated entropy data.

### 3A. Contextual Bandit for Prompt Selection

**Research basis:** PAK-UCB, Multi-Armed Bandits Meet LLMs.

Replaces the static `ExperimentService` (FNV-1a hash → deterministic variant assignment) with a Thompson Sampling contextual bandit:

```
Context vector: [modelId, taskCategory, iterationBudget, availableTools.length]
Arms: prompt template variants (e.g., react-system-v1, react-system-v2, react-system-local)
Reward: 1 - mean(composite_entropy) from the completed run

On each new run:
  1. Observe context vector
  2. Sample from posterior of each arm
  3. Select arm with highest sampled reward
  4. After run: update posterior with observed reward

Result: system learns in real-time which prompt variants work for which
model × task combinations. No static A/B split required.
```

**Cold start:** First 5 runs per context bucket (discretized `[modelId, taskCategory]` pair) use uniform random selection (pure exploration). After 5 runs in a bucket, Thompson Sampling takes over (explore-exploit balance). Context buckets with fewer than 5 runs inherit the prior from the closest bucket with sufficient data (nearest model tier + task category match).

### 3B. Skill Synthesis from High-Reward Trajectories

When a run completes with:
- `trajectory.shape === "converging"`
- `mean(composite_entropy) < highEntropyThreshold` (below calibrated threshold = consistently high signal)
- `terminatedBy === "final-answer"` (clean completion)

The Learning Engine synthesizes a new skill from the run's successful patterns:
1. Extract the active skills, prompt variant, strategy, and model from the run
2. One small LLM call (~$0.001): "What instructions made this run succeed? Distill into a reusable SKILL.md"
3. Write to `.agent/skills/learned/<date>-<topic>.md`
4. Register in procedural memory with performance metadata

**Human review gate:** Learned skills are NOT auto-committed to git. Developers review via `rax skills review`.

### 3C. Cross-Agent Experience Sharing

High-reward run metadata (entropy traces, winning prompt variants, effective skills) flows into `ExperienceStore` — already exists in `@reactive-agents/memory`. Other agents can query it for relevant prior experience.

### 3D. Model-Specific Optimization Reports (commercial data product)

Aggregated, anonymized entropy × model × task data produces:
- "Optimal prompt style for cogito:14b on data analysis tasks"
- "Model comparison: entropy profiles across 5 models on code generation"
- These are the data products that convert the platform's usage into revenue

---

## Required Changes to Existing Packages

### `@reactive-agents/llm-provider`
- Add to `CompletionRequest`: `logprobs?: boolean`, `topLogprobs?: number` (default 5 when logprobs=true)
- Add `logprobs?: readonly TokenLogprob[]` to `CompletionResponse`
- Add `TokenLogprob` type: `{ token: string; logprob: number; topLogprobs?: { token: string; logprob: number }[] }`
- Wire logprob extraction in Ollama adapter (`logprobs: true` request param, map response `logprobs` field)
- Wire logprob extraction in OpenAI adapter (`logprobs: true`, `top_logprobs: 5` in request)
- Anthropic and Gemini adapters: `logprobs` request param is ignored, response field is `undefined` (no logprob support)

### `@reactive-agents/reasoning`
- Add to `KernelRunOptions`: `taskDescription?: string`, `modelId?: string`, `temperature?: number`
- Kernel runner stores all three into `state.meta` at initialization
- Add typed `entropyMeta` sub-object to `KernelState.meta` to avoid stringly-typed casting:
  ```typescript
  type EntropyMeta = {
    taskDescription?: string;
    modelId?: string;
    temperature?: number;
    lastLogprobs?: readonly TokenLogprob[];
    entropyHistory?: EntropyScore[];
    thoughtEmbeddings?: { embeddings: number[][]; centroid: number[] };
  };
  ```
  Access via `(state.meta.entropy as EntropyMeta | undefined)?.lastLogprobs` — avoids polluting the generic meta namespace. If the sub-object is absent, all entropy sources that depend on it degrade gracefully (semantic → null, token → null).

### `@reactive-agents/verification`
- Export `cosineSimilarity` from public API (currently internal to `semantic-entropy.ts`)
- **Alternative:** Vendor a copy into `@reactive-agents/reactive-intelligence` to avoid coupling the new package to verification for a 10-line utility. Decision at implementation time based on whether other consumers also need the export.

### `@reactive-agents/core`
- Add `EntropyScored`, `ContextWindowWarning`, `CalibrationDrift`, `ReactiveDecision` to `AgentEvent` union
- Add `EntropyTrajectoryShape` type: `"converging" | "flat" | "diverging" | "v-recovery" | "oscillating"`
- Add `AgentEventTag` entries for the 4 new events

### `@reactive-agents/runtime`
- Add `.withReactiveIntelligence()` builder method
- Wire `EntropySensorService` into `KernelRunner` (Phase 1)
- Wire `ReactiveControllerService` into `KernelRunner` (Phase 2)

---

## EventBus Events

```typescript
type EntropyScored = {
  readonly _tag: "EntropyScored";
  readonly taskId: string;
  readonly iteration: number;
  readonly composite: number;
  readonly sources: { token: number | null; structural: number;
                      semantic: number | null; behavioral: number;
                      contextPressure: number };
  readonly trajectory: { derivative: number; shape: EntropyTrajectoryShape; momentum: number };
  readonly confidence: "high" | "medium" | "low";
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly iterationWeight: number;
}

type ContextWindowWarning = {
  readonly _tag: "ContextWindowWarning";
  readonly taskId: string;
  readonly modelId: string;
  readonly utilizationPct: number;
  readonly compressionHeadroom: number;
  readonly atRiskSections: readonly string[];
}

type CalibrationDrift = {
  readonly _tag: "CalibrationDrift";
  readonly taskId: string;
  readonly modelId: string;
  readonly expectedMean: number;
  readonly observedMean: number;
  readonly deviationSigma: number;
}

type ReactiveDecision = {
  readonly _tag: "ReactiveDecision";
  readonly taskId: string;
  readonly iteration: number;
  readonly decision: "early-stop" | "branch" | "compress" | "switch-strategy" | "attribute";
  readonly reason: string;
  readonly entropyBefore: number;
  readonly entropyAfter?: number;   // populated after the decision's effect is measured
}
```

---

## `EntropySensorService` Interface

```typescript
export class EntropySensorService extends Context.Tag("EntropySensorService")<
  EntropySensorService,
  {
    // Score a single reasoning step — never fails.
    // Semantic entropy (1C) requires LLMService.embed() internally.
    // The implementation receives LLMService via constructor injection
    // (Layer.effect dependency), NOT per-call. The Effect signature
    // stays clean — no R channel — because embed failures are caught
    // and excluded from the composite (semantic source = null).
    readonly score: (params: {
      thought: string;
      taskDescription: string;
      strategy: string;
      iteration: number;
      maxIterations: number;
      modelId: string;
      temperature: number;
      priorThought?: string;
      logprobs?: readonly TokenLogprob[];
      kernelState: KernelState;
    }) => Effect.Effect<EntropyScore, never>;

    // Score context window utilization and signal density
    readonly scoreContext: (params: {
      modelId: string;
      sections: ContextSection[];
    }) => Effect.Effect<ContextPressure, never>;

    // Get or initialize calibration for a model
    readonly getCalibration: (modelId: string) => Effect.Effect<ModelCalibration, never>;

    // Update calibration with new run data
    readonly updateCalibration: (
      modelId: string,
      runScores: readonly number[],
    ) => Effect.Effect<ModelCalibration, never>;

    // Get the entropy trajectory for a specific task run.
    // taskId is required because the service is shared via ManagedRuntime
    // across concurrent runs — each run maintains its own trajectory.
    readonly getTrajectory: (taskId: string) => Effect.Effect<EntropyTrajectory, never>;
  }
>() {}
```

**Critical constraints:**
- `score()` returns `Effect<EntropyScore, never>` — never fails. If any source throws, it is caught and excluded from the composite. The sensor must be a reliable observer, not a failure point.
- **LLMService dependency (B1):** The implementation layer depends on `LLMService` via `Layer.effect(EntropySensorService, Effect.gen(function* () { const llm = yield* LLMService; ... }))`. This is standard Effect-TS constructor injection — the `score()` method closes over the `llm` reference. If `LLMService` is not in the runtime (e.g., no embedding provider configured), semantic entropy (1C) degrades to `null` and the composite adjusts weights.
- **Per-task trajectory state (B2):** The service maintains an internal `Map<taskId, EntropyScore[]>` for trajectory tracking. `score()` appends to the task's history; `getTrajectory(taskId)` reads it. Entries are cleaned up when `FinalAnswerProduced` or `ReasoningFailed` events fire for a taskId.

---

## KernelHooks Integration

The Entropy Sensor runs in parallel with existing `onThought` hooks using `Effect.all`.

**Note on state (B3):** The kernel runner uses mutable local variables, not Effect `Ref`. The entropy history is stored inside `KernelState.meta.entropyHistory` (a mutable array) — consistent with how the runner manages `steps`, `tokens`, etc. The `EntropySensorService` also maintains per-task trajectory state internally (see B2 above).

```typescript
// In kernel-runner.ts — additive, no existing behavior changed
//
// entropySensor is resolved once at runner initialization:
//   const entropySensor = yield* Effect.serviceOption(EntropySensorService);
// This returns Option<EntropySensorService> — None if the layer isn't provided.

yield* Effect.all(
  [
    hooks.onThought(state, thought),
    entropySensor._tag === "Some"
      ? entropySensor.value.score({
          thought,
          taskDescription: (state.meta.taskDescription as string) ?? "",
          strategy: state.strategy,
          iteration: state.iteration,
          maxIterations: (state.meta.maxIterations as number) ?? 10,
          modelId: (state.meta.modelId as string) ?? "unknown",
          temperature: (state.meta.temperature as number) ?? 0,
          priorThought: lastThought,
          logprobs: state.meta.lastLogprobs as readonly TokenLogprob[] | undefined,
          kernelState: state,
        }).pipe(
          Effect.tap(score => {
            // Mutable append — matches kernel runner's existing mutation pattern
            const history = (state.meta.entropyHistory as EntropyScore[] | undefined) ?? [];
            history.push(score);
            state.meta.entropyHistory = history;
            return eventBus.publish({ _tag: "EntropyScored", taskId: state.taskId, ...score });
          }),
          Effect.catchAll(() => Effect.void),
        )
      : Effect.void,
  ],
  { concurrency: "unbounded" },
);
```

---

## Builder API

```typescript
// Phase 1: observe only
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReactiveIntelligence({
    // Entropy Sensor (Phase 1)
    entropy: {
      enabled: true,
      tokenEntropy: true,           // enable per-token tracking (requires logprobs)
      semanticEntropy: true,        // enable embedding-based cross-iteration
      trajectoryTracking: true,     // enable entropy curve analysis
    },
    // Reactive Controller (Phase 2, defaults to off)
    controller: {
      earlyStop: false,             // 2A: Think Just Enough
      branching: false,             // 2B: EAGer-inspired entropy-guided branching
      contextCompression: false,    // 2C: ACON-inspired
      strategySwitch: false,        // 2D: entropy-informed switching
      causalAttribution: false,     // 2E: prompt section ablation
    },
    // Learning Engine (Phase 3, defaults to off)
    learning: {
      banditSelection: false,       // contextual bandit for prompts
      skillSynthesis: false,        // learned skill generation
    },
  })
  .build();

// Phase 2+3: fully reactive
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withReactiveIntelligence({
    entropy: { enabled: true },
    controller: {
      earlyStop: true,
      branching: true,
      contextCompression: true,
      strategySwitch: true,
      causalAttribution: true,
    },
    learning: {
      banditSelection: true,
      skillSynthesis: true,
      skillDir: ".agent/skills/learned",
    },
  })
  .build();
```

---

## Observability: The Entropy Dashboard

The MetricsCollector auto-subscribes to `EntropyScored` events. The dashboard gains a new section with the entropy trajectory as the visual signature:

```
🧠 Reactive Intelligence
├─ Entropy trajectory:  ████▇▅▃▂▁  converging ✓
├─ Avg entropy:         0.23  (calibrated baseline: 0.31, -0.08 improvement)
├─ Signal confidence:   high  (token + structural + semantic + behavioral)
├─ Context utilization: 43% of 32k  (12k compressible)
├─ Entropy spikes:      2  (iter 3 pos 47, iter 5 pos 12)
├─ Decisions fired:     1  (iter 6: early-stop — trajectory converging)
├─ Tokens saved:        ~2,400  (4 iterations skipped)
├─ Model: cogito:14b  [calibrated, 24 runs, no drift]
└─ Prompt variant:      react-system-v3  (bandit-selected, reward: 0.81)
```

The entropy trajectory bar (`████▇▅▃▂▁`) is the visual signature of a healthy run. Developers learn to read it:
- **Falling** (`████▇▅▃▂▁`) = converging, healthy
- **Flat** (`████████████`) = stuck, needs intervention
- **Rising** (`▁▂▃▅▇████`) = diverging, prompt or context issue
- **V-shape** (`████▁▁████`) = recovered from confusion
- **Oscillating** (`█▁█▁█▁█▁`) = unstable, systemic issue

---

## Model Registry

Model IDs use the normalized form returned by each provider's `CompletionResponse.model`. The `ModelRegistry` uses prefix-match fallback for versioned IDs.

```typescript
const MODEL_REGISTRY: Record<string, { contextLimit: number; tier: "frontier" | "local"; logprobSupport: boolean }> = {
  // Ollama (tag format)
  "cogito:14b":       { contextLimit: 32_768,  tier: "local",    logprobSupport: true },
  "qwen3.5:14b":      { contextLimit: 32_768,  tier: "local",    logprobSupport: true },
  "qwen3:14b":        { contextLimit: 32_768,  tier: "local",    logprobSupport: true },
  "llama3.3:70b":     { contextLimit: 131_072, tier: "local",    logprobSupport: true },
  // Anthropic (prefix-match — matches "claude-sonnet-4-20250514" etc.)
  "claude-sonnet-4":  { contextLimit: 200_000, tier: "frontier", logprobSupport: false },
  "claude-opus-4":    { contextLimit: 200_000, tier: "frontier", logprobSupport: false },
  "claude-haiku-4":   { contextLimit: 200_000, tier: "frontier", logprobSupport: false },
  // OpenAI
  "gpt-4o":           { contextLimit: 128_000, tier: "frontier", logprobSupport: true },
  "gpt-4o-mini":      { contextLimit: 128_000, tier: "frontier", logprobSupport: true },
  // Extensible via config — users can add entries via .withReactiveIntelligence({ models: { ... } })
  // Unknown models default to: { contextLimit: 32_768, tier: "unknown", logprobSupport: false }
};
```

---

## Package Structure

```
packages/reactive-intelligence/
  src/
    sensor/
      entropy-sensor.ts          — EntropySensorService implementation
      token-entropy.ts           — 1A: TECP-inspired per-token entropy
      structural-entropy.ts      — 1B: format compliance, hedge detection
      semantic-entropy.ts        — 1C: centroid-based cross-iteration
      behavioral-entropy.ts      — 1D: PRM step-level scoring
      context-pressure.ts        — 1E: wraps ContextWindowManager
      entropy-trajectory.ts      — 1F: trajectory shape classification
      composite.ts               — weighted combination + iteration weighting
    calibration/
      conformal.ts               — split conformal prediction
      model-registry.ts          — context limits, tier, logprob support
      calibration-store.ts       — SQLite persistence for calibration data
    controller/                  — Phase 2 (empty stubs for now)
      early-stop.ts              — 2A: Think Just Enough
      branching.ts               — 2B: EAGer-inspired entropy-guided branching
      context-compressor.ts      — 2C: ACON-inspired
      strategy-switch.ts         — 2D: entropy-informed switching
      causal-attribution.ts      — 2E: prompt section ablation
    learning/                    — Phase 3 (empty stubs for now)
      bandit.ts
      skill-synthesis.ts
    types.ts
    events.ts
    runtime.ts
    index.ts
  tests/
    sensor/
      validation-dataset.ts      — ≥60 labeled ground-truth cases
      token-entropy.test.ts
      structural-entropy.test.ts
      semantic-entropy.test.ts
      behavioral-entropy.test.ts
      context-pressure.test.ts
      entropy-trajectory.test.ts
      composite.test.ts          — full accuracy against validation set
      false-positive-rate.test.ts
    calibration/
      conformal.test.ts
      calibration-convergence.test.ts
    integration/
      kernel-integration.test.ts — verifies parallel execution with KernelRunner
      event-flow.test.ts         — verifies EntropyScored reaches dashboard
  package.json
  tsconfig.json
```

**Dependencies:**
- `@reactive-agents/core` — EventBus, types, `estimateTokens()` utility
- `@reactive-agents/llm-provider` — LLMService.embed() for semantic entropy, TokenLogprob type
- `@reactive-agents/reasoning` — KernelState, KernelHooks, KernelRunOptions
- `@reactive-agents/verification` — cosineSimilarity (exported)
- `bun:sqlite` — calibration persistence
- No new external dependencies

---

## Validation Dataset Specification

**Minimum:** ≥60 labeled examples, ≥15 per category:

| Category | Expected composite | Count | Description |
|---|---|---|---|
| High-signal | < 0.3 (low entropy) | ≥15 | Correct tool calls, coherent reasoning, on-task progress |
| Low-signal | > 0.7 (high entropy) | ≥15 | Malformed JSON, verbatim repetition, topic drift, pure hedging |
| Ambiguous | 0.3–0.7 | ≥15 | Short but correct, legitimate exploration, jargon-heavy |
| Trajectory | varies | ≥15 | Multi-step sequences with known trajectory shapes (converging, flat, v-recovery) |

**Labeling protocol:** Dual review. Disagreements use the more conservative label. Dataset committed to `tests/sensor/validation-dataset.ts` and immutable during Phase 2 gate check.

---

## Feasibility Checkpoints

### Phase 1 Gate (Entropy Sensor → ready for Phase 2)
1. **Classification accuracy ≥90%** on the validation dataset (composite < 0.3 = high-signal, > 0.7 = low-signal)
2. **Conformal coverage verified** — false positive rate ≤5% with mathematical coverage guarantee on held-out calibration set (20 runs)
3. **Model calibration converges** — thresholds change < 0.02 after calibration stabilizes for cogito:14b and at least one frontier model
4. **Token entropy correlation** — Spearman ρ > 0.6 between Layer 1A token entropy and final run quality (EvalService accuracy) on a 20-run Ollama test suite
5. **Trajectory shape classification** — correctly identifies converging, flat, and diverging shapes on the trajectory test cases
6. **Context pressure accurate** — token estimates within 10% of actual (verified against Ollama API usage)
7. **No blocking latency** — sync sources add ≤2ms p99. Semantic entropy adds ~50ms in parallel.
8. **EntropyScored events flow** to observability dashboard across all 5 reasoning strategies

### Phase 2 Gates (one per sub-phase)
- **2A Early stop:** answer quality ≥ baseline on 20 runs, with ≥20% compute savings
- **2B Branching:** entropy spikes correlate with decision points (ρ > 0.5, 30 labeled examples)
- **2C Compression:** ≥20% context reduction, ≤2% answer quality loss on 10 long runs
- **2D Strategy switch:** fires earlier AND more accurately than current circuit breaker on 10 stuck scenarios
- **2E Causal attribution:** correctly identifies the causative prompt section on 10 known-bad-prompt cases

### Phase 3 Gates
- **3A Bandit:** converges to best variant within 15 runs (measured on 3 model × task combinations)
- **3B Skill synthesis:** generated skills pass human review at ≥70% acceptance rate

**If any gate fails, that phase does not ship.** Passing phases are not discarded — the system operates at the highest validated phase level.

---

## What This Unlocks

When all three systems are validated and active, a Reactive Agent:

1. **Senses** its own uncertainty at every reasoning step via the Entropy Sensor
2. **Stops early** when it recognizes it has solved the problem (25–50% compute savings)
3. **Branches** at decision points where it is uncertain, exploring alternatives efficiently (40–65% token reduction)
4. **Compresses** context intelligently, preserving high-signal sections and summarizing noise (26–54% memory savings)
5. **Switches** strategies when entropy stagnates, using nuanced trajectory analysis instead of binary circuit breakers
6. **Attributes** prompt issues to specific sections, giving developers actionable diagnostics
7. **Learns** which prompt variants work for which models via online bandit optimization
8. **Synthesizes** reusable skills from high-quality runs, growing the skill library over time
9. **Shares** experience across agents, so every agent benefits from every other agent's learning

This is what a reactive agent is. Not an agent that reacts to user input — an agent that reacts to its own cognitive state.
