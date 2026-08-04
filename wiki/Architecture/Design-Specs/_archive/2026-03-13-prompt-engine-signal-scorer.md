# Prompt Engine — Signal Scorer Core
**Date:** 2026-03-13
**Status:** Research-validated draft
**Package:** `@reactive-agents/prompt-engine` (new)
**Scope:** Phase 1 — Signal scoring foundation only. The learning loop, skill synthesis, and variant promotion are explicitly deferred until signal scoring is validated.

---

## Problem

Prompting is the single highest-leverage variable in agent performance, but it is currently:
- **Static** — prompts are authored once, tuned manually, and never adapt to the model or task
- **Opaque** — there is no measurement of whether a prompt is producing high or low quality signal per iteration
- **Fragile** — changing a prompt for one model can silently degrade another
- **Context-blind** — no awareness of how much prompt is outside the model's context window, or which tokens carried the most signal

The specific pain point observed in real runs: cogito:14b and qwen3.5 respond to the same ReAct prompt in meaningfully different ways. A presentation that elicits structured tool calls from one produces verbose, wandering reasoning from the other. There is no current mechanism to detect this divergence, let alone correct it.

**The core feasibility question this spec answers:** Can we build a signal scorer accurate enough to trust? Everything else (mid-flight adaptation, cross-run learning, skill system) is downstream of this answer. If the scorer produces false positives, the whole system poisons itself.

---

## Research Foundations

The signal scorer is grounded in five validated research threads. Each algorithmic choice below maps to a specific finding.

### 1. Process Reward Models (PRM) — the framing
The scorer is architecturally a **lightweight PRM** — it assigns a scalar quality score to each intermediate reasoning step rather than only the final output. PRM research (2024-2025) validates this framing: step-level rewards are more informative than outcome-level scoring for multi-step reasoning trajectories. In PRM inference usage, "positive steps are accepted, negative or neutral steps trigger search expansion or backtracking" — this is precisely the Phase 2 adaptation layer design.

**Why it matters:** We aren't inventing a new evaluation paradigm. We are building a computationally cheap, real-time PRM tailored to ReAct-style agent reasoning, without requiring labeled training data.

*References: "The Lessons of Developing Process Reward Models in Mathematical Reasoning" (Jan 2025), "Enhancing LLM Agents with Automated Process Supervision" (EMNLP 2025)*

### 2. TECP — token entropy as the logprob signal (Layer 2)
Token-Entropy Conformal Prediction (TECP, 2025) treats the **cumulative token entropy** of a generated sequence as a nonconformity score and integrates it with split conformal prediction for coverage-guaranteed thresholds. Token entropy per token: `H(t) = -∑(p_i × log p_i)` over the top-k logprob distribution. Summed across the sequence and length-normalized, this is demonstrably more calibrated than raw mean logprob.

**Critical finding from multiple 2024-2025 papers:** Length-normalized log-likelihood always outperforms raw log-likelihood. Raw logprobs are length-biased and must never be used unnormalized.

**Why it matters:** Layer 2 should compute length-normalized cumulative token entropy, not raw mean logprob. This is statistically grounded and pairs with conformal calibration for coverage guarantees.

*References: "TECP: Token-Entropy Conformal Prediction for LLMs" (arxiv:2509.00461), "Evaluating Log-Likelihood for Confidence Estimation in LLM-Based MCQA" (2025), "QA-Calibration of Language Model Confidence Scores" (ICLR 2025)*

### 3. Conformal prediction — statistically grounded thresholds (calibration layer)
ConU (2024) and TECP both show that conformal prediction over a calibration set produces thresholds with **finite-sample coverage guarantees** rather than arbitrary cutoffs. The nonconformity score from the calibration set determines the threshold at the desired coverage level (90%). This replaces arbitrary 0.4/0.6 boundaries with mathematically verifiable bounds.

**Why it matters:** Our 5-run per-model calibration protocol maps directly onto split conformal prediction. After calibration, the low-signal threshold has a coverage guarantee — meaning at most X% of false positives by construction, not by hope.

*References: "ConU: Conformal Uncertainty in Large Language Models with Correctness Coverage Guarantees" (EMNLP 2024), "TECP" (2025), "Selective Conformal Uncertainty in LLMs" (ACL 2025)*

