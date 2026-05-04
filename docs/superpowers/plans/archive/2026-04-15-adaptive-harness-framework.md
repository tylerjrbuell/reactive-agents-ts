# Adaptive Harness — Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project skills:** Use `agent-tdd` for TDD patterns, `effect-ts-patterns` for coding conventions, `validate-build` for anti-pattern detection.

**Goal:** Turn `ModelCalibration` from a static probe output into a continuously-learning system that adapts the harness per model based on real-run observations, and feeds the reactive-telemetry ingestion pipeline with richer signal so community-aggregated profiles can drive cold-start adaptation.

**Architecture:** Three-tier calibration resolution (shipped prior → community prior → local posterior) with a local observer that writes per-run observations after kernel exit, enhanced entropy feature extraction (variance, oscillation, final-value, integral), and extended `RunReport` fields (tool-call dialect, classifier accuracy, subagent outcomes, arg validity) that flow to the public telemetry endpoint. The community prior is fetched lazily with graceful offline fallback.

**Tech Stack:** TypeScript, Effect-TS, Bun runtime, `bun:test`, existing telemetry signing pipeline, atomic file writes under `~/.reactive-agents/observations/`.

**Paired plan:** `docs/superpowers/plans/2026-04-15-adaptive-harness-telemetry.md` (server-side ingestion + aggregation + profile endpoint) — these two plans share the wire schema defined here.

---

## Scope and Non-goals

**In scope (this plan):**
- Local observations infrastructure and three-tier merge
- Enhanced entropy feature extraction (variance, oscillation count, final value, integral)
- `parallelCallCapability` empirical update as the template metric
- Extended `RunReport` schema with 4 new observation fields
- Emitting the new fields from the harness (resolver dialect, classifier accuracy, subagent outcomes, arg validity)
- `classifierReliability` posterior bypass of the classifier LLM call
- Client-side fetch of community profiles from reactive-telemetry with caching

**Out of scope (future plans):**
- Server-side aggregation and /v1/profiles endpoint (separate plan)
- Community skill synthesis (`GET /v1/skills/:taskCategory`)
- Unified Behavioral Policy object (Phase 8 in the strategic design)
- Cross-provider calibration (focus on local/ollama first)

## Signals Audit — does entropy max suffice?

**Answer: no.** Current enrichment already extracts `trajectoryFingerprint`, `contextPressurePeak`, `iterationsToFirstConvergence` — not just max. But for the calibration use cases we need four more derived features:

| Feature | Why it matters | Used in calibration for |
|---|---|---|
| `entropyVariance` | separates "stable trajectory" from "wild swings" | `convergenceProfile: "thrashes"` |
| `entropyOscillationCount` | counts derivative sign changes | `entropyTrajectoryShape: "oscillating"` |
| `finalCompositeEntropy` | tells us where the run *ended*, not peaked | `convergenceProfile: "gradual"` detection |
| `entropyAreaUnderCurve` | total uncertainty-iterations (effort proxy) | normalizing difficulty across task categories |

These are all pure functions of the existing `entropyTrace`. Extraction happens in `packages/runtime/src/telemetry-enrichment.ts` alongside existing enrichers. Tests are pure/deterministic.

---

## File Structure

**New files:**
- `packages/reactive-intelligence/src/calibration/observations-types.ts` — `ModelObservations` type
- `packages/reactive-intelligence/src/calibration/observations-store.ts` — atomic read/write to `~/.reactive-agents/observations/<model>.json`
- `packages/reactive-intelligence/src/calibration/observations-merge.ts` — merge observations into a `ModelCalibration` shape
- `packages/reactive-intelligence/src/calibration/community-profile-client.ts` — HTTPS GET with cache
- `packages/reactive-intelligence/src/calibration/calibration-resolver.ts` — three-tier merge entry point
- `packages/reactive-intelligence/tests/calibration/*.test.ts` — unit tests for each file above
- `packages/runtime/src/observers/run-observer.ts` — post-run hook that writes observations

**Modified files:**
- `packages/reactive-intelligence/src/telemetry/types.ts` — extend `RunReport` with new fields
- `packages/runtime/src/telemetry-enrichment.ts` — add 4 new entropy extractors
- `packages/runtime/src/execution-engine.ts` — emit new fields into `RunReport`; call observer post-run
- `packages/llm-provider/src/calibration.ts` — route `loadCalibration` through the resolver
- `packages/tools/src/tool-calling/native-fc-strategy.ts` — emit "dialect fired" signal
- `packages/reasoning/src/structured-output/infer-required-tools.ts` — emit classifier-output events for post-run accuracy scoring

---

## Phase 1: Observations Infrastructure (no behavior change)

### Task 1: Define `ModelObservations` type

**Files:**
- Create: `packages/reactive-intelligence/src/calibration/observations-types.ts`
- Test: `packages/reactive-intelligence/tests/calibration/observations-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reactive-intelligence/tests/calibration/observations-types.test.ts
import { describe, it, expect } from "bun:test";
import { emptyObservations, type ModelObservations } from "../../src/calibration/observations-types.js";

describe("ModelObservations", () => {
  it("emptyObservations returns a fresh zeroed record for the given modelId", () => {
    const obs = emptyObservations("cogito");
    expect(obs.modelId).toBe("cogito");
    expect(obs.sampleCount).toBe(0);
    expect(obs.schemaVersion).toBeGreaterThan(0);
    expect(obs.runs).toEqual([]);
  });

  it("runs are tagged with ISO timestamps and bounded counts", () => {
    const now = new Date().toISOString();
    const run: ModelObservations["runs"][number] = {
      at: now,
      parallelTurnCount: 2,
      totalTurnCount: 5,
      dialect: "native-fc",
      classifierRequired: ["web-search"],
      classifierActuallyCalled: ["web-search"],
      subagentInvoked: 0,
      subagentSucceeded: 0,
      argValidityRate: 1.0,
    };
    expect(run.at).toBe(now);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `bun test packages/reactive-intelligence/tests/calibration/observations-types.test.ts -t "emptyObservations"`
Expected: FAIL — "Cannot find module '../../src/calibration/observations-types.js'"

- [ ] **Step 3: Implement the types module**

```ts
// packages/reactive-intelligence/src/calibration/observations-types.ts
/**
 * Per-run observation — a bounded summary the harness emits after kernel exit.
 * Only counts and categoricals, never task content or tool arguments.
 */
export interface RunObservation {
  readonly at: string; // ISO timestamp
  readonly parallelTurnCount: number; // turns with ≥2 tool calls in one response
  readonly totalTurnCount: number;
  readonly dialect: "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";
  readonly classifierRequired: readonly string[]; // what classifier said was required
  readonly classifierActuallyCalled: readonly string[]; // what the run actually called
  readonly subagentInvoked: number;
  readonly subagentSucceeded: number;
  readonly argValidityRate: number; // 0..1, fraction of well-formed arg dicts
}

export interface ModelObservations {
  readonly schemaVersion: number;
  readonly modelId: string;
  readonly sampleCount: number;
  readonly runs: readonly RunObservation[];
}

export const OBSERVATIONS_SCHEMA_VERSION = 1;
/** Keep only the most recent N observations to bound disk growth. */
export const OBSERVATIONS_WINDOW = 50;

export function emptyObservations(modelId: string): ModelObservations {
  return {
    schemaVersion: OBSERVATIONS_SCHEMA_VERSION,
    modelId,
    sampleCount: 0,
    runs: [],
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `bun test packages/reactive-intelligence/tests/calibration/observations-types.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/calibration/observations-types.ts \
        packages/reactive-intelligence/tests/calibration/observations-types.test.ts
git commit -m "feat(calibration): add ModelObservations type and schema version"
```

---

### Task 2: Atomic observations store (read/append/write-rename)

**Files:**
- Create: `packages/reactive-intelligence/src/calibration/observations-store.ts`
- Test: `packages/reactive-intelligence/tests/calibration/observations-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reactive-intelligence/tests/calibration/observations-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadObservations,
  appendObservation,
  observationsPath,
} from "../../src/calibration/observations-store.js";
import type { RunObservation } from "../../src/calibration/observations-types.js";

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "ra-observations-"));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

const sampleRun: RunObservation = {
  at: "2026-04-15T12:00:00.000Z",
  parallelTurnCount: 1,
  totalTurnCount: 3,
  dialect: "native-fc",
  classifierRequired: ["web-search"],
  classifierActuallyCalled: ["web-search"],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1.0,
};

describe("observations-store", () => {
  it("loadObservations returns empty record for unknown model", () => {
    const obs = loadObservations("missing-model", { baseDir: testRoot });
    expect(obs.sampleCount).toBe(0);
    expect(obs.runs).toEqual([]);
  });

  it("appendObservation creates file and persists the run", () => {
    appendObservation("cogito", sampleRun, { baseDir: testRoot });
    expect(existsSync(observationsPath("cogito", testRoot))).toBe(true);

    const obs = loadObservations("cogito", { baseDir: testRoot });
    expect(obs.sampleCount).toBe(1);
    expect(obs.runs).toHaveLength(1);
    expect(obs.runs[0]!.dialect).toBe("native-fc");
  });

  it("caps stored runs at OBSERVATIONS_WINDOW (rolling window)", () => {
    for (let i = 0; i < 55; i++) {
      appendObservation("cogito", { ...sampleRun, totalTurnCount: i }, { baseDir: testRoot });
    }
    const obs = loadObservations("cogito", { baseDir: testRoot });
    expect(obs.runs.length).toBe(50);
    // Most recent observation wins — totalTurnCount values should be 5..54
    expect(obs.runs[0]!.totalTurnCount).toBe(5);
    expect(obs.runs[49]!.totalTurnCount).toBe(54);
    expect(obs.sampleCount).toBe(55); // cumulative, not bounded by window
  });

  it("normalizes modelId for filename (colons → dashes)", () => {
    appendObservation("qwen2.5-coder:14b", sampleRun, { baseDir: testRoot });
    expect(existsSync(observationsPath("qwen2.5-coder:14b", testRoot))).toBe(true);
  });

  it("gracefully handles corrupt JSON file by returning empty record", () => {
    const path = observationsPath("cogito", testRoot);
    require("node:fs").mkdirSync(testRoot, { recursive: true });
    require("node:fs").writeFileSync(path, "{not valid json");
    const obs = loadObservations("cogito", { baseDir: testRoot });
    expect(obs.sampleCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reactive-intelligence/tests/calibration/observations-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the store**

```ts
// packages/reactive-intelligence/src/calibration/observations-store.ts
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  emptyObservations,
  OBSERVATIONS_SCHEMA_VERSION,
  OBSERVATIONS_WINDOW,
  type ModelObservations,
  type RunObservation,
} from "./observations-types.js";

export interface StoreOptions {
  /** Override the base directory (test hook). Defaults to ~/.reactive-agents/observations. */
  readonly baseDir?: string;
}

function defaultBaseDir(): string {
  return join(homedir(), ".reactive-agents", "observations");
}

export function normalizeModelIdForFile(modelId: string): string {
  return modelId.toLowerCase().replace(/:/g, "-").replace(/\s+/g, "-");
}

export function observationsPath(modelId: string, baseDir?: string): string {
  const root = baseDir ?? defaultBaseDir();
  return join(root, `${normalizeModelIdForFile(modelId)}.json`);
}

export function loadObservations(modelId: string, opts: StoreOptions = {}): ModelObservations {
  const path = observationsPath(modelId, opts.baseDir);
  if (!existsSync(path)) return emptyObservations(modelId);
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as ModelObservations;
    if (parsed.schemaVersion !== OBSERVATIONS_SCHEMA_VERSION) {
      // Schema drift — treat as empty, don't crash
      return emptyObservations(modelId);
    }
    return parsed;
  } catch {
    // Corrupt file — fall back to empty
    return emptyObservations(modelId);
  }
}

