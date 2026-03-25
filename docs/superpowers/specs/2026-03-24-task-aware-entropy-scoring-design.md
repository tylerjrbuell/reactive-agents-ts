# Task-Aware Entropy Scoring — Design Spec

**Date:** 2026-03-24
**Status:** Draft
**Scope:** `@reactive-agents/reactive-intelligence`, `packages/benchmarks/`, `.agents/skills/calibrate-scoring`

---

## Problem

The entropy scoring system applies a universal rubric to every task type. A 3-iteration web search and a 15-iteration debugging session are graded on the same curve (mean entropy < 0.55 = B, < 0.35 = A, etc.). Two source-level bugs further inflate scores for well-behaving agents:

1. **`actionDiversity = unique_tools / iteration`** — penalizes agents that converge efficiently with few tool types. A 3-iteration task using 2 tools scores `2/3 = 0.667` diversity, contributing `(1 - 0.667) = 0.333` to behavioral entropy even when the agent completed cleanly.

2. **`formatCompliance = 0.7` for cogito-style output** — models that emit `ACTION: tool(json)` with prose before it (no explicit `Thought:` prefix) are scored as partially non-compliant even though the format is structurally valid.

These inaccuracies propagate into:
- **Bandit reward** (`1 - meanEntropy`) — teaches the wrong strategy lessons
- **Skill synthesis** (global `highEntropyThreshold`) — wrong recipes stored as "successful"
- **Calibration** — per-model thresholds drift toward inflated averages

The system cannot distinguish "the agent was confused" from "the agent converged quickly on a simple task but the formula penalizes that."

## Solution

Replace the universal rubric with **exemplar-based trajectory scoring**: compare each run's entropy trajectory against real successful completions of similar tasks, extracted from benchmark runs. The framework dog-foods itself — running its own benchmark suite to seed and perpetually refine what "ideal" looks like for each task type. Difficulty emerges organically from exemplar clusters rather than hardcoded tiers.

## Design

### 1. Source-Level Accuracy Fixes

#### 1a. Behavioral entropy — actionDiversity

**File:** `packages/reactive-intelligence/src/sensor/behavioral-entropy.ts`

Current formula: `actionDiversity = min(1, unique_tools / iteration)`

Replace with task-category-aware normalization. Each task category has an expected tool range:

| Category | Expected unique tools |
|---|---|
| `quick-lookup` | 1–2 |
| `deep-research` | 2–4 |
| `code-write` | 2–4 |
| `code-debug` | 2–5 |
| `data-analysis` | 2–4 |
| `file-operation` | 1–2 |
| `communication` | 1–2 |
| `multi-step` | 3–6 |
| `general` | 1–4 |

New formula:
```typescript
const [minExpected, maxExpected] = EXPECTED_TOOLS[taskCategory] ?? [1, 4];
const expected = Math.max(minExpected, Math.min(maxExpected, iteration));
const actionDiversity = Math.min(1, uniqueTools / expected);
```

The denominator is capped to the expected range for the task type, so quick-converging agents on simple tasks aren't penalized for "low diversity."

#### 1b. Structural entropy — formatCompliance

**File:** `packages/reactive-intelligence/src/sensor/structural-entropy.ts`

Current logic for `reactive` strategy:
```
hasThought = /thought:/i.test(thought)
hasAction = /action:/i.test(thought)
if (hasThought && (hasAction || hasFinalAnswer)) → 1.0
else if (hasThought || hasAction) → 0.7
```

Add prose-then-action detection:
```typescript
// Detect cogito-style: substantial prose followed by ACTION:
const actionIdx = thought.search(/\baction:/i);
const hasSubstantialProse = actionIdx > 40; // 40+ chars of reasoning before action
if (!hasThought && hasAction && hasSubstantialProse) formatCompliance = 0.95;
```

Models that output reasoning text followed by `ACTION:` are structurally valid — the thought content exists, it just lacks the keyword prefix.

### 2. Expanded Task Categories

**File:** `packages/reactive-intelligence/src/learning/task-classifier.ts`