### 4. SelfCheckGPT principle — consistency without N samples (Layer 3)
SelfCheckGPT (2023) demonstrates that **hallucinated content is not reproducible** — consistent facts produce consistent embeddings across samples, hallucinated facts diverge. We apply this principle to consecutive iterations within a single run: compare the current thought's embedding against the **centroid of all prior thoughts** in the run. Low distance to centroid = repetition (bad signal). High distance = novel progress (good signal). This avoids SelfCheckGPT's N-sample overhead by using the run's own history as the consistency check.

**Why it matters:** Layer 3 gains a theoretically grounded repetition/progress signal without any additional LLM calls.

*References: "SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection" (EMNLP 2023), "Confidence Improves Self-Consistency in LLMs" (ACL 2025)*

### 5. LM-Polygraph validation — heuristics are strong baselines
The LM-Polygraph benchmark (2024, published TACL 2025) evaluated 20+ uncertainty quantification methods across 11 tasks. Key finding: **"Simple methods, like checking the probability of the most likely answer sequence, can be surprisingly effective for short outputs."** Complex methods (semantic entropy, consistency sampling) only clearly outperform heuristics on complex, long-form tasks. For ReAct-style structured reasoning (short, formatted thoughts), Layer 1 structural heuristics will carry significant weight.

**Why it matters:** Build and validate Layer 1 before investing in Layer 3. Don't over-engineer before measuring baseline performance.

*References: "Benchmarking Uncertainty Quantification Methods for Large Language Models with LM-Polygraph" (TACL 2025, arxiv:2406.15627)*

---

## Design Principles

1. **Measure before acting.** The scorer ships before any adaptation. Weeks of observability data validate accuracy before a single adaptation fires.
2. **Conservative by default.** Thresholds are set high. Adaptation requires multiple consecutive low-signal iterations, not a single dip.
3. **Layered with fallbacks.** Each signal source degrades gracefully. Logprobs unavailable → fall back to structural heuristics. No embedding service → skip semantic drift.
4. **Model-aware from day one.** Signal baselines are per-model, not global. What looks like low signal from cogito:14b may be normal for that model's style.
5. **Falsifiable.** The test harness includes known-good and known-bad outputs with ground-truth labels. The scorer must achieve >90% classification accuracy on the validation set before anything is built on top of it.

---

## Required Changes to Existing Packages

This package consumes data that does not yet exist in the kernel's data flow. These upstream changes are part of the implementation scope:

### `@reactive-agents/llm-provider`
- Add `logprobs?: readonly TokenLogprob[]` to `CompletionResponse` type
- Add `TokenLogprob` type: `{ token: string; logprob: number; bytes?: number[] }`
- Wire logprob extraction in Ollama adapter (`logprobs: true` request param, map response)
- Wire logprob extraction in OpenAI adapter (same — `logprobs: true` in request)
- Anthropic and Gemini adapters: no change, field is `undefined`

### `@reactive-agents/reasoning` (KernelState + KernelRunOptions)
- Add `taskDescription?: string` to `KernelRunOptions` (passed by callers: `executeReActKernel`, `runKernel`)
- Add `modelId?: string` to `KernelRunOptions`
- The kernel runner stores both into `state.meta` at initialization
- Add `lastLogprobs?: readonly TokenLogprob[]` to `KernelState.meta` — kernel runner updates this after each LLM call by reading from the `CompletionResponse`
- Add `signalHistory?: SignalScore[]` to `KernelState.meta` — populated by the signal scorer hook

### `@reactive-agents/verification`
- Export `cosineSimilarity` from `packages/verification/src/index.ts` so Layer 3 can reuse it without reimplementing

### `@reactive-agents/core`
- Add `SignalScored` and `ContextWindowWarning` (see Events section) to `AgentEvent` union

---

## Architecture Overview

```
KernelHooks.onThought()
    │
    ▼
SignalScorerService.score(thought, context)
    │
    ├── Layer 1: StructuralSignal     (sync, O(1), always available)
    ├── Layer 2: LogprobSignal        (sync, model-dependent — Ollama/OpenAI)
    ├── Layer 3: SemanticDriftSignal  (async, 1 embed call, optional)
    └── Layer 4: BehavioralSignal     (sync, accumulated per-run state)
    │
    ▼
SignalScore { composite: number, dimensions: DimensionScores, modelTier, confidence }
    │
    ├── EventBus.publish(SignalScored)     → Observability dashboard
    ├── KernelState.signalHistory[]        → Adaptation layer (future)
    └── EpisodicMemory                     → Cross-run analysis (future)
```