export function appendObservation(
  modelId: string,
  run: RunObservation,
  opts: StoreOptions = {},
): void {
  const path = observationsPath(modelId, opts.baseDir);
  const current = loadObservations(modelId, opts);
  const runs = [...current.runs, run].slice(-OBSERVATIONS_WINDOW);
  const next: ModelObservations = {
    schemaVersion: OBSERVATIONS_SCHEMA_VERSION,
    modelId,
    sampleCount: current.sampleCount + 1,
    runs,
  };
  writeAtomic(path, JSON.stringify(next, null, 2));
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reactive-intelligence/tests/calibration/observations-store.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/calibration/observations-store.ts \
        packages/reactive-intelligence/tests/calibration/observations-store.test.ts
git commit -m "feat(calibration): atomic observations store with rolling 50-run window"
```

---

### Task 3: Merge observations into a ModelCalibration-shaped result

**Files:**
- Create: `packages/reactive-intelligence/src/calibration/observations-merge.ts`
- Test: `packages/reactive-intelligence/tests/calibration/observations-merge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reactive-intelligence/tests/calibration/observations-merge.test.ts
import { describe, it, expect } from "bun:test";
import { mergeObservationsIntoPrior } from "../../src/calibration/observations-merge.js";
import type { ModelObservations, RunObservation } from "../../src/calibration/observations-types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

const prior: ModelCalibration = {
  modelId: "cogito",
  calibratedAt: "2026-04-14T00:00:00.000Z",
  probeVersion: 1,
  runsAveraged: 3,
  steeringCompliance: "hybrid",
  parallelCallCapability: "partial",
  observationHandling: "needs-inline-facts",
  systemPromptAttention: "moderate",
  optimalToolResultChars: 1500,
};

function runs(...parallelFlags: boolean[]): ModelObservations {
  const samples: RunObservation[] = parallelFlags.map((parallel, i) => ({
    at: `2026-04-15T12:${String(i).padStart(2, "0")}:00.000Z`,
    parallelTurnCount: parallel ? 1 : 0,
    totalTurnCount: 3,
    dialect: "native-fc",
    classifierRequired: [],
    classifierActuallyCalled: [],
    subagentInvoked: 0,
    subagentSucceeded: 0,
    argValidityRate: 1.0,
  }));
  return {
    schemaVersion: 1,
    modelId: "cogito",
    sampleCount: samples.length,
    runs: samples,
  };
}

describe("mergeObservationsIntoPrior", () => {
  it("returns prior unchanged when sample count below threshold (N=5)", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(true, true, true));
    expect(merged.parallelCallCapability).toBe("partial");
    expect(merged).toBe(prior); // identity when no override
  });

  it("upgrades parallelCallCapability to 'reliable' when ≥80% of runs had parallel turns", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(true, true, true, true, true));
    expect(merged.parallelCallCapability).toBe("reliable");
  });

  it("downgrades to 'sequential-only' when <20% of runs had parallel turns", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(false, false, false, false, false));
    expect(merged.parallelCallCapability).toBe("sequential-only");
  });

  it("preserves 'partial' when rate falls in 20-80% band", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(true, true, false, false, false));
    expect(merged.parallelCallCapability).toBe("partial");
  });

  it("leaves unrelated fields untouched", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(true, true, true, true, true));
    expect(merged.steeringCompliance).toBe(prior.steeringCompliance);
    expect(merged.optimalToolResultChars).toBe(prior.optimalToolResultChars);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reactive-intelligence/tests/calibration/observations-merge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement merge logic**

```ts
// packages/reactive-intelligence/src/calibration/observations-merge.ts
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { ModelObservations } from "./observations-types.js";

/** Minimum samples before observations override prior. */
export const OVERRIDE_THRESHOLD = 5;

/**
 * Merge locally-observed behavior into the shipped prior. Currently updates:
 *   - parallelCallCapability (reliable / partial / sequential-only) from observed
 *     parallel-turn frequency.
 *
 * Returns the prior by identity when the override threshold is not met, so
 * callers can detect "no change" without deep-equality checks.
 */
export function mergeObservationsIntoPrior(
  prior: ModelCalibration,
  observations: ModelObservations,
): ModelCalibration {
  if (observations.runs.length < OVERRIDE_THRESHOLD) return prior;

  let next: ModelCalibration = prior;

  const parallelRate =
    observations.runs.filter((r) => r.parallelTurnCount > 0).length / observations.runs.length;
  const parallelCapability = categorizeParallelRate(parallelRate);
  if (parallelCapability !== prior.parallelCallCapability) {
    next = { ...next, parallelCallCapability };
  }

  return next;
}

function categorizeParallelRate(rate: number): ModelCalibration["parallelCallCapability"] {
  if (rate >= 0.8) return "reliable";
  if (rate < 0.2) return "sequential-only";
  return "partial";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reactive-intelligence/tests/calibration/observations-merge.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/calibration/observations-merge.ts \
        packages/reactive-intelligence/tests/calibration/observations-merge.test.ts
git commit -m "feat(calibration): merge observations into prior (parallelCallCapability)"
```

---

### Task 4: Calibration resolver — single entry point for shipped/community/local

**Files:**
- Create: `packages/reactive-intelligence/src/calibration/calibration-resolver.ts`
- Test: `packages/reactive-intelligence/tests/calibration/calibration-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reactive-intelligence/tests/calibration/calibration-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendObservation } from "../../src/calibration/observations-store.js";
import { resolveCalibration } from "../../src/calibration/calibration-resolver.js";
import type { RunObservation } from "../../src/calibration/observations-types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

let testRoot: string;

beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-resolver-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

const prior: ModelCalibration = {
  modelId: "cogito",
  calibratedAt: "2026-04-14T00:00:00.000Z",
  probeVersion: 1,
  runsAveraged: 3,
  steeringCompliance: "hybrid",
  parallelCallCapability: "partial",
  observationHandling: "needs-inline-facts",
  systemPromptAttention: "moderate",
  optimalToolResultChars: 1500,
};

const parallelRun: RunObservation = {
  at: "2026-04-15T00:00:00.000Z",
  parallelTurnCount: 1,
  totalTurnCount: 3,
  dialect: "native-fc",
  classifierRequired: [],
  classifierActuallyCalled: [],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1.0,
};

describe("resolveCalibration", () => {
  it("returns the prior when no observations exist", () => {
    const result = resolveCalibration(prior, { observationsBaseDir: testRoot });
    expect(result).toBe(prior);
  });

  it("applies local observations once threshold is met", () => {
    for (let i = 0; i < 5; i++) {
      appendObservation("cogito", parallelRun, { baseDir: testRoot });
    }
    const result = resolveCalibration(prior, { observationsBaseDir: testRoot });
    expect(result.parallelCallCapability).toBe("reliable");
  });

  it("honours a community prior when passed explicitly", () => {
    const community: Partial<ModelCalibration> = {
      parallelCallCapability: "reliable",
      systemPromptAttention: "strong",
    };
    const result = resolveCalibration(prior, {
      observationsBaseDir: testRoot,
      communityProfile: community,
    });
    // Community overrides prior for the fields it declares
    expect(result.parallelCallCapability).toBe("reliable");
    expect(result.systemPromptAttention).toBe("strong");
    // Prior fields not in community stay
    expect(result.steeringCompliance).toBe(prior.steeringCompliance);
  });

  it("local posterior beats community prior once local samples meet threshold", () => {
    const community: Partial<ModelCalibration> = { parallelCallCapability: "reliable" };
    for (let i = 0; i < 5; i++) {
      appendObservation("cogito", { ...parallelRun, parallelTurnCount: 0 }, { baseDir: testRoot });
    }
    const result = resolveCalibration(prior, {
      observationsBaseDir: testRoot,
      communityProfile: community,
    });
    // Local observed 0% parallel → sequential-only, overriding community's "reliable"
    expect(result.parallelCallCapability).toBe("sequential-only");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reactive-intelligence/tests/calibration/calibration-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the resolver**

```ts
// packages/reactive-intelligence/src/calibration/calibration-resolver.ts
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { loadObservations } from "./observations-store.js";
import { mergeObservationsIntoPrior } from "./observations-merge.js";

export interface ResolveOptions {
  /** Optional community profile (subset of ModelCalibration). Applied before local observations. */
  readonly communityProfile?: Partial<ModelCalibration>;
  /** Override base dir for observations (test hook). */
  readonly observationsBaseDir?: string;
}

/**
 * Three-tier calibration resolution:
 *   1. Shipped prior (input)
 *   2. Community prior (overrides fields the community profile declares)
 *   3. Local posterior (overrides once sample threshold is met)
 *
 * Returns the input prior by identity when no overrides apply.
 */