Expand from 6 categories to 9, with finer-grained keyword heuristics:

| Category | Keywords | Replaces |
|---|---|---|
| `quick-lookup` | "what is", "who is", "define", "find X", single-question patterns | split from `research` |
| `deep-research` | "investigate", "compare", "report on", "analyze X and Y" | split from `research` |
| `code-write` | "implement", "write a function", "create a class", "build" | split from `code-generation` |
| `code-debug` | "fix", "bug", "error", "why is X failing", "debug" | split from `code-generation` |
| `data-analysis` | "analyze", "trend", "statistics", "dataset", "chart" | unchanged |
| `file-operation` | "read file", "write file", "save", "parse", "extract from" | new |
| `communication` | "send", "notify", "email", "message", "alert" | unchanged |
| `multi-step` | 2+ distinct verb groups detected | renamed from `multi-tool` |
| `general` | fallback | unchanged |

Priority order: `multi-step` > `communication` > `file-operation` > `code-debug` > `code-write` > `data-analysis` > `deep-research` > `quick-lookup` > `general`.

The classifier remains pure keyword heuristic — no LLM call, no Effect wrapper, sub-millisecond.

### 3. Exemplar Store

**File:** `packages/reactive-intelligence/src/calibration/exemplar-store.ts`

SQLite table storing trajectory exemplars from benchmark runs:

```sql
CREATE TABLE IF NOT EXISTS trajectory_exemplars (
  id              TEXT PRIMARY KEY,
  taskCategory    TEXT NOT NULL,
  benchmarkTaskId TEXT NOT NULL,
  benchmarkTier   INTEGER,          -- 1-5, for docs linkage only
  modelId         TEXT NOT NULL,
  strategy        TEXT NOT NULL,
  iterationCount  INTEGER NOT NULL,
  toolsUsed       TEXT NOT NULL,     -- JSON array
  outcome         TEXT NOT NULL,     -- "success" | "partial"
  selectionReason TEXT NOT NULL,     -- why this run qualified
  trajectory      TEXT NOT NULL,     -- JSON float[] (raw, variable length)
  normalizedTrajectory TEXT NOT NULL,-- JSON float[20] (time-normalized)
  meanComposite   REAL NOT NULL,
  convergenceIter INTEGER,          -- nullable
  supersededBy    TEXT,              -- nullable, points to newer exemplar ID
  runId           TEXT NOT NULL,
  createdAt       TEXT NOT NULL      -- ISO timestamp
);

CREATE INDEX idx_exemplars_category ON trajectory_exemplars(taskCategory);
CREATE INDEX idx_exemplars_model ON trajectory_exemplars(taskCategory, modelId);
```

**API:**
```typescript
interface ExemplarStore {
  insert(exemplar: ExemplarRecord): Effect<void>;
  query(taskCategory: string, opts?: { modelId?: string; limit?: number }): Effect<ExemplarRecord[]>;
  supersede(oldId: string, newId: string): Effect<void>;
  count(taskCategory: string): Effect<number>;
  exportManifest(): Effect<ExemplarManifest[]>; // for docs publication
}
```

### 4. Trajectory Normalization and Similarity Scoring

**File:** `packages/reactive-intelligence/src/calibration/trajectory-scorer.ts`

#### 4a. Normalization

Variable-length trajectories are resampled to 20 points using linear interpolation:

```typescript
function normalizeTrajectory(trajectory: readonly number[], targetLen = 20): number[] {
  if (trajectory.length === targetLen) return [...trajectory];
  const result = new Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const srcPos = (i / (targetLen - 1)) * (trajectory.length - 1);
    const lo = Math.floor(srcPos);
    const hi = Math.min(lo + 1, trajectory.length - 1);
    const frac = srcPos - lo;
    result[i] = trajectory[lo]! * (1 - frac) + trajectory[hi]! * frac;
  }
  return result;
}
```

#### 4b. Position Weights

Later positions (convergence phase) matter more than early positions (exploration). Sigmoid weighting reuses the existing `iterationWeight` concept:

```typescript
function positionWeights(len = 20): number[] {
  return Array.from({ length: len }, (_, i) =>
    1 / (1 + Math.exp(-(i - len / 2) * (4 / len)))
  );
}
```

This produces weights ~0.02 at position 0, ~0.50 at position 10, ~0.98 at position 19.

#### 4c. Composite Similarity

Three dimensions, each capturing a distinct aspect of "how ideal was this run":

```typescript
function trajectoryDistance(
  run: number[],    // normalized[20]
  exemplar: number[], // normalized[20]
  weights: number[],  // positionWeights[20]
): number {
  let sumSq = 0;
  let sumW = 0;
  for (let i = 0; i < 20; i++) {
    const diff = run[i]! - exemplar[i]!;
    sumSq += weights[i]! * diff * diff;
    sumW += weights[i]!;
  }
  return Math.sqrt(sumSq / sumW); // weighted RMS, range [0, 1]
}

function compositeScore(run: RunTrajectory, exemplar: ExemplarRecord): number {
  const weights = positionWeights();

  const trajSim = 1 - trajectoryDistance(run.normalized, exemplar.normalizedTrajectory, weights);
  const convergeSim = 1 - Math.abs(run.finalEntropy - exemplar.meanComposite);
  const efficiencySim = 1 - Math.abs(run.iterations - exemplar.iterationCount)
    / Math.max(run.iterations, exemplar.iterationCount);

  return 0.60 * trajSim
       + 0.25 * convergeSim
       + 0.15 * efficiencySim;
}
```

#### 4d. Run Scoring

```typescript
function scoreRun(
  run: RunTrajectory,
  store: ExemplarStore,
): Effect<TrajectoryScoreResult> {
  const candidates = store.query(run.taskCategory, {
    modelId: run.modelId, // soft preference — model-matched ranked higher
    limit: 20,
  });

  if (candidates.length < 3) {
    return { score: null, provisional: true, grade: fallbackGrade(run) };
  }

  const scores = candidates.map(e => compositeScore(run, e));
  const top3 = scores.sort((a, b) => b - a).slice(0, 3);
  const trajectoryScore = (top3[0] + top3[1] + top3[2]) / 3;

  return {
    score: trajectoryScore,
    provisional: false,
    grade: trajectoryScore > 0.85 ? "A"
         : trajectoryScore > 0.70 ? "B"
         : trajectoryScore > 0.50 ? "C"
         : trajectoryScore > 0.35 ? "D"
         : "F",
  };
}
```

### 5. Exemplar Extraction

**File:** `packages/reactive-intelligence/src/calibration/exemplar-extractor.ts`

Applied automatically after each benchmark task completes:

```typescript
function shouldExtractExemplar(run: CompletedRun, store: ExemplarStore): boolean {
  // Hard gates
  if (run.outcome !== "success") return false;
  if (run.entropyTrace.length < 3) return false;

  const lastShape = run.entropyTrace.at(-1)!.trajectory.shape;
  const earlyFinish = run.convergenceIter !== null
    && run.convergenceIter < run.maxIterations * 0.4;
  if (lastShape !== "converging" && !earlyFinish) return false;

  // Top quartile check
  const existingExemplars = store.query(run.taskCategory, { modelId: run.modelId });
  if (existingExemplars.length < 4) return true; // too few to rank — accept

  const existingMeans = existingExemplars.map(e => e.meanComposite);
  existingMeans.sort((a, b) => a - b);
  const p25 = existingMeans[Math.floor(existingMeans.length * 0.25)]!;
  return run.meanEntropy <= p25; // lower entropy = better = top quartile
}
```

When a run outperforms an existing exemplar for the same `taskCategory × modelId`, the old one is superseded (not deleted):
```typescript
if (newExemplar.meanComposite < worstExisting.meanComposite) {
  store.supersede(worstExisting.id, newExemplar.id);
}
```

### 6. Gap Analyzer

**File:** `packages/reactive-intelligence/src/calibration/gap-analyzer.ts`

Compares a run's trajectory against the nearest exemplar at each of 20 positions:

```typescript
type GapPoint = {
  position: number;        // 0-19 (normalized)
  actualIteration: number; // mapped back to real iteration
  deviation: number;       // abs difference from exemplar
  dominantSource: string;  // which entropy source drove the gap
  sourceValue: number;     // the source's value at that iteration
};

function analyzeGaps(run: RunTrajectory, nearestExemplar: ExemplarRecord): GapPoint[] {
  const gaps: GapPoint[] = [];
  const threshold = 0.15; // deviation > 0.15 = gap

  for (let i = 0; i < 20; i++) {
    const dev = Math.abs(run.normalized[i]! - nearestExemplar.normalizedTrajectory[i]!);
    if (dev > threshold) {
      const realIter = Math.round((i / 19) * (run.iterations - 1));
      const sources = run.entropySourcesAtIteration(realIter);
      const dominant = Object.entries(sources)
        .sort(([, a], [, b]) => b - a)[0]!;

      gaps.push({
        position: i,
        actualIteration: realIter,
        deviation: dev,
        dominantSource: dominant[0],
        sourceValue: dominant[1],
      });
    }
  }
  return gaps;
}
```

The gap report groups these by task category and surfaces:
- Which categories have sufficient exemplars vs. need seeding
- Per-run gap points with root cause attribution
- Aggregate patterns (e.g., "structural entropy consistently high for this model — format heuristic needs tuning")

### 7. Downstream Wiring

#### Bandit reward (learning-engine.ts)
```
// Before:
const reward = 1 - meanEntropy;

// After:
const scoreResult = scoreRun(runTrajectory, exemplarStore);
const reward = scoreResult.provisional ? 0.5 : scoreResult.score;
```

Provisional scores get neutral reward (0.5) — no lesson learned until exemplars exist.

#### Skill synthesis gate (skill-synthesis.ts)
```
// Before:
if (mean >= highEntropyThreshold) return false;

// After:
if (scoreResult.provisional) return false;
const topQuartile = getTopQuartileThreshold(taskCategory, exemplarStore);
if (scoreResult.score < topQuartile) return false;
```

Relative threshold, self-adjusting as exemplar quality improves.

#### Dashboard grade (console-exporter.ts)
```
// Before: fixed thresholds on meanComposite
// After: grade from trajectoryScore when available, with gap analysis section
```

#### Composite scorer (composite.ts)
Accept optional `taskCategory` parameter to adjust source weights:
- `quick-lookup` / `file-operation` / `communication`: behavioral weight ↑, structural weight ↓
- `code-write` / `code-debug`: semantic weight ↑ (reasoning on-topic matters more)
- `deep-research`: even weighting (all sources informative)
- `multi-step`: behavioral weight ↑ (tool orchestration quality is key signal)

### 8. Dog-Fooding Feedback Loop

#### Seed run
```bash
bun run bench --provider ollama --model cogito:14b --seed-exemplars
```

The `--seed-exemplars` flag triggers exemplar extraction after all benchmark tasks complete. Initial population step — covers all 9 categories across target models.

#### Refinement cycle
Every subsequent benchmark run:
1. Scores each task against existing exemplars → `trajectoryScore`
2. Qualifying runs inserted as new exemplars (bar rises over time)
3. Outperformed exemplars marked superseded
4. Updated exemplar manifest exported for docs

#### Gap analysis report
Generated after each benchmark run:
```
=== Scoring Gap Analysis ===

Category: quick-lookup (4 tasks)
  3/4 scored A or B (trajectory similarity > 0.80)
  1/4 scored D — gap at positions 12-16 (convergence phase)
    Cause: behavioral entropy spike (agent retried same query)
    Recommendation: enable loop detection early-stop

Category: code-debug (3 tasks)
  0 exemplars — all scores provisional
  Action: run seed benchmarks for code-debug category
```

#### Perpetuation
- New model → benchmark → seed exemplars → immediately calibrated
- Bug fix → re-benchmark → exemplars self-correct
- New category → first run provisional → second run real
- Framework release → benchmark → updated manifest → docs publish

### 9. Calibrate-Scoring Skill