---

## Signal Scoring Layers

### Layer 1: Structural Signal
**Cost:** sync, <1ms, zero dependencies
**Always available**

Measures whether the model's output conforms to expected format and contains substantive reasoning.

```typescript
type StructuralSignal = {
  formatCompliance: number;   // 0–1: does output match expected ReAct/tool-call structure?
  thoughtDensity: number;     // 0–1: ratio of reasoning content vs filler/repetition
  vocabularyDiversity: number; // 0–1: type-token ratio (low = repetitive = confused)
  hedgePenalty: number;       // 0–1: presence of uncertainty markers ("maybe", "I think", "not sure")
}
```

**Inspiration:** The existing `checkSemanticEntropyHeuristic` in `packages/verification` already implements vocabulary diversity + hedge detection. Layer 1 reuses and extends this — no new invention, validated existing code.

**Format compliance** checks vary by strategy:
- ReAct: expects `Thought:` → `Action:` → structured JSON tool call
- Plan-Execute: expects numbered plan steps with `Step N:` markers
- ToT: expects branching exploration with explicit scoring

**False positive risk:** Low. Structural checks are deterministic and model-output-independent. A perfectly coherent response that happens to be brief scores slightly lower on density — acceptable tradeoff.

---

### Layer 2: Logprob Signal (TECP-inspired)
**Cost:** zero — uses data already returned by the LLM API
**Available when:** Ollama (all models), OpenAI (`logprobs: true`), some Anthropic models
**Not available:** most Anthropic API responses, Gemini

Grounded in TECP (Token-Entropy Conformal Prediction, 2025). The primary signal is **length-normalized cumulative token entropy** — a statistically stronger measure than raw mean logprob. Raw logprobs are length-biased and must never be used unnormalized (multiple 2024-2025 calibration papers confirm this).

**Algorithm:**

```
For each token t_i in the response with top-k logprob distribution {(token_j, lp_j)}:
  1. Convert logprobs to probabilities: p_j = exp(lp_j)
  2. Normalize top-k to sum to 1: p_j_norm = p_j / ∑p_j
  3. Token entropy: H(t_i) = -∑(p_j_norm × log(p_j_norm))
  4. Normalize by log(k): H_norm(t_i) = H(t_i) / log(k)  → range [0,1]

Cumulative sequence entropy: E_seq = ∑H_norm(t_i) / N_tokens  (length-normalized)

Tool-call region entropy: E_tool = same computation over tokens inside JSON tool call
  (higher sensitivity — model uncertainty here predicts tool call failures)

Min-token entropy: E_min = max(H_norm(t_i))  (worst single token position)
```

```typescript
type LogprobSignal = {
  cumulativeEntropy: number;  // length-normalized cumulative token entropy [0,1]
                              // high entropy = model uncertain = low signal
                              // primary signal — grounded in TECP (2025)
  toolCallEntropy: number;    // entropy over tool call JSON tokens specifically
                              // most sensitive predictor of tool call failures
  peakTokenEntropy: number;   // highest single-token entropy in response
                              // flags specific uncertainty spikes
  available: boolean;
}
```

**Score mapping:** `logprobScore = 1 - cumulativeEntropy` (inverted — high entropy = low signal)

**Key insight for local models:** cogito:14b and qwen3.5 both surface logprobs via Ollama with top-k distributions. This makes Layer 2 the highest-fidelity signal for the local model edge. Frontier models via API rarely expose logprobs, making this an exclusive advantage for local deployments.

**Tool call entropy** is the highest-value sub-signal. A model uncertain about the tool name or argument JSON structure shows elevated entropy at those exact token positions — directly predicting failures before they occur.

**False positive risk:** Medium-low. Token entropy is more calibrated than raw logprob and less sensitive to temperature variation. Still requires per-model baseline calibration (see Conformal Calibration section).