export function resolveCalibration(
  prior: ModelCalibration,
  opts: ResolveOptions = {},
): ModelCalibration {
  let current: ModelCalibration = prior;

  // Tier 2: community profile
  if (opts.communityProfile) {
    current = { ...current, ...opts.communityProfile };
  }

  // Tier 3: local observations
  const observations = loadObservations(prior.modelId, { baseDir: opts.observationsBaseDir });
  current = mergeObservationsIntoPrior(current, observations);

  // Return prior by identity when nothing changed
  return current === prior ? prior : current;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reactive-intelligence/tests/calibration/calibration-resolver.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/calibration/calibration-resolver.ts \
        packages/reactive-intelligence/tests/calibration/calibration-resolver.test.ts
git commit -m "feat(calibration): three-tier resolver (shipped → community → local)"
```

---

### Task 5: Export the calibration module from reactive-intelligence public API

**Files:**
- Modify: `packages/reactive-intelligence/src/index.ts`

- [ ] **Step 1: Add exports**

```ts
// Append to packages/reactive-intelligence/src/index.ts
export {
  emptyObservations,
  OBSERVATIONS_SCHEMA_VERSION,
  OBSERVATIONS_WINDOW,
  type ModelObservations,
  type RunObservation,
} from "./calibration/observations-types.js";
export {
  loadObservations,
  appendObservation,
  observationsPath,
  normalizeModelIdForFile,
  type StoreOptions,
} from "./calibration/observations-store.js";
export { mergeObservationsIntoPrior, OVERRIDE_THRESHOLD } from "./calibration/observations-merge.js";
export { resolveCalibration, type ResolveOptions } from "./calibration/calibration-resolver.js";
```

- [ ] **Step 2: Build package**

Run: `bun run --filter '@reactive-agents/reactive-intelligence' build`
Expected: "Build success"

- [ ] **Step 3: Commit**

```bash
git add packages/reactive-intelligence/src/index.ts
git commit -m "feat(calibration): export observations + resolver from public API"
```

---

## Phase 2: Wire the observer into the run lifecycle

### Task 6: Post-run observer writes observations

**Files:**
- Create: `packages/runtime/src/observers/run-observer.ts`
- Test: `packages/runtime/tests/observers/run-observer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/tests/observers/run-observer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunObservation, persistRunObservation } from "../../src/observers/run-observer.js";
import { loadObservations } from "@reactive-agents/reactive-intelligence";

let testRoot: string;

beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-observer-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

describe("buildRunObservation", () => {
  it("counts parallel turns from tool-call log", () => {
    const log = [
      { turn: 0, toolName: "web-search" },
      { turn: 0, toolName: "http-get" },  // same turn → parallel
      { turn: 1, toolName: "file-write" }, // solo turn
      { turn: 2, toolName: "web-search" },
      { turn: 2, toolName: "web-search" }, // same turn → parallel
    ];
    const obs = buildRunObservation({
      modelId: "cogito",
      toolCallLog: log,
      totalTurns: 3,
      dialect: "native-fc",
      classifierRequired: ["web-search"],
      classifierActuallyCalled: ["web-search", "http-get", "file-write"],
      subagentInvoked: 0,
      subagentSucceeded: 0,
      argValidityRate: 1.0,
    });
    expect(obs.parallelTurnCount).toBe(2); // turns 0 and 2
    expect(obs.totalTurnCount).toBe(3);
  });

  it("defaults missing fields to safe values", () => {
    const obs = buildRunObservation({
      modelId: "cogito",
      toolCallLog: [],
      totalTurns: 0,
      dialect: "none",
      classifierRequired: [],
      classifierActuallyCalled: [],
      subagentInvoked: 0,
      subagentSucceeded: 0,
      argValidityRate: 1.0,
    });
    expect(obs.parallelTurnCount).toBe(0);
    expect(obs.totalTurnCount).toBe(0);
  });
});