**Location:** `.agents/skills/calibrate-scoring/`

A reusable skill directing the perpetuation workflow:

```
Skill: calibrate-scoring
Invocation: /calibrate-scoring [--provider <name>] [--model <name>]

Steps:
1. Run benchmark suite with --seed-exemplars
2. Extract exemplars from qualifying runs
3. Generate gap analysis report
4. Identify categories with < 3 exemplars (cold-start)
5. If cold-start categories found, suggest targeted benchmark tasks
6. Export exemplar manifest for docs
7. Report: exemplar counts per category, gap summary, recommendations
```

## Exemplar Trust Model

Exemplar data is verifiable through:

1. **Provenance** — every exemplar links to a specific benchmark task ID and run ID
2. **Transparency** — the exemplar manifest is published in docs alongside benchmark results
3. **Methodology** — selection criteria are deterministic and documented (this spec)
4. **Reproducibility** — benchmark tasks are public; anyone can re-run and produce their own exemplars for comparison
5. **Audit trail** — superseded exemplars are retained, showing the evolution of "ideal"

## Files Changed

### New files
- `packages/reactive-intelligence/src/calibration/exemplar-store.ts`
- `packages/reactive-intelligence/src/calibration/trajectory-scorer.ts`
- `packages/reactive-intelligence/src/calibration/exemplar-extractor.ts`
- `packages/reactive-intelligence/src/calibration/gap-analyzer.ts`
- `.agents/skills/calibrate-scoring/SKILL.md`

### Modified files
- `packages/reactive-intelligence/src/sensor/behavioral-entropy.ts` — task-category-aware actionDiversity
- `packages/reactive-intelligence/src/sensor/structural-entropy.ts` — prose-then-action formatCompliance
- `packages/reactive-intelligence/src/learning/task-classifier.ts` — 9 categories
- `packages/reactive-intelligence/src/sensor/composite.ts` — per-category source weights
- `packages/reactive-intelligence/src/learning/learning-engine.ts` — trajectoryScore bandit reward
- `packages/reactive-intelligence/src/learning/skill-synthesis.ts` — relative qualification gate
- `packages/observability/src/exporters/console-exporter.ts` — trajectoryScore grade + gap analysis
- `packages/reactive-intelligence/src/sensor/entropy-sensor-service.ts` — taskCategory passthrough
- Benchmark runner in `packages/benchmarks/` — --seed-exemplars flag, exemplar extraction, gap report

### Test files (new)
- `packages/reactive-intelligence/tests/calibration/exemplar-store.test.ts`
- `packages/reactive-intelligence/tests/calibration/trajectory-scorer.test.ts`
- `packages/reactive-intelligence/tests/calibration/exemplar-extractor.test.ts`
- `packages/reactive-intelligence/tests/calibration/gap-analyzer.test.ts`
- `packages/reactive-intelligence/tests/learning/task-classifier-expanded.test.ts`
- `packages/reactive-intelligence/tests/sensor/behavioral-entropy-category.test.ts`
- `packages/reactive-intelligence/tests/sensor/structural-entropy-prose.test.ts`

## Cold-Start Behavior

When fewer than 3 exemplars exist for a task category:
- `trajectoryScore` = `null`, `provisional` = `true`
- Bandit reward = `0.5` (neutral — no lesson learned)
- Skill synthesis skipped
- Dashboard grade displays with `(provisional)` marker
- Fallback: current shape-based scoring (with source-level bug fixes applied)

The system degrades gracefully to the improved-but-not-exemplar-based scoring, converging on full accuracy as exemplars accumulate.

## Risks

- **Cold-start period** — First benchmark seed run must cover all 9 categories. Manageable with deliberate task selection.
- **Exemplar pollution** — A bug in entropy sources during a window would taint exemplars. Supersession audit trail helps; future enhancement: time-range invalidation.
- **Cross-model noise** — Early comparisons between local and frontier models are noisy. Self-corrects as per-model libraries fill in.
- **Normalization resolution** — 20-point resampling loses detail for very long runs (30+). Adequate for current 3-15 iteration range; increase if needed.