**Temperature consideration:** Models running at temperature 0 have artificially compressed entropy (greedy decoding). At temperature 0, entropy scores should be discounted — the distribution has been forced, not chosen. Track `temperature` from the completion metadata.

---

### Layer 3: Semantic Drift Signal
**Cost:** 1 embedding call (~50ms, ~100 tokens)
**Available when:** embedding service configured
**Skipped when:** no embedding service, or iteration 1 (no prior thought to compare to)

Measures two things using the **SelfCheckGPT consistency principle** applied to the run's own history — no N-sample overhead required. SelfCheckGPT (2023) showed that hallucinated/confused content is not reproducible across samples. We exploit the analogous property across iterations: a model making genuine progress produces semantically distinct thoughts; a confused or looping model produces semantically convergent ones.

**Algorithm:**

```
Maintain thought_embeddings[]: embedding of each prior thought in this run

1. Task alignment:
   taskAlignment = cosineSimilarity(embed(currentThought), embed(taskDescription))
   → low alignment = drifting off-task

2. Centroid-based repetition detection (SelfCheckGPT principle, no N samples):
   if thought_embeddings.length >= 2:
     centroid = mean(thought_embeddings)  // centroid of all prior thoughts
     distFromCentroid = 1 - cosineSimilarity(embed(currentThought), centroid)
     // high distance = novel contribution (good signal)
     // low distance = repetition / convergence (bad signal — stuck in a loop)
   else:
     distFromCentroid = 0.5  // neutral for first few iterations

3. Pairwise adjacent comparison (catches immediate repetition):
   if thought_embeddings.length >= 1:
     adjacentSim = cosineSimilarity(embed(currentThought), thought_embeddings[-1])
     // >0.95 = near-verbatim repetition — strong low-signal indicator
```

```typescript
type SemanticDriftSignal = {
  taskAlignment: number;        // cosine sim: current thought vs task description [0,1]
                                // low = drifting off-task
  noveltyScore: number;         // distance from centroid of prior thoughts [0,1]
                                // 1 - cosineSim(current, centroid)
                                // high = novel progress, low = repetition
                                // grounded in SelfCheckGPT consistency principle
  adjacentRepetition: number;   // cosine sim: current vs immediately prior thought
                                // >0.95 triggers high-confidence low-signal flag
  available: boolean;
}
```

**Embedding cache:** `thought_embeddings[]` is maintained in `KernelState.meta` across iterations. The centroid is recomputed incrementally (`newCentroid = (oldCentroid × n + newEmbedding) / (n+1)`) — O(d) per iteration, not O(n×d).

**Inspiration:** Derived from `packages/verification/src/layers/semantic-entropy.ts`. Reuses the exported `cosineSimilarity()` helper and embedding infrastructure.

**False positive risk:** Low-medium. Task alignment naturally drops when the agent is doing intermediate steps that are legitimately off-topic (e.g., "I need to check the file structure before answering"). Mitigation: weight task alignment less in early iterations, more in later ones.

---

### Layer 4: Behavioral Signal
**Cost:** sync, O(1), uses accumulated KernelState
**Always available after iteration 1**

Aggregates behavioral patterns over the current run that are predictive of final quality:

```typescript
type BehavioralSignal = {
  toolSuccessRate: number;      // successful tool calls / total tool calls this run
  iterationEfficiency: number;  // (unique actions taken) / iteration
                                // formula: Set(actions).size / state.iteration
                                // low = repeating same actions, high = exploring new paths
  loopDetectionScore: number;   // 0 = clean run, 1 = detected repetition patterns
  finalAnswerApproach: number;  // 0–1: is reasoning trending toward completion?
                                // heuristic: presence of completion markers in recent thoughts
                                // ("therefore", "in conclusion", "the answer is", final-answer tool called)
}
```

`loopDetectionScore` formalizes the existing circuit breaker fix from the v0.8 sprint. The fix changed `steps.slice(-N).filter()` to `steps.filter().slice(-N)` — Layer 4 makes this detection a first-class signal rather than a binary switch.

**False positive risk:** Low. Behavioral signals are accumulated facts about what happened, not predictions.

---

## Composite Score