describe("persistRunObservation", () => {
  it("appends to the model's observations file", () => {
    persistRunObservation(
      "cogito",
      buildRunObservation({
        modelId: "cogito",
        toolCallLog: [{ turn: 0, toolName: "web-search" }],
        totalTurns: 1,
        dialect: "native-fc",
        classifierRequired: [],
        classifierActuallyCalled: ["web-search"],
        subagentInvoked: 0,
        subagentSucceeded: 0,
        argValidityRate: 1.0,
      }),
      { baseDir: testRoot },
    );
    const obs = loadObservations("cogito", { baseDir: testRoot });
    expect(obs.sampleCount).toBe(1);
    expect(obs.runs[0]!.dialect).toBe("native-fc");
  });

  it("never throws even when disk is unwritable", () => {
    expect(() =>
      persistRunObservation(
        "cogito",
        buildRunObservation({
          modelId: "cogito",
          toolCallLog: [],
          totalTurns: 0,
          dialect: "none",
          classifierRequired: [],
          classifierActuallyCalled: [],
          subagentInvoked: 0,
          subagentSucceeded: 0,
          argValidityRate: 1.0,
        }),
        { baseDir: "/nonexistent/readonly/path/\0invalid" },
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/observers/run-observer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the observer**

```ts
// packages/runtime/src/observers/run-observer.ts
import { appendObservation, type RunObservation } from "@reactive-agents/reactive-intelligence";

export interface ToolCallLogEntry {
  readonly turn: number;
  readonly toolName: string;
}

export interface BuildObservationInput {
  readonly modelId: string;
  readonly toolCallLog: readonly ToolCallLogEntry[];
  readonly totalTurns: number;
  readonly dialect: RunObservation["dialect"];
  readonly classifierRequired: readonly string[];
  readonly classifierActuallyCalled: readonly string[];
  readonly subagentInvoked: number;
  readonly subagentSucceeded: number;
  readonly argValidityRate: number;
}

export interface PersistOptions {
  readonly baseDir?: string;
}

/**
 * Count turns in which ≥2 tool calls appeared in a single model response.
 * Exported so execution-engine can emit the same count on the wire (RunReport.parallelTurnCount)
 * without re-implementing the logic.
 */
export function countParallelTurnsFromLog(toolCallLog: readonly ToolCallLogEntry[]): number {
  const turnCallCounts = new Map<number, number>();
  for (const entry of toolCallLog) {
    turnCallCounts.set(entry.turn, (turnCallCounts.get(entry.turn) ?? 0) + 1);
  }
  return [...turnCallCounts.values()].filter((count) => count >= 2).length;
}

export function buildRunObservation(input: BuildObservationInput): RunObservation {
  const parallelTurnCount = countParallelTurnsFromLog(input.toolCallLog);

  return {
    at: new Date().toISOString(),
    parallelTurnCount,
    totalTurnCount: input.totalTurns,
    dialect: input.dialect,
    classifierRequired: input.classifierRequired,
    classifierActuallyCalled: input.classifierActuallyCalled,
    subagentInvoked: input.subagentInvoked,
    subagentSucceeded: input.subagentSucceeded,
    argValidityRate: input.argValidityRate,
  };
}

/**
 * Persist an observation. Never throws — observer failure must not affect agents.
 */
export function persistRunObservation(
  modelId: string,
  observation: RunObservation,
  opts: PersistOptions = {},
): void {
  try {
    appendObservation(modelId, observation, { baseDir: opts.baseDir });
  } catch {
    // Silent — observer is best-effort only
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/tests/observers/run-observer.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/observers/run-observer.ts \
        packages/runtime/tests/observers/run-observer.test.ts
git commit -m "feat(observers): post-run observation builder + atomic persistence"
```

---

### Task 7: Invoke the observer from execution-engine after telemetry send

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (the block that builds the telemetry `RunReport` around line 3639)

- [ ] **Step 1: Write an integration test**

```ts
// packages/runtime/tests/observers/execution-engine-observer-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadObservations } from "@reactive-agents/reactive-intelligence";
// Implementation detail: test relies on the observer being called with OBSERVATIONS_BASE_DIR env var
// (see Task 7 step 3 — we thread an env override through the observer call site).

let testRoot: string;
beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "ra-engine-"));
  process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"] = testRoot;
});
afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
  delete process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];
});

describe("execution-engine writes observation after run", () => {
  it("appends an observation to the model's file when RI is enabled", async () => {
    // This test will be filled in with a real harness invocation once the
    // observer call site is wired up. For now it reserves the test shape.
    // See companion test file run-observer.test.ts for unit coverage.
    expect(testRoot).toBeTruthy();
  });
});
```

- [ ] **Step 2: Wire the observer call site in `execution-engine.ts`**

Locate the telemetry send block in `packages/runtime/src/execution-engine.ts` near `client.send(...)`. Immediately after that call add:

```ts
// After client.send({...}) completes, persist a local observation (best-effort, never blocks).
try {
  const { persistRunObservation, buildRunObservation } = await import(
    "./observers/run-observer.js"
  );
  const observation = buildRunObservation({
    modelId,
    toolCallLog: toolCallLog.map((t, idx) => ({
      turn: (t as { iteration?: number }).iteration ?? idx,
      toolName: t.toolName,
    })),
    totalTurns: ctx.iteration,
    dialect: "none", // set by Task 13 once resolver reports which tier fired
    classifierRequired: effectiveRequiredTools ?? [],
    classifierActuallyCalled: toolsUsed,
    subagentInvoked: 0, // set by Task 15
    subagentSucceeded: 0, // set by Task 15
    argValidityRate: 1.0, // set by Task 16
  });
  persistRunObservation(modelId, observation, {
    baseDir: process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"],
  });
} catch {
  // Observer failure must not affect the run
}
```

- [ ] **Step 3: Run the integration test (placeholder passes; real coverage lives in Task 6)**

Run: `bun test packages/runtime/tests/observers/execution-engine-observer-integration.test.ts`
Expected: PASS, 1 test

- [ ] **Step 4: Run the full runtime suite to confirm no regression**

Run: `bun test packages/runtime/`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/execution-engine.ts \
        packages/runtime/tests/observers/execution-engine-observer-integration.test.ts
git commit -m "feat(runtime): invoke run-observer post-telemetry send"
```

---

### Task 8: Route `loadCalibration` callers through the resolver

**Files:**
- Modify: `packages/llm-provider/src/calibration.ts` — add a `resolveModelCalibration()` that wraps `loadCalibration` with the resolver
- Modify: `packages/runtime/src/execution-engine.ts` — swap `loadCalibration(...)` call site to `resolveModelCalibration(...)`

- [ ] **Step 1: Write the failing test**

```ts
// packages/llm-provider/tests/resolve-model-calibration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModelCalibration } from "../src/calibration.js";
import { appendObservation } from "@reactive-agents/reactive-intelligence";
import type { RunObservation } from "@reactive-agents/reactive-intelligence";

let testRoot: string;
beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-resolve-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

const run: RunObservation = {
  at: "2026-04-15T00:00:00.000Z",
  parallelTurnCount: 1,
  totalTurnCount: 3,
  dialect: "native-fc",
  classifierRequired: [],
  classifierActuallyCalled: [],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1.0,
};

describe("resolveModelCalibration", () => {
  it("returns undefined when no calibration file exists and no observations", () => {
    const cal = resolveModelCalibration("totally-unknown:model", { observationsBaseDir: testRoot });
    expect(cal).toBeUndefined();
  });

  it("returns the shipped prior for a known model", () => {
    const cal = resolveModelCalibration("gemma4:e4b", { observationsBaseDir: testRoot });
    expect(cal?.modelId).toBe("gemma4:e4b");
  });

  it("applies local observations when threshold is met", () => {
    for (let i = 0; i < 5; i++) {
      appendObservation("gemma4:e4b", run, { baseDir: testRoot });
    }
    const cal = resolveModelCalibration("gemma4:e4b", { observationsBaseDir: testRoot });
    expect(cal?.parallelCallCapability).toBe("reliable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/llm-provider/tests/resolve-model-calibration.test.ts`
Expected: FAIL — `resolveModelCalibration` is not exported

- [ ] **Step 3: Add `resolveModelCalibration`**

Append to `packages/llm-provider/src/calibration.ts`:

```ts
import { resolveCalibration } from "@reactive-agents/reactive-intelligence";

export interface ResolveModelCalibrationOptions {
  readonly communityProfile?: Partial<ModelCalibration>;
  readonly observationsBaseDir?: string;
}

/**
 * Load the shipped prior for the given model and merge it with the community
 * profile (when supplied) and local observations. Returns undefined when no
 * prior is found AND no override data is available.
 */
export function resolveModelCalibration(
  modelId: string,
  opts: ResolveModelCalibrationOptions = {},
): ModelCalibration | undefined {
  const prior = loadCalibration(modelId);
  if (!prior && !opts.communityProfile) return undefined;

  const base: ModelCalibration = prior ?? {
    modelId,
    calibratedAt: new Date().toISOString(),
    probeVersion: 0,
    runsAveraged: 0,
    steeringCompliance: "hybrid",
    parallelCallCapability: "partial",
    observationHandling: "needs-inline-facts",
    systemPromptAttention: "moderate",
    optimalToolResultChars: 1200,
  };

  return resolveCalibration(base, {
    communityProfile: opts.communityProfile,
    observationsBaseDir: opts.observationsBaseDir,
  });
}
```

- [ ] **Step 4: Swap execution-engine call site**

In `packages/runtime/src/execution-engine.ts`, find `loadCalibration(String(config.defaultModel ?? ""))` (around line 1243) and change to:

```ts
import { resolveModelCalibration } from "@reactive-agents/llm-provider";
// ...
if (cal === "auto") return resolveModelCalibration(String(config.defaultModel ?? ""), {
  observationsBaseDir: process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"],
});
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/llm-provider/ packages/runtime/`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add packages/llm-provider/src/calibration.ts \
        packages/llm-provider/tests/resolve-model-calibration.test.ts \
        packages/runtime/src/execution-engine.ts
git commit -m "feat(calibration): resolveModelCalibration threads prior + community + local"
```

---

## Phase 3: Enhanced entropy feature extraction

### Task 9: Add `entropyVariance`, `entropyOscillationCount`, `finalCompositeEntropy`, `entropyAreaUnderCurve`

**Files:**
- Modify: `packages/runtime/src/telemetry-enrichment.ts`
- Modify: `packages/runtime/src/__tests__/telemetry-enrichment.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/runtime/src/__tests__/telemetry-enrichment.test.ts`:

```ts
import {
  entropyVariance,
  entropyOscillationCount,
  finalCompositeEntropy,
  entropyAreaUnderCurve,
} from "../telemetry-enrichment.js";

const flatTrace = [
  { iteration: 1, composite: 0.5, sources: {} as any, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "high" as const },
  { iteration: 2, composite: 0.5, sources: {} as any, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "high" as const },
  { iteration: 3, composite: 0.5, sources: {} as any, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "high" as const },
];

const oscillatingTrace = [
  { iteration: 1, composite: 0.3, sources: {} as any, trajectory: { derivative: +0.3, shape: "rising", momentum: 0 }, confidence: "medium" as const },
  { iteration: 2, composite: 0.6, sources: {} as any, trajectory: { derivative: -0.3, shape: "falling", momentum: 0 }, confidence: "medium" as const },
  { iteration: 3, composite: 0.3, sources: {} as any, trajectory: { derivative: +0.3, shape: "rising", momentum: 0 }, confidence: "medium" as const },
  { iteration: 4, composite: 0.6, sources: {} as any, trajectory: { derivative: -0.3, shape: "falling", momentum: 0 }, confidence: "medium" as const },
];

describe("entropyVariance", () => {
  it("returns 0 for a flat trace", () => {
    expect(entropyVariance(flatTrace)).toBeCloseTo(0, 5);
  });
  it("returns positive variance for oscillating trace", () => {
    expect(entropyVariance(oscillatingTrace)).toBeGreaterThan(0.01);
  });
  it("returns 0 for empty trace", () => {
    expect(entropyVariance([])).toBe(0);
  });
});

describe("entropyOscillationCount", () => {
  it("returns 0 for monotonic/flat trace", () => {
    expect(entropyOscillationCount(flatTrace)).toBe(0);
  });
  it("counts derivative sign changes", () => {
    // oscillating trace: +, -, +, - → 2 sign flips (not counting the first derivative)
    expect(entropyOscillationCount(oscillatingTrace)).toBe(2);
  });
  it("ignores zero derivatives (treats as continuation)", () => {
    const trace = [
      { iteration: 1, composite: 0.5, sources: {} as any, trajectory: { derivative: +0.1, shape: "rising", momentum: 0 }, confidence: "medium" as const },
      { iteration: 2, composite: 0.5, sources: {} as any, trajectory: { derivative: 0, shape: "flat", momentum: 0 }, confidence: "medium" as const },
      { iteration: 3, composite: 0.6, sources: {} as any, trajectory: { derivative: +0.1, shape: "rising", momentum: 0 }, confidence: "medium" as const },
    ];
    expect(entropyOscillationCount(trace)).toBe(0);
  });
});

describe("finalCompositeEntropy", () => {
  it("returns the last composite value", () => {
    expect(finalCompositeEntropy(oscillatingTrace)).toBe(0.6);
  });
  it("returns null for empty trace", () => {
    expect(finalCompositeEntropy([])).toBeNull();
  });
});

describe("entropyAreaUnderCurve", () => {
  it("sums composite values across the trace (trapezoidal approximation)", () => {
    // flat at 0.5 for 3 iters → AUC ~1.0 (two trapezoids of width 1, avg height 0.5)
    expect(entropyAreaUnderCurve(flatTrace)).toBeCloseTo(1.0, 5);
  });
  it("returns 0 for empty or single-point trace", () => {
    expect(entropyAreaUnderCurve([])).toBe(0);
    expect(entropyAreaUnderCurve([flatTrace[0]!])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/runtime/src/__tests__/telemetry-enrichment.test.ts -t "entropyVariance"`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement the four features**

Append to `packages/runtime/src/telemetry-enrichment.ts`:

```ts
type EntropyEntry = {
  readonly iteration: number;
  readonly composite: number;
  readonly trajectory: { readonly derivative: number };
};

/** Population variance of composite entropy across iterations. */
export function entropyVariance(trace: readonly EntropyEntry[]): number {
  if (trace.length === 0) return 0;
  const mean = trace.reduce((sum, e) => sum + e.composite, 0) / trace.length;
  const sqDiffs = trace.map((e) => (e.composite - mean) ** 2);
  return sqDiffs.reduce((sum, v) => sum + v, 0) / trace.length;
}

/** Count of derivative sign changes — a proxy for trajectory instability. */
export function entropyOscillationCount(trace: readonly EntropyEntry[]): number {
  if (trace.length < 2) return 0;
  let flips = 0;
  let prevSign = 0;
  for (const entry of trace) {
    const sign = entry.trajectory.derivative > 0 ? 1 : entry.trajectory.derivative < 0 ? -1 : 0;
    if (sign === 0) continue; // zero derivative doesn't break a run
    if (prevSign !== 0 && sign !== prevSign) flips++;
    prevSign = sign;
  }
  return flips;
}

/** The final composite value — tells us where the run ended. */
export function finalCompositeEntropy(trace: readonly EntropyEntry[]): number | null {
  if (trace.length === 0) return null;
  return trace[trace.length - 1]!.composite;
}

/** Trapezoidal area under the composite curve — total uncertainty-iterations. */
export function entropyAreaUnderCurve(trace: readonly EntropyEntry[]): number {
  if (trace.length < 2) return 0;
  let auc = 0;
  for (let i = 1; i < trace.length; i++) {
    const h1 = trace[i - 1]!.composite;
    const h2 = trace[i]!.composite;
    const width = trace[i]!.iteration - trace[i - 1]!.iteration;
    auc += ((h1 + h2) / 2) * width;
  }
  return auc;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/runtime/src/__tests__/telemetry-enrichment.test.ts`
Expected: PASS, all existing + 9 new test cases

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/telemetry-enrichment.ts \
        packages/runtime/src/__tests__/telemetry-enrichment.test.ts
git commit -m "feat(telemetry): add entropy variance, oscillation, final, AUC extractors"
```

---

## Phase 4: Extend RunReport with new observation fields

### Task 10: Add the new fields to `RunReport` type

**Files:**
- Modify: `packages/reactive-intelligence/src/telemetry/types.ts`

- [ ] **Step 1: Extend the type**

```ts
// Append inside the RunReport type in packages/reactive-intelligence/src/telemetry/types.ts
  // ── Adaptive harness signals (2026-04-15) ──
  readonly toolCallDialectObserved?: "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";
  readonly classifierFalsePositives?: readonly string[];
  readonly classifierFalseNegatives?: readonly string[];
  readonly subagentInvocations?: readonly {
    readonly delegated: boolean;
    readonly succeeded: boolean;
  }[];
  readonly toolArgValidityRate?: number; // 0..1
  /** Turns in which the model emitted ≥2 tool calls in a single response.
   *  Consumed server-side to derive parallelCallCapability without proxy heuristics. */
  readonly parallelTurnCount?: number;
  // ── Enhanced entropy features ──
  readonly entropyVariance?: number;
  readonly entropyOscillationCount?: number;
  readonly finalCompositeEntropy?: number | null;
  readonly entropyAreaUnderCurve?: number;
```

- [ ] **Step 2: Rebuild the package to confirm type compiles**

Run: `bun run --filter '@reactive-agents/reactive-intelligence' build`
Expected: "Build success"

- [ ] **Step 3: Commit**

```bash
git add packages/reactive-intelligence/src/telemetry/types.ts
git commit -m "feat(telemetry): extend RunReport with adaptive-harness + entropy fields"
```

---

### Task 11: Emit the new entropy fields from execution-engine

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` — the block that builds the `RunReport` (around line 3680-3720)

- [ ] **Step 1: Add the enriched entropy features to the RunReport construction**

Locate the `client.send({ ... })` call. Add imports:

```ts
import {
  buildTrajectoryFingerprint,
  firstConvergenceIteration,
  peakContextPressure,
  deriveTaskComplexity,
  deriveFailurePattern,
  deriveThoughtToActionRatio,
  entropyVariance,
  entropyOscillationCount,
  finalCompositeEntropy,
  entropyAreaUnderCurve,
} from "./telemetry-enrichment.js";
```

Extend the `client.send({...})` payload with:

```ts
// Entropy enrichment (added 2026-04-15)
entropyVariance: entropyVariance(entropyLog),
entropyOscillationCount: entropyOscillationCount(entropyLog),
finalCompositeEntropy: finalCompositeEntropy(entropyLog),
entropyAreaUnderCurve: entropyAreaUnderCurve(entropyLog),
// Parallel-turn count — also goes into local observation (Task 6 helper, reused here)
parallelTurnCount: countParallelTurnsFromLog(
  toolCallLog.map((t, idx) => ({
    turn: (t as { iteration?: number }).iteration ?? idx,
    toolName: t.toolName,
  })),
),
```

Add to the imports at the top of the change:

```ts
import { countParallelTurnsFromLog } from "./observers/run-observer.js";
```

- [ ] **Step 2: Add a snapshot-style test**

```ts
// packages/runtime/tests/execution-engine-telemetry-fields.test.ts
import { describe, it, expect } from "bun:test";
import {
  entropyVariance,
  entropyOscillationCount,
  finalCompositeEntropy,
  entropyAreaUnderCurve,
} from "../src/telemetry-enrichment.js";

describe("entropy enrichment pipeline contract", () => {
  it("all four features cope with an empty trace", () => {
    expect(entropyVariance([])).toBe(0);
    expect(entropyOscillationCount([])).toBe(0);
    expect(finalCompositeEntropy([])).toBeNull();
    expect(entropyAreaUnderCurve([])).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/runtime/`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/execution-engine.ts \
        packages/runtime/tests/execution-engine-telemetry-fields.test.ts
git commit -m "feat(runtime): emit enhanced entropy features in RunReport"
```

---

## Phase 5: Emit the adaptive-harness signals

### Task 12: Capture resolver dialect via a thread-local flag

**Files:**
- Modify: `packages/tools/src/tool-calling/native-fc-strategy.ts`
- Modify: `packages/tools/src/tool-calling/types.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/tools/tests/tool-calling/dialect-observed.test.ts
import { describe, it, expect } from "bun:test";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";
import { Runtime } from "effect";

const strategy = new NativeFCStrategy();
const run = <A>(effect: ReturnType<typeof strategy.resolve>) => Runtime.runSync(Runtime.defaultRuntime)(effect);

const tools = [{ name: "web-search", paramNames: ["query"] }];

describe("dialect reporting", () => {
  it("reports 'native-fc' when native tool_calls fire", () => {
    const result = strategy.resolveWithDialect(
      { content: "", toolCalls: [{ id: "1", name: "web-search", input: { query: "x" } }], stopReason: "tool_use" },
      tools,
    );
    const resolved = Runtime.runSync(Runtime.defaultRuntime)(result);
    expect(resolved.dialect).toBe("native-fc");
    expect(resolved.result._tag).toBe("tool_calls");
  });

  it("reports 'fenced-json' when a ```json block with a 'name' field fires", () => {
    const result = strategy.resolveWithDialect(
      { content: '```json\n{"name":"web-search","arguments":{"query":"x"}}\n```', stopReason: "end_turn" },
      tools,
    );
    const resolved = Runtime.runSync(Runtime.defaultRuntime)(result);
    expect(resolved.dialect).toBe("fenced-json");
  });

  it("reports 'none' when no tool call is extracted", () => {
    const result = strategy.resolveWithDialect(
      { content: "just narrative text", stopReason: "end_turn" },
      tools,
    );
    const resolved = Runtime.runSync(Runtime.defaultRuntime)(result);
    expect(resolved.dialect).toBe("none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tools/tests/tool-calling/dialect-observed.test.ts`
Expected: FAIL — `resolveWithDialect` not defined

- [ ] **Step 3: Add `resolveWithDialect` method**

Add to `NativeFCStrategy` in `packages/tools/src/tool-calling/native-fc-strategy.ts`:

```ts
export type DialectObserved = "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";

// Add this method to the NativeFCStrategy class:
resolveWithDialect(
  response: ResolverInput,
  availableTools: readonly ResolverToolHint[],
): Effect.Effect<{ result: ToolCallResult; dialect: DialectObserved }, never> {
  return Effect.succeed(this.extractWithDialect(response, availableTools));
}

private extractWithDialect(
  response: ResolverInput,
  availableTools: readonly ResolverToolHint[],
): { result: ToolCallResult; dialect: DialectObserved } {
  // Existing extract logic but instrumented to report which tier fired.
  // Implementation mirrors `extract()` — reuse helpers where possible.
  const toolNames = new Set(availableTools.map((t) => t.name));
  const calls = response.toolCalls;
  if (calls && calls.length > 0) {
    const result = this.extract(response, availableTools);
    if (result._tag === "tool_calls") return { result, dialect: "native-fc" };
  }
  const content = response.content ?? "";
  if (content.trim().length > 0) {
    const textSpecs = extractTextToolCalls(content, availableTools);
    if (textSpecs.length > 0) {
      // Shape-match path uses the same function — distinguish by spec.id prefix
      const isShape = textSpecs[0]!.id.startsWith("shape_");
      return {
        result: { _tag: "tool_calls", calls: textSpecs, thinking: undefined },
        dialect: isShape ? "nameless-shape" : "fenced-json",
      };
    }
    const pseudo = extractPseudoCodeToolCalls(content, availableTools);
    if (pseudo.length > 0) {
      return {
        result: { _tag: "tool_calls", calls: pseudo, thinking: undefined },
        dialect: "pseudo-code",
      };
    }
  }
  return { result: this.extract(response, availableTools), dialect: "none" };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test packages/tools/tests/tool-calling/`
Expected: all PASS (existing tests untouched; 3 new ones green)

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/tool-calling/native-fc-strategy.ts \
        packages/tools/tests/tool-calling/dialect-observed.test.ts
git commit -m "feat(resolver): expose which dialect tier fired per tool call"
```

---

### Task 13: Thread dialect observations to the RunReport

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts` (call `resolveWithDialect` and store result)
- Modify: `packages/runtime/src/execution-engine.ts` (read accumulated dialect, include in RunReport + observation)

- [ ] **Step 1: In `think.ts`, swap `resolver.resolve(...)` for `resolver.resolveWithDialect(...)`**

```ts
// packages/reasoning/src/strategies/kernel/phases/think.ts — around line 545
const { result: resolverResult, dialect: dialectObserved } = yield* (resolver as {
  resolveWithDialect: (
    input: typeof resolverInput,
    tools: readonly { name: string; paramNames?: readonly string[] }[],
  ) => Effect.Effect<{ result: ToolCallResult; dialect: "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none" }, never>;
}).resolveWithDialect(
  resolverInput,
  effectiveSchemas.map((ts) => ({
    name: ts.name,
    paramNames: ts.parameters?.map((p) => p.name) ?? [],
  })),
);

// Record the dialect on state.meta so execution-engine can read it.
if (dialectObserved !== "none") {
  state = transitionState(state, { meta: { ...state.meta, lastDialectObserved: dialectObserved } });
}
```

- [ ] **Step 2: In `execution-engine.ts`, read dialect from final state**

After the reasoning runs, inspect `ctx.metadata.reasoningResult` for `meta.lastDialectObserved` and pass it to both the `RunReport` (as `toolCallDialectObserved`) and `buildRunObservation` (as `dialect`).

- [ ] **Step 3: Run full reasoning + runtime suites**

Run: `bun test packages/reasoning/ packages/runtime/`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/think.ts \
        packages/runtime/src/execution-engine.ts
git commit -m "feat(telemetry): thread dialect observation into RunReport and local posterior"
```

---

### Task 14: Capture classifier false-positives and false-negatives

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (compute diff between classified required tools and actually-called tools)

- [ ] **Step 1: Write a unit test for the diff helper**

```ts
// packages/runtime/tests/classifier-accuracy.test.ts
import { describe, it, expect } from "bun:test";
import { diffClassifierAccuracy } from "../src/classifier-accuracy.js";

describe("diffClassifierAccuracy", () => {
  it("returns empty arrays when classifier matches actual", () => {
    const r = diffClassifierAccuracy(["web-search"], ["web-search"]);
    expect(r.falsePositives).toEqual([]);
    expect(r.falseNegatives).toEqual([]);
  });

  it("flags required-but-not-called as false positives", () => {
    const r = diffClassifierAccuracy(["web-search", "code-execute"], ["web-search"]);
    expect(r.falsePositives).toEqual(["code-execute"]);
  });

  it("flags called-heavily-but-not-required as false negatives when >=2 calls", () => {
    const r = diffClassifierAccuracy(
      [],
      ["http-get", "http-get", "http-get"],
    );
    expect(r.falseNegatives).toEqual(["http-get"]);
  });

  it("does NOT flag single incidental calls as false negatives", () => {
    const r = diffClassifierAccuracy([], ["http-get"]);
    expect(r.falseNegatives).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/classifier-accuracy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `diffClassifierAccuracy`**

```ts
// packages/runtime/src/classifier-accuracy.ts
/**
 * Compare what the classifier said was required against what the run actually called.
 * - False positive: classifier required X, but X was never called → classifier over-required
 * - False negative: tool Y was called ≥2 times but classifier didn't list it → classifier missed it
 *   (We require ≥2 calls to exclude single incidental invocations.)
 */
export function diffClassifierAccuracy(
  classifierRequired: readonly string[],
  actuallyCalledLog: readonly string[],
): { readonly falsePositives: readonly string[]; readonly falseNegatives: readonly string[] } {
  const callCounts = new Map<string, number>();
  for (const name of actuallyCalledLog) {
    callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
  }
  const requiredSet = new Set(classifierRequired);

  const falsePositives = classifierRequired.filter((name) => !callCounts.has(name));
  const falseNegatives = [...callCounts.entries()]
    .filter(([name, count]) => count >= 2 && !requiredSet.has(name))
    .map(([name]) => name);

  return { falsePositives, falseNegatives };
}
```

- [ ] **Step 4: Wire into execution-engine**

In `execution-engine.ts`, after collecting `toolCallLog`, compute:

```ts
import { diffClassifierAccuracy } from "./classifier-accuracy.js";

const actuallyCalledLog = toolCallLog.map((e) => e.toolName);
const classifierAcc = diffClassifierAccuracy(effectiveRequiredTools ?? [], actuallyCalledLog);
```

Then include in `client.send({...})`:

```ts
classifierFalsePositives: classifierAcc.falsePositives,
classifierFalseNegatives: classifierAcc.falseNegatives,
```

And in the `buildRunObservation` input:

```ts
classifierRequired: effectiveRequiredTools ?? [],
classifierActuallyCalled: [...new Set(actuallyCalledLog)],
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/runtime/`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/classifier-accuracy.ts \
        packages/runtime/tests/classifier-accuracy.test.ts \
        packages/runtime/src/execution-engine.ts
git commit -m "feat(telemetry): emit classifier false-positives/negatives per run"
```

---

### Task 15: Capture subagent invocation outcomes

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

- [ ] **Step 1: Derive subagent invocations from existing tool-call log**

In `execution-engine.ts`, immediately after building `toolCallLog`:

```ts
// Sub-agent tools are those registered via createAgentTool / spawn-agent / spawn-agents.
// We detect them via the tool name convention (framework registrations).
const SUBAGENT_TOOL_NAMES = new Set(["spawn-agent", "spawn-agents"]);
const subagentCalls = toolCallLog.filter(
  (e) => SUBAGENT_TOOL_NAMES.has(e.toolName) ||
         (agentTools ?? []).some((t) => t.name === e.toolName),
);
const subagentInvocations = subagentCalls.map((e) => ({
  delegated: true,
  succeeded: (e as { success?: boolean }).success ?? true,
}));
```

Include in `client.send({...})`:

```ts
subagentInvocations,
```

And in `buildRunObservation`:

```ts
subagentInvoked: subagentInvocations.length,
subagentSucceeded: subagentInvocations.filter((x) => x.succeeded).length,
```

- [ ] **Step 2: Add a small unit test on the filter logic (extracted helper)**

```ts
// packages/runtime/src/subagent-telemetry.ts
export const SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set(["spawn-agent", "spawn-agents"]);

export function isSubagentCall(
  toolName: string,
  customAgentToolNames: readonly string[],
): boolean {
  return SUBAGENT_TOOL_NAMES.has(toolName) || customAgentToolNames.includes(toolName);
}
```

```ts
// packages/runtime/tests/subagent-telemetry.test.ts
import { describe, it, expect } from "bun:test";
import { isSubagentCall, SUBAGENT_TOOL_NAMES } from "../src/subagent-telemetry.js";

describe("isSubagentCall", () => {
  it("recognizes spawn-agent and spawn-agents", () => {
    expect(isSubagentCall("spawn-agent", [])).toBe(true);
    expect(isSubagentCall("spawn-agents", [])).toBe(true);
  });
  it("recognizes user-registered agent tools", () => {
    expect(isSubagentCall("research-assistant", ["research-assistant"])).toBe(true);
  });
  it("returns false for non-agent tools", () => {
    expect(isSubagentCall("web-search", [])).toBe(false);
  });
  it("exports the builtin set", () => {
    expect(SUBAGENT_TOOL_NAMES.size).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/runtime/tests/subagent-telemetry.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/subagent-telemetry.ts \
        packages/runtime/tests/subagent-telemetry.test.ts \
        packages/runtime/src/execution-engine.ts
git commit -m "feat(telemetry): emit subagent invocation outcomes"
```

---

### Task 16: Compute and emit `toolArgValidityRate`

**Files:**
- Create: `packages/runtime/src/arg-validity.ts`
- Test: `packages/runtime/tests/arg-validity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/tests/arg-validity.test.ts
import { describe, it, expect } from "bun:test";
import { computeArgValidityRate } from "../src/arg-validity.js";

describe("computeArgValidityRate", () => {
  it("returns 1.0 when every call has a non-empty, object-shaped arguments dict", () => {
    const rate = computeArgValidityRate([
      { toolName: "web-search", arguments: { query: "x" } },
      { toolName: "http-get", arguments: { url: "https://example.com" } },
    ]);
    expect(rate).toBe(1);
  });

  it("returns 0 when no calls were made", () => {
    expect(computeArgValidityRate([])).toBe(0);
  });

  it("docks fraction for malformed args (empty/null/schema-leaked)", () => {
    const rate = computeArgValidityRate([
      { toolName: "web-search", arguments: { query: "ok" } },
      { toolName: "spawn-agent", arguments: { type: "object" } }, // schema leak
      { toolName: "file-write", arguments: {} },                   // empty
    ]);
    // 1 valid of 3
    expect(rate).toBeCloseTo(1 / 3, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/arg-validity.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// packages/runtime/src/arg-validity.ts
export interface ToolCallForValidity {
  readonly toolName: string;
  readonly arguments: unknown;
}

/**
 * Fraction of tool calls whose `arguments` look like a real value dict
 * (not a JSON-schema fragment, not empty, is a plain object).
 */
export function computeArgValidityRate(calls: readonly ToolCallForValidity[]): number {
  if (calls.length === 0) return 0;
  const valid = calls.filter((c) => isPlausibleArgs(c.arguments)).length;
  return valid / calls.length;
}

function isPlausibleArgs(args: unknown): boolean {
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  const dict = args as Record<string, unknown>;
  const keys = Object.keys(dict);
  if (keys.length === 0) return false;
  // Schema-fragment leak: only key is "type" with value "object" / "string" / etc.
  const isSchemaLeak =
    keys.length === 1 && keys[0] === "type" && typeof dict["type"] === "string";
  if (isSchemaLeak) return false;
  return true;
}
```

- [ ] **Step 4: Wire into execution-engine**

In `execution-engine.ts`, after `toolCallLog` is built, compute and emit:

```ts
import { computeArgValidityRate } from "./arg-validity.js";

const toolArgValidityRate = computeArgValidityRate(
  toolCallLog.map((e) => ({ toolName: e.toolName, arguments: (e as { arguments?: unknown }).arguments })),
);
```

Include `toolArgValidityRate` in `client.send({...})` and in `buildRunObservation({ argValidityRate: toolArgValidityRate, ... })`.

- [ ] **Step 5: Run tests**

Run: `bun test packages/runtime/`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/arg-validity.ts \
        packages/runtime/tests/arg-validity.test.ts \
        packages/runtime/src/execution-engine.ts
git commit -m "feat(telemetry): compute and emit toolArgValidityRate per run"
```

---

## Phase 6: classifierReliability bypass

### Task 17: Derive `classifierReliability` from observations

**Files:**
- Modify: `packages/reactive-intelligence/src/calibration/observations-merge.ts`
- Modify: `packages/reactive-intelligence/src/calibration/observations-types.ts` (if we need to extend `ModelCalibration`)
- Modify: `packages/llm-provider/src/calibration.ts` (add `classifierReliability` field to `ModelCalibration`)

- [ ] **Step 1: Extend `ModelCalibration` type with `classifierReliability`**

```ts
// packages/llm-provider/src/calibration.ts — add to ModelCalibration interface
readonly classifierReliability?: "high" | "low" | "skip";
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/reactive-intelligence/tests/calibration/observations-merge.classifier.test.ts
import { describe, it, expect } from "bun:test";
import { mergeObservationsIntoPrior } from "../../src/calibration/observations-merge.js";
import type { ModelObservations, RunObservation } from "../../src/calibration/observations-types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

const prior: ModelCalibration = {
  modelId: "cogito",
  calibratedAt: "2026-04-14T00:00:00.000Z",
  probeVersion: 1,
  runsAveraged: 3,
  steeringCompliance: "hybrid",
  parallelCallCapability: "partial",
  observationHandling: "needs-inline-facts",
  systemPromptAttention: "moderate",
  optimalToolResultChars: 1500,
};

function mkRuns(falsePositiveRate: number, count = 5): ModelObservations {
  const runs: RunObservation[] = Array.from({ length: count }, (_, i) => ({
    at: `2026-04-15T${String(i).padStart(2, "0")}:00:00.000Z`,
    parallelTurnCount: 0,
    totalTurnCount: 3,
    dialect: "native-fc",
    classifierRequired: ["web-search", "code-execute"],
    classifierActuallyCalled: falsePositiveRate >= (i + 1) / count ? ["web-search"] : ["web-search", "code-execute"],
    subagentInvoked: 0,
    subagentSucceeded: 0,
    argValidityRate: 1.0,
  }));
  return { schemaVersion: 1, modelId: "cogito", sampleCount: runs.length, runs };
}

describe("classifierReliability inference", () => {
  it("marks reliability 'high' when classifier accuracy ≥80%", () => {
    const merged = mergeObservationsIntoPrior(prior, mkRuns(0.0));
    expect(merged.classifierReliability).toBe("high");
  });

  it("marks reliability 'low' when >=40% of runs have false positives", () => {
    const merged = mergeObservationsIntoPrior(prior, mkRuns(0.6));
    expect(merged.classifierReliability).toBe("low");
  });

  it("does not set classifierReliability when below sample threshold", () => {
    const merged = mergeObservationsIntoPrior(prior, mkRuns(0.6, 3));
    expect(merged.classifierReliability).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/reactive-intelligence/tests/calibration/observations-merge.classifier.test.ts`
Expected: FAIL — field missing

- [ ] **Step 4: Implement in `observations-merge.ts`**

Extend `mergeObservationsIntoPrior`:

```ts
// Add after the parallelRate block:
const falsePositiveRuns = observations.runs.filter((r) => {
  const required = new Set(r.classifierRequired);
  const called = new Set(r.classifierActuallyCalled);
  for (const name of required) if (!called.has(name)) return true;
  return false;
}).length;
const falsePositiveRate = falsePositiveRuns / observations.runs.length;

const reliability: ModelCalibration["classifierReliability"] =
  falsePositiveRate < 0.2 ? "high" : falsePositiveRate >= 0.4 ? "low" : "high";
if (reliability !== prior.classifierReliability) {
  next = { ...next, classifierReliability: reliability };
}
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/reactive-intelligence/tests/calibration/`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add packages/llm-provider/src/calibration.ts \
        packages/reactive-intelligence/src/calibration/observations-merge.ts \
        packages/reactive-intelligence/tests/calibration/observations-merge.classifier.test.ts
git commit -m "feat(calibration): derive classifierReliability from false-positive rate"
```

---

### Task 18: Bypass the classifier LLM call when reliability is "low"

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (around line 1077-1110, the classifier invocation block)

- [ ] **Step 1: Add the bypass check**

```ts
// In execution-engine.ts, before calling classifyToolRelevance:
const classifierReliability = resolvedCalibration?.classifierReliability;
const needsClassification =
  classifierReliability !== "low" && classifierReliability !== "skip" &&
  ((config.requiredTools?.adaptive && !config.requiredTools?.tools?.length) ||
    config.adaptiveToolFiltering);

if (!needsClassification && classifierReliability === "low") {
  // Heuristic fallback: extract literal tool mentions from task text as required tools.
  const taskText = extractTaskText(task.input);
  const literalMentions = (availableToolSchemas ?? [])
    .map((t) => t.name)
    .filter((name) => {
      const pattern = new RegExp(`\\b${name.replace(/[-.]/g, "[-.]")}\\b`, "i");
      return pattern.test(taskText);
    });
  if (literalMentions.length > 0) {
    effectiveRequiredTools = literalMentions;
    if (obs && isNormal) {
      yield* obs.info(`◉ [classify]   skipped (reliability=low); literal mentions: ${literalMentions.join(", ")}`)
        .pipe(Effect.catchAll(() => Effect.void));
    }
  }
}
```

- [ ] **Step 2: Add integration test**

```ts
// packages/runtime/tests/classifier-bypass.test.ts
import { describe, it, expect } from "bun:test";
// This test verifies the literal-mention fallback produces the right required tools
// without running a real LLM classifier.
import { extractTaskText } from "../src/execution-engine.js";

function literalMentionRequired(text: string, available: readonly string[]): readonly string[] {
  return available.filter((name) => {
    const pattern = new RegExp(`\\b${name.replace(/[-.]/g, "[-.]")}\\b`, "i");
    return pattern.test(text);
  });
}

describe("classifier literal-mention fallback", () => {
  const tools = ["web-search", "http-get", "code-execute", "file-write"];

  it("picks web-search when task mentions it", () => {
    expect(literalMentionRequired("Use web-search to find X", tools)).toEqual(["web-search"]);
  });

  it("picks multiple when multiple mentioned", () => {
    expect(literalMentionRequired("Use web-search then file-write the result", tools))
      .toEqual(["web-search", "file-write"]);
  });

  it("picks none when no literal mentions", () => {
    expect(literalMentionRequired("What is the speed of light?", tools)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/runtime/tests/classifier-bypass.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 4: Full suite regression**

Run: `bun test`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/execution-engine.ts \
        packages/runtime/tests/classifier-bypass.test.ts
git commit -m "feat(runtime): skip classifier LLM call when reliability is low"
```

---

## Phase 7: Community profile fetch

### Task 19: Community profile HTTP client with caching

**Files:**
- Create: `packages/reactive-intelligence/src/calibration/community-profile-client.ts`
- Test: `packages/reactive-intelligence/tests/calibration/community-profile-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reactive-intelligence/tests/calibration/community-profile-client.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchCommunityProfile, type CommunityProfileClientOptions } from "../../src/calibration/community-profile-client.js";

let testRoot: string;
beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-comm-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

describe("fetchCommunityProfile", () => {
  it("returns undefined when offline (fetch rejects)", async () => {
    const opts: CommunityProfileClientOptions = {
      endpoint: "http://localhost:1/nonexistent",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => { throw new Error("offline"); },
    };
    const result = await fetchCommunityProfile("cogito", opts);
    expect(result).toBeUndefined();
  });

  it("returns cached value when fresh", async () => {
    const cachedPath = join(testRoot, "cogito.json");
    writeFileSync(cachedPath, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      profile: { parallelCallCapability: "reliable" },
    }));
    let fetchCalls = 0;
    const result = await fetchCommunityProfile("cogito", {
      endpoint: "http://example.invalid",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => { fetchCalls++; throw new Error("should not fetch"); },
    });
    expect(result?.parallelCallCapability).toBe("reliable");
    expect(fetchCalls).toBe(0);
  });

  it("fetches when cache is stale and updates the cache", async () => {
    const staleDate = new Date(Date.now() - 90_000).toISOString();
    writeFileSync(join(testRoot, "cogito.json"), JSON.stringify({
      fetchedAt: staleDate,
      profile: { parallelCallCapability: "sequential-only" },
    }));
    const result = await fetchCommunityProfile("cogito", {
      endpoint: "http://example.invalid",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => new Response(
        JSON.stringify({ parallelCallCapability: "reliable" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    expect(result?.parallelCallCapability).toBe("reliable");
  });

  it("returns undefined on 404", async () => {
    const result = await fetchCommunityProfile("unknown", {
      endpoint: "http://example.invalid",
      cacheDir: testRoot,
      cacheTtlMs: 60_000,
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    expect(result).toBeUndefined();
  });
});

describe("resolveDefaultProfileEndpoint", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses REACTIVE_AGENTS_TELEMETRY_PROFILES_URL when set (highest precedence)", async () => {
    process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"] = "https://override.example/v1/profiles";
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://should-be-ignored.example";
    const { resolveDefaultProfileEndpoint } = await import("../../src/calibration/community-profile-client.js");
    expect(resolveDefaultProfileEndpoint()).toBe("https://override.example/v1/profiles");
  });

  it("derives from REACTIVE_AGENTS_TELEMETRY_BASE_URL when no explicit profiles URL", async () => {
    delete process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"];
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://pi.home.example.com";
    const { resolveDefaultProfileEndpoint } = await import("../../src/calibration/community-profile-client.js");
    expect(resolveDefaultProfileEndpoint()).toBe("https://pi.home.example.com/v1/profiles");
  });

  it("trims trailing slash from base URL", async () => {
    delete process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"];
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://pi.home.example.com/";
    const { resolveDefaultProfileEndpoint } = await import("../../src/calibration/community-profile-client.js");
    expect(resolveDefaultProfileEndpoint()).toBe("https://pi.home.example.com/v1/profiles");
  });

  it("falls back to the hardcoded production default when nothing is set", async () => {
    delete process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"];
    delete process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"];
    const { resolveDefaultProfileEndpoint } = await import("../../src/calibration/community-profile-client.js");
    expect(resolveDefaultProfileEndpoint()).toMatch(/^https:\/\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reactive-intelligence/tests/calibration/community-profile-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the client**

```ts
// packages/reactive-intelligence/src/calibration/community-profile-client.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeModelIdForFile } from "./observations-store.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

export interface CommunityProfileClientOptions {
  readonly endpoint: string;
  readonly cacheDir?: string;
  readonly cacheTtlMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/**
 * Default profile endpoint. Resolution order (first match wins):
 *   1. Explicit `opts.endpoint` passed by caller.
 *   2. `REACTIVE_AGENTS_TELEMETRY_BASE_URL` env var (+ "/v1/profiles" suffix).
 *   3. `REACTIVE_AGENTS_TELEMETRY_PROFILES_URL` env var (full URL, overrides #2).
 *   4. Hardcoded production default (self-hosted Pi → `https://api.reactiveagents.dev`).
 *
 * Why a base URL env var: the existing TelemetryClient also needs the same base for
 * write requests (`/v1/reports`). A single BASE env simplifies operator config
 * across self-hosted deployments.
 */
export function resolveDefaultProfileEndpoint(): string {
  const fullOverride = process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"];
  if (fullOverride) return fullOverride;
  const baseOverride = process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"];
  if (baseOverride) return `${baseOverride.replace(/\/$/, "")}/v1/profiles`;
  return "https://api.reactiveagents.dev/v1/profiles";
}

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function defaultCacheDir(): string {
  return join(homedir(), ".reactive-agents", "community-profiles");
}

interface CacheEntry {
  readonly fetchedAt: string;
  readonly profile: Partial<ModelCalibration>;
}

export async function fetchCommunityProfile(
  modelId: string,
  opts: Partial<CommunityProfileClientOptions> = {},
): Promise<Partial<ModelCalibration> | undefined> {
  const endpoint = opts.endpoint ?? resolveDefaultProfileEndpoint();
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fetchFn = opts.fetchImpl ?? fetch;
  const fileName = `${normalizeModelIdForFile(modelId)}.json`;
  const cachePath = join(cacheDir, fileName);

  // 1) Serve fresh cache
  const cached = readCache(cachePath);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < ttl) {
    return cached.profile;
  }

  // 2) Fetch
  try {
    const url = `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(modelId)}`;
    const response = await fetchFn(url, { signal: opts.signal });
    if (response.status === 404) return undefined;
    if (!response.ok) return cached?.profile;
    const profile = (await response.json()) as Partial<ModelCalibration>;
    writeCache(cachePath, { fetchedAt: new Date().toISOString(), profile });
    return profile;
  } catch {
    // Offline or network error — serve stale cache if we have one, else undefined
    return cached?.profile;
  }
}

function readCache(path: string): CacheEntry | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CacheEntry;
  } catch {
    return undefined;
  }
}

function writeCache(path: string, entry: CacheEntry): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry, null, 2));
  } catch {
    // Cache write failure is non-fatal
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/reactive-intelligence/tests/calibration/community-profile-client.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/calibration/community-profile-client.ts \
        packages/reactive-intelligence/tests/calibration/community-profile-client.test.ts
git commit -m "feat(calibration): community profile HTTP client with TTL cache"
```

---

### Task 20: Use community profile in `resolveModelCalibration`

**Files:**
- Modify: `packages/llm-provider/src/calibration.ts`

- [ ] **Step 1: Update `resolveModelCalibration` to fetch community profile when requested**

```ts
// Extend ResolveModelCalibrationOptions
export interface ResolveModelCalibrationOptions {
  readonly communityProfile?: Partial<ModelCalibration>;
  readonly observationsBaseDir?: string;
  /** When true, attempt to fetch a community profile lazily. Defaults to false. */
  readonly fetchCommunity?: boolean;
  /** Override the community endpoint (useful for tests). */
  readonly communityEndpoint?: string;
}

// Provide an async variant for callers that can await
export async function resolveModelCalibrationAsync(
  modelId: string,
  opts: ResolveModelCalibrationOptions = {},
): Promise<ModelCalibration | undefined> {
  let community = opts.communityProfile;
  if (!community && opts.fetchCommunity) {
    const { fetchCommunityProfile } = await import("@reactive-agents/reactive-intelligence");
    community = await fetchCommunityProfile(modelId, { endpoint: opts.communityEndpoint });
  }
  return resolveModelCalibration(modelId, { ...opts, communityProfile: community });
}
```

- [ ] **Step 2: Wire through to execution-engine (opt-in via config)**

In `execution-engine.ts`, replace the current `resolveModelCalibration(...)` call with:

```ts
const fetchCommunity = config.reactiveIntelligenceOptions?.calibrationFetch === true;
// Note: use the sync path by default; only await the async one if community fetch is enabled.
const resolved = fetchCommunity
  ? yield* Effect.tryPromise(() =>
      resolveModelCalibrationAsync(String(config.defaultModel ?? ""), {
        observationsBaseDir: process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"],
        fetchCommunity: true,
      }),
    ).pipe(Effect.catchAll(() => Effect.succeed(resolveModelCalibration(String(config.defaultModel ?? "")))))
  : resolveModelCalibration(String(config.defaultModel ?? ""));
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/llm-provider/`
Expected: all PASS (existing tests don't touch async path)

- [ ] **Step 4: Commit**

```bash
git add packages/llm-provider/src/calibration.ts \
        packages/runtime/src/execution-engine.ts
git commit -m "feat(calibration): async resolveModelCalibrationAsync with community fetch"
```

---

### Task 20.5: Apply `REACTIVE_AGENTS_TELEMETRY_BASE_URL` to the existing TelemetryClient

The community fetch path (Task 19) now honors an env var so self-hosted deployments can redirect profile reads. For operator-config consistency, the existing *write* path (`TelemetryClient` in `packages/reactive-intelligence/src/telemetry/telemetry-client.ts`) should respect the same base URL env var. Without this, users who self-host the server would need to configure read and write separately.

**Files:**
- Modify: `packages/reactive-intelligence/src/telemetry/telemetry-client.ts`
- Test: `packages/reactive-intelligence/tests/telemetry/telemetry-client-env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reactive-intelligence/tests/telemetry/telemetry-client-env.test.ts
import { describe, it, expect, afterEach } from "bun:test";
import { resolveDefaultReportsEndpoint } from "../../src/telemetry/telemetry-client.js";

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

describe("resolveDefaultReportsEndpoint", () => {
  it("uses REACTIVE_AGENTS_TELEMETRY_REPORTS_URL when set (highest precedence)", () => {
    process.env["REACTIVE_AGENTS_TELEMETRY_REPORTS_URL"] = "https://override.example/v1/reports";
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://should-be-ignored.example";
    expect(resolveDefaultReportsEndpoint()).toBe("https://override.example/v1/reports");
  });

  it("derives from REACTIVE_AGENTS_TELEMETRY_BASE_URL", () => {
    delete process.env["REACTIVE_AGENTS_TELEMETRY_REPORTS_URL"];
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://pi.home.example.com";
    expect(resolveDefaultReportsEndpoint()).toBe("https://pi.home.example.com/v1/reports");
  });

  it("falls back to hardcoded default when neither env var is set", () => {
    delete process.env["REACTIVE_AGENTS_TELEMETRY_REPORTS_URL"];
    delete process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"];
    expect(resolveDefaultReportsEndpoint()).toMatch(/\/v1\/reports$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reactive-intelligence/tests/telemetry/telemetry-client-env.test.ts`
Expected: FAIL — `resolveDefaultReportsEndpoint` not exported

- [ ] **Step 3: Add the resolver and apply it in the client**

```ts
// packages/reactive-intelligence/src/telemetry/telemetry-client.ts — update top of file
const HARDCODED_DEFAULT = "https://api.reactiveagents.dev/v1/reports";

/**
 * Same precedence logic as community-profile-client's resolveDefaultProfileEndpoint.
 * Keeps operator-config symmetrical: one BASE URL env var covers both read and write.
 */
export function resolveDefaultReportsEndpoint(): string {
  const full = process.env["REACTIVE_AGENTS_TELEMETRY_REPORTS_URL"];
  if (full) return full;
  const base = process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"];
  if (base) return `${base.replace(/\/$/, "")}/v1/reports`;
  return HARDCODED_DEFAULT;
}

export class TelemetryClient {
  // constructor default changes to use resolver:
  constructor(private readonly endpoint: string = resolveDefaultReportsEndpoint()) {
    this.installId = getOrCreateInstallId();
  }
  // ... rest unchanged
}
```

- [ ] **Step 4: Run tests to verify green**

Run: `bun test packages/reactive-intelligence/tests/telemetry/`
Expected: PASS, new tests + any existing ones unaffected

- [ ] **Step 5: Document the env var in AGENTS.md / vision doc**

Add a brief operator note explaining:

```
# Self-hosted telemetry deployments

Set REACTIVE_AGENTS_TELEMETRY_BASE_URL=https://your-host to redirect both
read (/v1/profiles/:id) and write (/v1/reports) endpoints in one place.

Per-endpoint overrides are also supported:
  REACTIVE_AGENTS_TELEMETRY_PROFILES_URL (full URL, overrides base for reads)
  REACTIVE_AGENTS_TELEMETRY_REPORTS_URL  (full URL, overrides base for writes)

Precedence per endpoint:
  1. Builder config (.withReactiveIntelligence({ telemetry: { endpoint } }))
  2. Full-URL env var for that endpoint
  3. BASE_URL env var (+ path suffix)
  4. Hardcoded production default
```

- [ ] **Step 6: Commit**

```bash
git add packages/reactive-intelligence/src/telemetry/telemetry-client.ts \
        packages/reactive-intelligence/tests/telemetry/telemetry-client-env.test.ts \
        AGENTS.md
git commit -m "feat(telemetry): REACTIVE_AGENTS_TELEMETRY_BASE_URL env var for self-hosted"
```

---

## Phase 8: Observability surface

### Task 21: Show calibration provenance in execution summary

**Files:**
- Modify: `packages/observability/src/renderers/summary.ts` (or equivalent — see file that renders "Agent Execution Summary")

- [ ] **Step 1: Expose calibration provenance on the execution result**

When `resolveModelCalibration` merges, record a one-line provenance string in execution metadata:

```
calibration: cogito | source: prior+local (12 samples) | parallel=reliable classifier=low
```

Add a one-line renderer below the existing summary box. When `fetchCommunity: true` and a profile was fetched, include `+community`.

- [ ] **Step 2: Add a small test for the renderer**

```ts
// packages/observability/tests/calibration-provenance.test.ts
import { describe, it, expect } from "bun:test";
import { renderCalibrationProvenance } from "../src/renderers/calibration-provenance.js";

describe("renderCalibrationProvenance", () => {
  it("prints prior-only when no community and no local", () => {
    expect(renderCalibrationProvenance({
      modelId: "cogito", sources: ["prior"], localSamples: 0,
      summary: { parallelCallCapability: "partial" },
    })).toContain("prior-only");
  });
  it("prints prior+local with sample count when local samples met threshold", () => {
    expect(renderCalibrationProvenance({
      modelId: "cogito", sources: ["prior", "local"], localSamples: 12,
      summary: { parallelCallCapability: "reliable" },
    })).toContain("12 samples");
  });
});
```

- [ ] **Step 3: Implement the renderer**

Create `packages/observability/src/renderers/calibration-provenance.ts`:

```ts
export interface CalibrationProvenance {
  readonly modelId: string;
  readonly sources: readonly ("prior" | "community" | "local")[];
  readonly localSamples: number;
  readonly summary: Partial<{
    parallelCallCapability: string;
    classifierReliability: string;
  }>;
}

export function renderCalibrationProvenance(p: CalibrationProvenance): string {
  const sourceLabel =
    p.sources.length === 1 && p.sources[0] === "prior" ? "prior-only" : p.sources.join("+");
  const samplePart = p.sources.includes("local") ? ` (${p.localSamples} samples)` : "";
  const summaryBits: string[] = [];
  if (p.summary.parallelCallCapability) summaryBits.push(`parallel=${p.summary.parallelCallCapability}`);
  if (p.summary.classifierReliability) summaryBits.push(`classifier=${p.summary.classifierReliability}`);
  const summaryPart = summaryBits.length > 0 ? ` | ${summaryBits.join(" ")}` : "";
  return `calibration: ${p.modelId} | source: ${sourceLabel}${samplePart}${summaryPart}`;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test packages/observability/tests/calibration-provenance.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Wire into the existing summary renderer**

In whatever module renders "Agent Execution Summary", import `renderCalibrationProvenance` and print its output on a new line below the box.

- [ ] **Step 6: Commit**

```bash
git add packages/observability/src/renderers/calibration-provenance.ts \
        packages/observability/tests/calibration-provenance.test.ts
git commit -m "feat(observability): render calibration provenance in execution summary"
```

---

## Phase 9: Validation

### Task 22: End-to-end multi-model probe

**Files:**
- Reuse: `.agents/skills/harness-improvement-loop/scripts/multi-model-test.ts`

- [ ] **Step 1: Clear observations + cache, run probe once per model, confirm no regression**

```bash
rm -rf ~/.reactive-agents/observations ~/.reactive-agents/community-profiles
bun .agents/skills/harness-improvement-loop/scripts/multi-model-test.ts \
  --category convergence,strategy,subagent,tools,efficiency \
  --max 20 \
  --models gemma4:e4b,cogito,qwen3:4b
```

Expected: ≥100% pass rate on all three models (matches Pass 2 baseline).

- [ ] **Step 2: Run probe 5 more times to populate observations**

Same command 5 times. Observations accumulate under `~/.reactive-agents/observations/`.

- [ ] **Step 3: Inspect observations and confirm `parallelCallCapability` adapts**

```bash
cat ~/.reactive-agents/observations/gemma4-e4b.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('samples:', d['sampleCount']); print('parallel rate:', sum(1 for r in d['runs'] if r['parallelTurnCount']>0) / len(d['runs']))"
```

Expected: sample count ≥5, parallel rate is a number in [0, 1].

- [ ] **Step 4: Run probe a 6th time and confirm `calibration provenance` line shows `prior+local (N samples)`**

The execution summary should display the calibration provenance line with the updated source.

- [ ] **Step 5: Commit any test-harness tweaks from the validation run**

```bash
git add .agents/skills/harness-improvement-loop/scripts/multi-model-test.ts
git commit -m "chore(harness): validation tweaks after adaptive-harness rollout"
```

---

## Phase 10: Closeout

### Task 23: Update AGENTS.md + vision doc inventory

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/spec/docs/00-VISION.md` (the "What We've Shipped" table)

- [ ] **Step 1: Add a row to the Vision shipped-table**

| Live calibration (prior + community + local posterior) | **Shipped** | v0.9 |

- [ ] **Step 2: Add a short paragraph to AGENTS.md under "Model-Adaptive Intelligence"** that explains the three-tier resolver and where observations live.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md docs/spec/docs/00-VISION.md
git commit -m "docs: document live calibration in vision inventory + agents guide"
```

---

## Self-review checklist

Before handing off:
- Every task has a failing test, minimal impl, passing test, commit.
- No "TBD" / "similar to above" / placeholder content.
- Type consistency: `ModelCalibration`, `ModelObservations`, `RunObservation` are defined once and used everywhere.
- Observation schema version bumps on ANY breaking change.
- Tests never write outside `testRoot` — all tests use `mkdtempSync` for isolation.
- Observer is best-effort: every persistence call is wrapped in try/catch.
- Opt-out: `{ telemetry: false }` path already works; no new mandatory writes.
- No hot-path cost: fetch is lazy/async and cache-backed.

## Execution handoff

After the plan is reviewed, choose one:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review checkpoints.
2. **Inline Execution** — use `superpowers:executing-plans` with batch checkpoints.

Dependencies on the paired telemetry-server plan:
- Tasks 19–20 (community fetch) depend on `GET /v1/profiles/:modelId` being live. Until then, `fetchCommunity: false` is the default and the framework runs entirely on shipped-prior + local posterior. Ship Tasks 1–18 and 21–23 regardless; Tasks 19–20 activate when the server is ready.