```typescript
type SignalScore = {
  composite: number;           // weighted combination of available layers
  dimensions: {
    structural: number;
    logprob: number | null;    // null if not available
    semanticDrift: number | null;
    behavioral: number;
  };
  confidence: "high" | "medium" | "low";  // based on how many layers are available
  modelTier: "frontier" | "local" | "unknown";
  iteration: number;
  timestamp: number;
}
```

**Weighting (initial, tunable):**
| Layer | Weight (logprobs available) | Weight (logprobs unavailable) |
|---|---|---|
| Structural | 0.25 | 0.40 |
| Logprob | 0.35 | — |
| Semantic Drift | 0.20 | 0.35 |
| Behavioral | 0.20 | 0.25 |

Weights are stored in a per-model configuration that the learning loop can tune. Initial values are conservative estimates — intentionally set so the composite score is harder to push into "low signal" territory.

**Confidence tiers:**
- `"high"` — all 4 layers available (Ollama models with embedding service)
- `"medium"` — 2–3 layers (frontier models without logprobs, or no embedding service)
- `"low"` — structural + behavioral only (minimal config)

Adaptation is **disabled** when confidence is `"low"` — not enough signal to act on.

---

## Context Window Awareness

A critical capability for local models: knowing when prompt content is being truncated or pushed out of the active context window.

`scoreContextWindow()` is a higher-level signal wrapper built on top of the existing `ContextWindowManager` service in `@reactive-agents/core`, which already provides `estimateTokens()` and `fitsInContext()`. This layer adds signal density estimation and section-level analysis on top of those primitives — it does not reimplement token counting.

```typescript
type ContextWindowState = {
  modelContextLimit: number;       // loaded from model registry (e.g. cogito:14b = 32k)
  currentPromptTokens: number;     // estimated tokens in current prompt
  utilizationPct: number;          // currentPromptTokens / modelContextLimit
  atRiskSections: ContextSection[]; // sections likely outside attention focus
  highSignalSections: ContextSection[]; // sections with highest estimated signal density
}

type ContextSection = {
  label: string;                   // "system-prompt" | "tool-results" | "history" | "task"
  tokenEstimate: number;
  signalDensity: number;           // estimated signal per token
  position: "near" | "mid" | "far"; // relative to current attention position
}
```

**Token estimation:** Uses the `cl100k_base` tiktoken approximation (no API call needed — character count × 0.25 is a fast proxy, actual tokenizer used when available).

**Signal density estimation** per section:
- `task` — always high (the reason we're here)
- `tool-results` — high if recent, decreasing with age
- `system-prompt` — medium (static context)
- `history` — decreasing with distance from current iteration

When `utilizationPct > 0.85`, a `ContextWindowWarning` event fires (defined in the Events section below). When `> 0.95`, the prompt adapter (future phase) can begin compacting low-signal sections.

**Model registry (initial entries):**

Model IDs use the normalized form returned by each provider's `CompletionResponse.model` field. Ollama uses tag format (`"model:size"`); Anthropic uses versioned API IDs; OpenAI uses canonical names. The `ModelRegistry` normalizes lookups with a prefix-match fallback so `"claude-sonnet-4-20250514"` matches the `"claude-sonnet-4"` prefix entry.

```typescript
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Ollama (tag format from CompletionResponse.model)
  "cogito:14b": 32_768,
  "qwen3.5:14b": 32_768,
  "qwen3:14b": 32_768,
  // Anthropic (versioned API ID prefix — matches "claude-sonnet-4-20250514" etc.)
  "claude-sonnet-4": 200_000,
  "claude-opus-4": 200_000,
  "claude-haiku-4": 200_000,
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  // extensible via config
};
```

---

## Conformal Calibration (Per-Model Thresholds with Coverage Guarantees)

Replaces arbitrary thresholds with statistically grounded bounds, using split conformal prediction (ConU 2024, TECP 2025). This is the primary false positive mitigation.

**Why conformal prediction:** Conformal prediction is distribution-free and model-agnostic. Given a calibration set of scored outputs, it produces a threshold that guarantees at most `α` false positives with finite-sample validity — not asymptotically, but for any sample size ≥ 5.

**Algorithm:**

```
Calibration phase (first MIN_CALIBRATION_RUNS = 10 runs per model):

  For each calibration run:
    Collect signal scores {s_1, s_2, ..., s_n} per iteration

  Nonconformity scores: R_i = 1 - s_i  (high = unusual = potentially low-signal)

  At desired false-positive rate α = 0.05 (5% FP budget):
    q̂ = quantile(R_1...R_n, ceil((n+1)(1-α)) / n)
    lowSignalThreshold = 1 - q̂

  Result: threshold with statistical guarantee that ≤5% of normal outputs
  are misclassified as low-signal for THIS specific model.

Incremental update: each new run adds its scores to the calibration set.
Threshold recomputed after every 5 new runs.
```

```typescript
type ModelSignalBaseline = {
  modelId: string;
  calibrationScores: readonly number[];  // all nonconformity scores from calibration runs
  sampleCount: number;
  lowSignalThreshold: number;    // conformal threshold at α=0.05
  highSignalThreshold: number;   // conformal threshold at α=0.20 (top quintile)
  calibrated: boolean;           // true after sampleCount >= MIN_CALIBRATION_RUNS (10)
  lastUpdated: number;           // timestamp — thresholds decay after 30 days without update
}
```

**Coverage guarantee:** Once calibrated, the scorer guarantees ≤5% false positive rate for that specific model. This is a mathematical bound, not a heuristic estimate. The feasibility checkpoint can be stated as: "conformal coverage verified on held-out calibration set."

**Before calibration:** Scoring runs in observation-only mode with wide default thresholds. No low-signal flags fire until the model has enough calibration data.

**Model distribution shift:** If a model's signal scores drift significantly from the calibration set (e.g., after a model update or context length change), the calibration set is invalidated. A `CalibrationDrift` event fires when the current run's scores exceed 2σ from the calibration mean.

---

## `SignalScorerService` Interface

```typescript
export class SignalScorerService extends Context.Tag("SignalScorerService")<
  SignalScorerService,
  {
    // Score a single thought in context
    readonly score: (params: {
      thought: string;
      taskDescription: string;
      iteration: number;
      modelId: string;
      priorThought?: string;
      logprobs?: TokenLogprob[];        // from LLM response if available
      kernelState: KernelState;
    }) => Effect.Effect<SignalScore, never>; // never fails — always returns a score

    // Score context window utilization
    readonly scoreContextWindow: (params: {
      modelId: string;
      sections: ContextSection[];
    }) => Effect.Effect<ContextWindowState, never>;

    // Get or initialize baseline for a model
    readonly getBaseline: (modelId: string) => Effect.Effect<ModelSignalBaseline, never>;

    // Update baseline with a new run's signal data
    readonly updateBaseline: (
      modelId: string,
      runSignalScores: readonly number[],
    ) => Effect.Effect<ModelSignalBaseline>;
  }
>() {}
```

**PRM framing:** `SignalScorerService` is architecturally a **lightweight Process Reward Model**. Each call to `score()` produces a step-level reward signal for the current reasoning iteration. This connects directly to the PRM literature: positive step scores = accepted, negative/neutral = Phase 2 adaptation trigger. This framing also enables future fine-tuning — high-signal run traces are labeled PRM training data.

**Critical design choice:** `score()` returns `Effect<SignalScore, never>` — it never fails. If a layer throws, it is caught and omitted from the composite. The scorer must be a reliable observer, not a failure point in the execution path.

---

## KernelHooks Integration

The signal scorer hooks into `onThought` without modifying `buildKernelHooks()`. Instead, the `KernelRunner` receives an optional `SignalScorerService` and runs it **in parallel** with the existing `onThought` hook using `Effect.all`:

```typescript
// In kernel-runner.ts — additive, no existing behavior changed
// Both the existing hook and signal scoring run concurrently
yield* Effect.all(
  [
    hooks.onThought(state, thought),
    signalScorer
      ? signalScorer.score({
          thought,
          taskDescription: (state.meta.taskDescription as string) ?? "",
          iteration: state.iteration,
          modelId: (state.meta.modelId as string) ?? "unknown",
          priorThought: lastThought,
          logprobs: state.meta.lastLogprobs as readonly TokenLogprob[] | undefined,
          kernelState: state,
        }).pipe(
          Effect.tap(score => eb.publish({ _tag: "SignalScored", ...score })),
          Effect.tap(score => Ref.update(signalHistoryRef, h => [...h, score])),
          Effect.catchAll(() => Effect.void),
        )
      : Effect.void,
  ],
  { concurrency: "unbounded" },
);
```

Layer 3 (semantic drift, ~50ms embed call) runs asynchronously within `score()` and does not block the composite result if unavailable. Layers 1, 2, and 4 are sync and complete in <1ms. The p99 latency impact is therefore:
- Without embedding service: <1ms (sync layers only)
- With embedding service: ~50ms added to `onThought` phase (acceptable, runs in parallel with hook)

The signal score is available in `signalHistoryRef` for any downstream consumer, but nothing acts on it yet.

---

## New EventBus Events

Both events are added to the `AgentEvent` union in `@reactive-agents/core`:

```typescript
type SignalScored = {
  readonly _tag: "SignalScored";
  readonly taskId: string;
  readonly iteration: number;
  readonly composite: number;
  readonly dimensions: {
    structural: number;
    logprob: number | null;
    semanticDrift: number | null;
    behavioral: number;
  };
  readonly confidence: "high" | "medium" | "low";
  readonly modelTier: "frontier" | "local" | "unknown";
}

type ContextWindowWarning = {
  readonly _tag: "ContextWindowWarning";
  readonly taskId: string;
  readonly modelId: string;
  readonly utilizationPct: number;     // e.g. 0.87
  readonly currentTokens: number;
  readonly contextLimit: number;
  readonly atRiskSections: readonly string[];  // labels of sections near truncation
}
```

---

## Test Harness

The test harness is the most important part of this spec. The scorer is only trustworthy if it can be validated against known cases.

### Validation Dataset
A set of labeled (thought, context, expected_quality) tuples, covering:

**Known-high-signal outputs** (score should be > 0.7):
- Correct, well-structured tool call with precise arguments
- Coherent multi-step reasoning that references prior observations
- On-task thought that makes clear progress toward the goal

**Known-low-signal outputs** (score should be < 0.4):
- Repeated thought from a prior iteration (verbatim or near-verbatim)
- Malformed tool call JSON
- Complete topic drift ("Let me think about something else...")
- Excessive hedging ("I'm not sure but maybe I could perhaps...")
- Empty or single-word responses

**Edge cases** (score should be 0.4–0.7, scorer should not fire adaptation):
- Short but correct responses (high density, low length)
- Legitimate exploratory reasoning that looks uncertain
- Technical jargon-heavy responses with low vocabulary diversity

### Accuracy Requirement
**The scorer must achieve ≥90% correct classification on the validation set before any adaptation logic is built.** Classification is binary: composite > 0.6 = high signal, composite ≤ 0.4 = low signal. The 0.4–0.6 range is intentionally ambiguous — the scorer should not claim confidence there.

**Minimum dataset size:** ≥60 labeled examples, with ≥15 per quadrant (high-signal, low-signal, edge-case-ambiguous, edge-case-brief). Ground-truth labels are authored by the developer(s) implementing the scorer. Labeling disagreements between two reviewers use the lower (more conservative) label. The dataset is committed to `tests/signal-scorer/validation-dataset.ts` and is immutable during the Phase 2 gate check.

### False Positive Rate Requirement
**False positive rate (high-quality output scored as low-signal) must be ≤5%.** This is the failure mode that poisons the system. A false negative (low-quality output scored as high-signal) is acceptable — the agent just doesn't get a correction it could have used. A false positive fires an unnecessary adaptation that actively degrades the run.

### Test Structure
```
packages/prompt-engine/tests/
  signal-scorer/
    validation-dataset.ts     — labeled ground-truth cases
    structural-signal.test.ts — Layer 1 unit tests
    logprob-signal.test.ts    — Layer 2 unit tests (with mock logprob data)
    semantic-drift.test.ts    — Layer 3 unit tests (with mock embeddings)
    behavioral-signal.test.ts — Layer 4 unit tests
    composite-score.test.ts   — full scorer accuracy against validation dataset
    false-positive-rate.test.ts — specific false positive budget test
    baseline-calibration.test.ts — per-model baseline convergence
    context-window.test.ts    — token budget tracking
```

Each test file runs independently. The composite accuracy test is the integration gate.

---

## Observability Integration

The `MetricsCollector` auto-subscribes to `SignalScored` events (same pattern as `ToolCallCompleted`). The metrics dashboard gains a new section:

```
🎯 Prompt Signal
├─ Avg signal score:  0.82  (baseline: 0.74, +0.08 lift)
├─ Signal confidence: high  (logprobs + embeddings available)
├─ Context utilization: 43% of 32k window
├─ Low-signal iterations: 1 of 7  (iter 3, corrected)
└─ Model: cogito:14b  [calibrated, 12 runs]
```

This section is **read-only** in Phase 1 — no adaptations have fired yet. It exists to build trust in the scorer before any action is taken based on its output.

---

## Builder API (Phase 1)

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withSignalScoring({
    enabled: true,
    // No adaptation in Phase 1 — observe only
    adaptationEnabled: false,
    // Emit SignalScored events to observability
    observabilityEnabled: true,
  })
  .build();
```

The `adaptationEnabled: false` default is intentional. Phase 1 ships the scorer in observe-only mode. Developers accumulate signal data. Phase 2 introduces adaptation after the scorer is validated.

---

## What is Explicitly Deferred

The following are out of scope for this spec and will be designed separately once the scorer is validated:

- **Mid-flight prompt adaptation** — firing corrections when signal drops
- **Prompt variant A/B promotion** — signal-driven variant selection
- **Skill system** — loading, injecting, and learning from SKILL.md files
- **Cross-run learning loop** — synthesizing new skills from high-signal runs
- **`rax skills` CLI** — review/accept/reject workflow for learned skills
- **Automated prompt mutation** — DSPy-style optimizer

---

## Package Structure

```
packages/prompt-engine/
  src/
    services/
      signal-scorer.ts         — SignalScorerService implementation
      context-window.ts        — ContextWindowState scoring
      model-registry.ts        — context limits + baseline storage
    layers/
      structural-signal.ts     — Layer 1 (reuses verification heuristics)
      logprob-signal.ts        — Layer 2 (logprob parsing + normalization)
      semantic-drift.ts        — Layer 3 (cosine sim, reuses verification)
      behavioral-signal.ts     — Layer 4 (KernelState aggregation)
    types.ts                   — SignalScore, ModelSignalBaseline, ContextSection, etc.
    events.ts                  — SignalScored EventBus event type
    runtime.ts                 — Layer composition
    index.ts
  tests/
    signal-scorer/
      [test files as above]
  package.json
  tsconfig.json
```

**Dependencies:**
- `@reactive-agents/core` — EventBus, types
- `@reactive-agents/llm-provider` — LLMService.embed() for Layer 3
- `@reactive-agents/reasoning` — KernelState, KernelHooks
- `@reactive-agents/verification` — reuse semantic entropy heuristics and cosine similarity
- `bun:sqlite` — model baseline persistence
- No new external dependencies

---

## Feasibility Checkpoint

Before committing to Phase 2 (adaptation), the following must be true:

1. **Classification accuracy:** Signal scorer achieves ≥90% correct classification on the ≥60-example labeled validation dataset (binary: composite > 0.6 = high, composite ≤ 0.4 = low)
2. **Conformal coverage verified:** False positive rate ≤5% with statistical coverage guarantee from conformal calibration on held-out calibration set (not just empirical measurement — the coverage bound must hold)
3. **Model calibration converges:** `cogito:14b` and `qwen3.5:14b` conformal thresholds stabilize (change <0.02) after 10 calibration runs each
4. **Layer 2 TECP entropy validated:** Token entropy scores from Layer 2 correlate (Spearman ρ > 0.6) with final run quality (measured by `EvalService` accuracy dimension) on a 20-run Ollama test suite
5. **Context window tracking accurate:** Token budget estimates within 10% of actual token count verified against real Ollama API usage headers
6. **`SignalScored` events flow correctly** to observability dashboard across all 5 reasoning strategies
7. **No blocking latency impact:** Sync layers (1, 2, 4) add ≤2ms p99 to `onThought`. Layer 3 with embedding adds ~50ms in parallel — acceptable and documented.
8. **Centroid embedding cache correct:** Layer 3 `noveltyScore` correctly identifies known-repetitive thought sequences in the validation dataset

If any checkpoint fails, Phase 2 does not proceed. The specific failing layer is redesigned in isolation — the passing layers are not discarded.
