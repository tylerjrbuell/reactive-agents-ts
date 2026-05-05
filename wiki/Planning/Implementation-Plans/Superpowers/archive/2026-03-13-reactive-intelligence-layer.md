# Reactive Intelligence Layer — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Entropy Sensor (Phase 1) — a metacognitive layer that scores reasoning quality per-iteration across 5 entropy sources, with conformal calibration and EventBus observability.

**Architecture:** New package `@reactive-agents/reactive-intelligence` with `EntropySensorService` (Effect Context.Tag). The service tag is defined in the new package but resolved loosely via `Effect.serviceOption()` in `@reactive-agents/reasoning` to avoid circular dependencies. Hooks into `kernel-runner.ts` after each `kernel()` call by detecting new thought steps. Upstream changes to `@reactive-agents/llm-provider` (logprobs), `@reactive-agents/reasoning` (KernelRunOptions), and `@reactive-agents/core` (new events + `EntropySensorService` tag). Phase 2 (Controller) and Phase 3 (Learning Engine) are stubbed but not implemented — gated behind Phase 1 validation.

**Circular dependency avoidance:** `@reactive-agents/reactive-intelligence` depends on `@reactive-agents/core` and `@reactive-agents/llm-provider` only (NOT reasoning). The `EntropySensorService` Context.Tag is defined in `@reactive-agents/core` (alongside EventBus, AgentService, etc.) so that reasoning can resolve it without importing reactive-intelligence. The reactive-intelligence package provides the `Layer` implementation. The `KernelState` type needed by the service is replaced with a loose structural type (`KernelStateLike`) to avoid the import.

**Tech Stack:** Effect-TS (Context.Tag, Layer.effect, Effect.gen), bun:test, bun:sqlite (calibration persistence), cosine similarity (vendored), existing LLMService.embed()

**Spec:** `docs/superpowers/specs/2026-03-13-reactive-intelligence-layer.md`

---

## Chunk 1: Package Foundation + Upstream Changes

### Task 1: Package Scaffold

**Files:**
- Create: `packages/reactive-intelligence/package.json`
- Create: `packages/reactive-intelligence/tsconfig.json`
- Create: `packages/reactive-intelligence/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@reactive-agents/reactive-intelligence",
  "version": "0.7.8",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup --config ../../tsup.config.base.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "test:watch": "bun test --watch"
  },
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "0.7.8",
    "@reactive-agents/llm-provider": "0.7.8"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/tylerjrbuell/reactive-agents-ts.git",
    "directory": "packages/reactive-intelligence"
  },
  "publishConfig": { "access": "public" },
  "files": ["dist", "README.md", "LICENSE"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "description": "Reactive Intelligence Layer — entropy-based metacognitive sensing for Reactive Agents",
  "homepage": "https://docs.reactiveagents.dev/",
  "bugs": { "url": "https://github.com/tylerjrbuell/reactive-agents-ts/issues" }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["bun-types"],
    "paths": {}
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create placeholder index.ts**

```typescript
// @reactive-agents/reactive-intelligence
// Phase 1: Entropy Sensor

export {} // placeholder — populated as modules are built
```

- [ ] **Step 4: Add to workspace**

Check `package.json` at repo root — ensure `packages/reactive-intelligence` is in the workspace glob. Most likely already covered by `"packages/*"`.

Run: `bun install`
Expected: resolves successfully, new package appears in node_modules

- [ ] **Step 5: Verify build**

Run: `cd packages/reactive-intelligence && bun run build`
Expected: builds without errors (empty index)

- [ ] **Step 6: Commit**

```bash
git add packages/reactive-intelligence/
git commit -m "feat(reactive-intelligence): scaffold new package"
```

---

### Task 2: Types Module

**Files:**
- Create: `packages/reactive-intelligence/src/types.ts`

All type definitions from the spec. No logic, no dependencies beyond Effect Schema.

- [ ] **Step 1: Write the types file**

```typescript
import { Schema } from "effect";

// ─── Token Logprob (mirrors upstream addition to llm-provider) ───

export type TokenLogprob = {
  readonly token: string;
  readonly logprob: number;
  readonly topLogprobs?: readonly { token: string; logprob: number }[];
};

// ─── 1A: Token Entropy ───

export type TokenEntropy = {
  readonly tokenEntropies: readonly number[];
  readonly sequenceEntropy: number;
  readonly toolCallEntropy: number;
  readonly peakEntropy: number;
  readonly entropySpikes: readonly { position: number; value: number }[];
};

// ─── 1B: Structural Entropy ───

export type StructuralEntropy = {
  readonly formatCompliance: number;
  readonly orderIntegrity: number;
  readonly thoughtDensity: number;
  readonly vocabularyDiversity: number;
  readonly hedgeScore: number;
  readonly jsonParseScore: number;
};

// ─── 1C: Semantic Entropy ───

export type SemanticEntropy = {
  readonly taskAlignment: number;
  readonly noveltyScore: number;
  readonly adjacentRepetition: number;
  readonly available: boolean;
};

// ─── 1D: Behavioral Entropy ───

export type BehavioralEntropy = {
  readonly toolSuccessRate: number;
  readonly actionDiversity: number;
  readonly loopDetectionScore: number;
  readonly completionApproach: number;
};

// ─── 1E: Context Pressure ───

export type ContextSection = {
  readonly label: string;
  readonly tokenEstimate: number;
  readonly signalDensity: number;
  readonly position: "near" | "mid" | "far";
};

export type ContextPressure = {
  readonly utilizationPct: number;
  readonly sections: readonly ContextSection[];
  readonly atRiskSections: readonly string[];
  readonly compressionHeadroom: number;
};

// ─── 1F: Entropy Trajectory ───

export type EntropyTrajectoryShape =
  | "converging"
  | "flat"
  | "diverging"
  | "v-recovery"
  | "oscillating";

export type EntropyTrajectory = {
  readonly history: readonly number[];
  readonly derivative: number;
  readonly momentum: number;
  readonly shape: EntropyTrajectoryShape;
};

// ─── Composite Entropy Score ───

export type EntropyScore = {
  readonly composite: number;
  readonly sources: {
    readonly token: number | null;
    readonly structural: number;
    readonly semantic: number | null;
    readonly behavioral: number;
    readonly contextPressure: number;
  };
  readonly trajectory: EntropyTrajectory;
  readonly confidence: "high" | "medium" | "low";
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly iteration: number;
  readonly iterationWeight: number;
  readonly timestamp: number;
  readonly tokenEntropies?: readonly number[];
  readonly entropySpikes?: readonly { position: number; value: number }[];
};

// ─── Model Calibration ───

export type ModelCalibration = {
  readonly modelId: string;
  readonly calibrationScores: readonly number[];
  readonly sampleCount: number;
  readonly highEntropyThreshold: number;
  readonly convergenceThreshold: number;
  readonly calibrated: boolean;
  readonly lastUpdated: number;
  readonly driftDetected: boolean;
};

// ─── Entropy Meta (typed sub-object for KernelState.meta) ───

export type EntropyMeta = {
  taskDescription?: string;
  modelId?: string;
  temperature?: number;
  lastLogprobs?: readonly TokenLogprob[];
  entropyHistory?: EntropyScore[];
  thoughtEmbeddings?: { embeddings: number[][]; centroid: number[] };
};

// ─── Model Registry Entry ───

export type ModelRegistryEntry = {
  readonly contextLimit: number;
  readonly tier: "frontier" | "local" | "unknown";
  readonly logprobSupport: boolean;
};

// ─── Reactive Intelligence Config ───

export type ReactiveIntelligenceConfig = {
  readonly entropy: {
    readonly enabled: boolean;
    readonly tokenEntropy?: boolean;
    readonly semanticEntropy?: boolean;
    readonly trajectoryTracking?: boolean;
  };
  readonly controller: {
    readonly earlyStop?: boolean;
    readonly branching?: boolean;
    readonly contextCompression?: boolean;
    readonly strategySwitch?: boolean;
    readonly causalAttribution?: boolean;
  };
  readonly learning: {
    readonly banditSelection?: boolean;
    readonly skillSynthesis?: boolean;
    readonly skillDir?: string;
  };
  readonly models?: Record<string, ModelRegistryEntry>;
};

export const defaultReactiveIntelligenceConfig: ReactiveIntelligenceConfig = {
  entropy: {
    enabled: true,
    tokenEntropy: true,
    semanticEntropy: true,
    trajectoryTracking: true,
  },
  controller: {
    earlyStop: false,
    branching: false,
    contextCompression: false,
    strategySwitch: false,
    causalAttribution: false,
  },
  learning: {
    banditSelection: false,
    skillSynthesis: false,
  },
};
```

- [ ] **Step 2: Export from index.ts**

```typescript
// @reactive-agents/reactive-intelligence
// Phase 1: Entropy Sensor

export type {
  TokenLogprob,
  TokenEntropy,
  StructuralEntropy,
  SemanticEntropy,
  BehavioralEntropy,
  ContextSection,
  ContextPressure,
  EntropyTrajectoryShape,
  EntropyTrajectory,
  EntropyScore,
  ModelCalibration,
  EntropyMeta,
  ModelRegistryEntry,
  ReactiveIntelligenceConfig,
} from "./types.js";
export { defaultReactiveIntelligenceConfig } from "./types.js";
```

- [ ] **Step 3: Verify build**

Run: `cd packages/reactive-intelligence && bun run build`
Expected: builds without errors

- [ ] **Step 4: Commit**

```bash
git add packages/reactive-intelligence/src/types.ts packages/reactive-intelligence/src/index.ts
git commit -m "feat(reactive-intelligence): add all Phase 1 type definitions"
```

---

### Task 3: Events Module + Core Upstream Changes (including EntropySensorService tag)

**Files:**
- Create: `packages/reactive-intelligence/src/events.ts`
- Modify: `packages/core/src/services/event-bus.ts` — add 4 new event types to AgentEvent union
- Create: `packages/core/src/services/entropy-sensor-tag.ts` — define EntropySensorService Context.Tag in core (avoids circular dep)
- Modify: `packages/core/src/index.ts` — export the new tag

**Why the tag lives in core:** The `EntropySensorService` tag must be importable by `@reactive-agents/reasoning` (which resolves it via `Effect.serviceOption()`) AND by `@reactive-agents/reactive-intelligence` (which provides the `Layer` implementation). Placing the tag in core — alongside EventBus, AgentService, etc. — breaks the circular dependency. The tag definition uses a loose `KernelStateLike` structural type instead of importing `KernelState` from reasoning.

- [ ] **Step 1: Write events.ts with event type definitions**

```typescript
import type { EntropyTrajectoryShape } from "./types.js";

// Event payload types — these mirror the shapes added to AgentEvent in @reactive-agents/core

export type EntropyScored = {
  readonly _tag: "EntropyScored";
  readonly taskId: string;
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
    readonly shape: EntropyTrajectoryShape;
    readonly momentum: number;
  };
  readonly confidence: "high" | "medium" | "low";
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly iterationWeight: number;
};

export type ContextWindowWarning = {
  readonly _tag: "ContextWindowWarning";
  readonly taskId: string;
  readonly modelId: string;
  readonly utilizationPct: number;
  readonly compressionHeadroom: number;
  readonly atRiskSections: readonly string[];
};

export type CalibrationDrift = {
  readonly _tag: "CalibrationDrift";
  readonly taskId: string;
  readonly modelId: string;
  readonly expectedMean: number;
  readonly observedMean: number;
  readonly deviationSigma: number;
};

export type ReactiveDecision = {
  readonly _tag: "ReactiveDecision";
  readonly taskId: string;
  readonly iteration: number;
  readonly decision:
    | "early-stop"
    | "branch"
    | "compress"
    | "switch-strategy"
    | "attribute";
  readonly reason: string;
  readonly entropyBefore: number;
  readonly entropyAfter?: number;
};
```

- [ ] **Step 2: Create EntropySensorService tag in core**

Create `packages/core/src/services/entropy-sensor-tag.ts`:

```typescript
import { Context, Effect } from "effect";

// ─── Loose types to avoid importing from @reactive-agents/reasoning ───

/** Structural match for KernelState — avoids circular dependency. */
export type KernelStateLike = {
  readonly taskId: string;
  readonly strategy: string;
  readonly kernelType: string;
  readonly steps: readonly { type: string; content?: string; metadata?: Record<string, unknown> }[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly iteration: number;
  readonly tokens: number;
  readonly status: string;
  readonly output: string | null;
  readonly error: string | null;
  readonly meta: Readonly<Record<string, unknown>>;
};

export type TokenLogprobLike = {
  readonly token: string;
  readonly logprob: number;
  readonly topLogprobs?: readonly { token: string; logprob: number }[];
};

export type EntropyScoreLike = {
  readonly composite: number;
  readonly sources: {
    readonly token: number | null;
    readonly structural: number;
    readonly semantic: number | null;
    readonly behavioral: number;
    readonly contextPressure: number;
  };
  readonly trajectory: { readonly derivative: number; readonly shape: string; readonly momentum: number };
  readonly confidence: "high" | "medium" | "low";
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly iteration: number;
  readonly iterationWeight: number;
  readonly timestamp: number;
};

export type EntropyTrajectoryLike = {
  readonly history: readonly number[];
  readonly derivative: number;
  readonly momentum: number;
  readonly shape: string;
};

export type ModelCalibrationLike = {
  readonly modelId: string;
  readonly calibrated: boolean;
  readonly sampleCount: number;
  readonly highEntropyThreshold: number;
  readonly convergenceThreshold: number;
};

export type ContextSectionLike = {
  readonly label: string;
  readonly tokenEstimate: number;
  readonly signalDensity: number;
  readonly position: "near" | "mid" | "far";
};

export type ContextPressureLike = {
  readonly utilizationPct: number;
  readonly sections: readonly ContextSectionLike[];
  readonly atRiskSections: readonly string[];
  readonly compressionHeadroom: number;
};

export class EntropySensorService extends Context.Tag("EntropySensorService")<
  EntropySensorService,
  {
    readonly score: (params: {
      thought: string;
      taskDescription: string;
      strategy: string;
      iteration: number;
      maxIterations: number;
      modelId: string;
      temperature: number;
      priorThought?: string;
      logprobs?: readonly TokenLogprobLike[];
      kernelState: KernelStateLike;
    }) => Effect.Effect<EntropyScoreLike, never>;

    readonly scoreContext: (params: {
      modelId: string;
      sections: ContextSectionLike[];
    }) => Effect.Effect<ContextPressureLike, never>;

    readonly getCalibration: (modelId: string) => Effect.Effect<ModelCalibrationLike, never>;

    readonly updateCalibration: (
      modelId: string,
      runScores: readonly number[],
    ) => Effect.Effect<ModelCalibrationLike, never>;

    readonly getTrajectory: (taskId: string) => Effect.Effect<EntropyTrajectoryLike, never>;
  }
>() {}
```

Export from `packages/core/src/index.ts`:
```typescript
export { EntropySensorService } from "./services/entropy-sensor-tag.js";
export type {
  KernelStateLike,
  TokenLogprobLike,
  EntropyScoreLike,
  EntropyTrajectoryLike,
  ModelCalibrationLike,
  ContextSectionLike,
  ContextPressureLike,
} from "./services/entropy-sensor-tag.js";
```

- [ ] **Step 3: Add event types to AgentEvent union in core**

Open `packages/core/src/services/event-bus.ts`. Find the `AgentEvent` type union and add the 4 new event types. Also add the corresponding tag values to `AgentEventTag`.

The exact insertion point is at the end of the union, before the `Custom` event type. Add:

```typescript
  // ─── Reactive Intelligence ───
  | {
      readonly _tag: "EntropyScored";
      readonly taskId: string;
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
        readonly shape: "converging" | "flat" | "diverging" | "v-recovery" | "oscillating";
        readonly momentum: number;
      };
      readonly confidence: "high" | "medium" | "low";
      readonly modelTier: "frontier" | "local" | "unknown";
      readonly iterationWeight: number;
    }
  | {
      readonly _tag: "ContextWindowWarning";
      readonly taskId: string;
      readonly modelId: string;
      readonly utilizationPct: number;
      readonly compressionHeadroom: number;
      readonly atRiskSections: readonly string[];
    }
  | {
      readonly _tag: "CalibrationDrift";
      readonly taskId: string;
      readonly modelId: string;
      readonly expectedMean: number;
      readonly observedMean: number;
      readonly deviationSigma: number;
    }
  | {
      readonly _tag: "ReactiveDecision";
      readonly taskId: string;
      readonly iteration: number;
      readonly decision: "early-stop" | "branch" | "compress" | "switch-strategy" | "attribute";
      readonly reason: string;
      readonly entropyBefore: number;
      readonly entropyAfter?: number;
    }
```

- [ ] **Step 3: Verify core builds**

Run: `cd packages/core && bun run build`
Expected: builds without errors

- [ ] **Step 4: Export events from index.ts**

Add to `packages/reactive-intelligence/src/index.ts`:
```typescript
export type {
  EntropyScored,
  ContextWindowWarning,
  CalibrationDrift,
  ReactiveDecision,
} from "./events.js";
```

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/events.ts packages/core/src/services/event-bus.ts packages/reactive-intelligence/src/index.ts
git commit -m "feat(core, reactive-intelligence): add 4 entropy event types to AgentEvent union"
```

---

### Task 4: Upstream — LogProbs in LLM Provider

**Files:**
- Modify: `packages/llm-provider/src/types.ts` — add `logprobs` fields to CompletionRequest and CompletionResponse
- Modify: `packages/llm-provider/src/providers/local.ts` — wire Ollama logprobs
- Modify: `packages/llm-provider/src/providers/openai.ts` — wire OpenAI logprobs
- Create: `packages/llm-provider/tests/logprobs.test.ts`

- [ ] **Step 1: Write failing test for logprob types**

Create `packages/llm-provider/tests/logprobs.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type { CompletionRequest, CompletionResponse } from "../src/types.js";

describe("logprob types", () => {
  test("CompletionRequest accepts logprobs fields", () => {
    const req: CompletionRequest = {
      messages: [{ role: "user", content: "hello" }],
      logprobs: true,
      topLogprobs: 5,
    };
    expect(req.logprobs).toBe(true);
    expect(req.topLogprobs).toBe(5);
  });

  test("CompletionResponse includes logprobs field", () => {
    const res: CompletionResponse = {
      content: "hello",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
      model: "test",
      logprobs: [
        { token: "hello", logprob: -0.1, topLogprobs: [{ token: "hello", logprob: -0.1 }, { token: "hi", logprob: -2.3 }] },
      ],
    };
    expect(res.logprobs).toHaveLength(1);
    expect(res.logprobs![0].token).toBe("hello");
  });

  test("CompletionResponse logprobs is optional (undefined for Anthropic/Gemini)", () => {
    const res: CompletionResponse = {
      content: "hello",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
      model: "test",
    };
    expect(res.logprobs).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-provider && bun test tests/logprobs.test.ts`
Expected: FAIL — `logprobs` and `topLogprobs` are not recognized fields

- [ ] **Step 3: Add logprobs fields to CompletionRequest type**

In `packages/llm-provider/src/types.ts`, find `CompletionRequest` (line ~704) and add:

```typescript
  /** Request log probabilities for each output token (optional) */
  readonly logprobs?: boolean;
  /** Number of top alternative tokens to return per position (default: 5 when logprobs=true) */
  readonly topLogprobs?: number;
```

- [ ] **Step 4: Add TokenLogprob type and logprobs field to CompletionResponse**

In `packages/llm-provider/src/types.ts`, add a new type before `CompletionResponseSchema`:

```typescript
export type TokenLogprob = {
  readonly token: string;
  readonly logprob: number;
  readonly topLogprobs?: readonly { token: string; logprob: number }[];
};
```

Then add to `CompletionResponseSchema`:

```typescript
  /** Per-token log probabilities (when requested and supported by provider) */
  logprobs: Schema.optional(Schema.Array(Schema.Struct({
    token: Schema.String,
    logprob: Schema.Number,
    topLogprobs: Schema.optional(Schema.Array(Schema.Struct({
      token: Schema.String,
      logprob: Schema.Number,
    }))),
  }))),
```

**Note:** If `CompletionResponseSchema` is a `Schema.Struct`, add `logprobs` as an optional field. If `CompletionResponse` is a plain type, add the field directly. Check the exact structure and match the pattern.

- [ ] **Step 5: Export TokenLogprob from llm-provider index**

Add `TokenLogprob` to the type exports in `packages/llm-provider/src/index.ts`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/llm-provider && bun test tests/logprobs.test.ts`
Expected: PASS (3/3 tests)

- [ ] **Step 7: Wire logprobs in Ollama adapter**

In `packages/llm-provider/src/providers/local.ts`, find the request construction for `ollama.chat()`. Add:

```typescript
// In the request object passed to ollama SDK:
...(request.logprobs ? { options: { ...existingOptions, logprobs: true } } : {}),
```

In the response mapping, extract logprobs from Ollama's response format and map to `TokenLogprob[]`. Ollama returns logprobs in `message.logprobs` when requested. If the field is absent, leave `logprobs: undefined`.

- [ ] **Step 8: Wire logprobs in OpenAI adapter**

In `packages/llm-provider/src/providers/openai.ts`, find the request construction for `client.chat.completions.create()`. Add:

```typescript
...(request.logprobs ? { logprobs: true, top_logprobs: request.topLogprobs ?? 5 } : {}),
```

In the response mapping (`mapOpenAIResponse`), extract:

```typescript
const logprobs = response.choices[0]?.logprobs?.content?.map(lp => ({
  token: lp.token,
  logprob: lp.logprob,
  topLogprobs: lp.top_logprobs?.map(t => ({ token: t.token, logprob: t.logprob })),
}));
```

Add to the returned `CompletionResponse`: `logprobs: logprobs?.length ? logprobs : undefined`.

- [ ] **Step 9: Build and run all llm-provider tests**

Run: `cd packages/llm-provider && bun run build && bun test`
Expected: all tests pass

- [ ] **Step 10: Commit**

```bash
git add packages/llm-provider/
git commit -m "feat(llm-provider): add logprobs support to CompletionRequest/Response + Ollama/OpenAI adapters"
```

---

### Task 5: Upstream — KernelRunOptions + EntropyMeta in Reasoning

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-state.ts` — add fields to KernelRunOptions
- Modify: `packages/reasoning/src/strategies/shared/kernel-runner.ts` — store new meta at init
- Create: `packages/reasoning/tests/strategies/shared/entropy-meta.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/reasoning/tests/strategies/shared/entropy-meta.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { initialKernelState } from "../../../src/strategies/shared/kernel-state.js";

describe("KernelRunOptions entropy fields", () => {
  test("initialKernelState stores taskDescription, modelId, temperature in meta.entropy", () => {
    const state = initialKernelState({
      maxIterations: 10,
      strategy: "reactive",
      kernelType: "react",
      taskDescription: "Find the capital of France",
      modelId: "cogito:14b",
      temperature: 0.3,
    });
    const entropy = state.meta.entropy as { taskDescription?: string; modelId?: string; temperature?: number } | undefined;
    expect(entropy?.taskDescription).toBe("Find the capital of France");
    expect(entropy?.modelId).toBe("cogito:14b");
    expect(entropy?.temperature).toBe(0.3);
  });

  test("entropy meta defaults to undefined when fields omitted", () => {
    const state = initialKernelState({
      maxIterations: 10,
      strategy: "reactive",
      kernelType: "react",
    });
    expect(state.meta.entropy).toBeUndefined();
  });
});
```

**Note:** No import from `@reactive-agents/reactive-intelligence` — uses inline type to avoid circular dependency.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test tests/strategies/shared/entropy-meta.test.ts`
Expected: FAIL — `taskDescription` etc. not recognized in KernelRunOptions

- [ ] **Step 3: Add fields to KernelRunOptions**

In `packages/reasoning/src/strategies/shared/kernel-state.ts`, find `KernelRunOptions` interface and add:

```typescript
  readonly taskDescription?: string;
  readonly modelId?: string;
  readonly temperature?: number;
```

- [ ] **Step 4: Store in meta.entropy in initialKernelState**

In `initialKernelState()`, after the existing meta construction, add:

```typescript
const entropyMeta = (options.taskDescription || options.modelId || options.temperature !== undefined)
  ? {
      taskDescription: options.taskDescription,
      modelId: options.modelId,
      temperature: options.temperature,
    }
  : undefined;

// In the returned state object, update ONLY the entropy sub-object in meta.
// Do NOT change existing meta fields — keep the current pattern:
//   meta: { ...(opts.meta ?? {}), maxIterations: opts.maxIterations },
// And add entropy conditionally:
meta: {
  ...(options.meta ?? {}),
  maxIterations: options.maxIterations,
  ...(entropyMeta ? { entropy: entropyMeta } : {}),
},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/reasoning && bun test tests/strategies/shared/entropy-meta.test.ts`
Expected: PASS

- [ ] **Step 6: Build reasoning package**

Run: `cd packages/reasoning && bun run build`
Expected: builds without errors

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/shared/kernel-state.ts packages/reasoning/tests/strategies/shared/entropy-meta.test.ts
git commit -m "feat(reasoning): add taskDescription, modelId, temperature to KernelRunOptions + entropy meta"
```

---

## Chunk 2: Entropy Sources (1A–1D)

### Task 6: Token Entropy (1A)

**Files:**
- Create: `packages/reactive-intelligence/src/sensor/token-entropy.ts`
- Create: `packages/reactive-intelligence/tests/sensor/token-entropy.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { computeTokenEntropy } from "../../src/sensor/token-entropy.js";

describe("token entropy (1A)", () => {
  test("returns null when no logprobs provided", () => {
    const result = computeTokenEntropy(undefined);
    expect(result).toBeNull();
  });

  test("returns null when logprobs is empty", () => {
    const result = computeTokenEntropy([]);
    expect(result).toBeNull();
  });

  test("computes low entropy for confident tokens (single dominant logprob)", () => {
    // All tokens have one dominant probability → low entropy
    const logprobs = [
      { token: "Paris", logprob: -0.01, topLogprobs: [
        { token: "Paris", logprob: -0.01 },
        { token: "London", logprob: -5.0 },
        { token: "Berlin", logprob: -6.0 },
      ]},
      { token: "is", logprob: -0.02, topLogprobs: [
        { token: "is", logprob: -0.02 },
        { token: "was", logprob: -4.0 },
        { token: "has", logprob: -5.0 },
      ]},
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    expect(result!.sequenceEntropy).toBeLessThan(0.2);
    expect(result!.peakEntropy).toBeLessThan(0.2);
    expect(result!.tokenEntropies).toHaveLength(2);
  });

  test("computes high entropy for uncertain tokens (uniform distribution)", () => {
    // All tokens have nearly uniform distribution → high entropy
    const logprobs = [
      { token: "maybe", logprob: -1.1, topLogprobs: [
        { token: "maybe", logprob: -1.1 },
        { token: "perhaps", logprob: -1.2 },
        { token: "possibly", logprob: -1.3 },
      ]},
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    expect(result!.sequenceEntropy).toBeGreaterThan(0.8);
  });

  test("detects entropy spikes above threshold", () => {
    const logprobs = [
      // Low entropy token
      { token: "The", logprob: -0.01, topLogprobs: [
        { token: "The", logprob: -0.01 },
        { token: "A", logprob: -5.0 },
      ]},
      // High entropy token (spike)
      { token: "answer", logprob: -1.0, topLogprobs: [
        { token: "answer", logprob: -1.0 },
        { token: "result", logprob: -1.1 },
        { token: "solution", logprob: -1.2 },
      ]},
      // Low entropy token
      { token: "is", logprob: -0.02, topLogprobs: [
        { token: "is", logprob: -0.02 },
        { token: "was", logprob: -4.0 },
      ]},
    ];
    const result = computeTokenEntropy(logprobs, 0.7);
    expect(result).not.toBeNull();
    expect(result!.entropySpikes.length).toBeGreaterThanOrEqual(1);
    expect(result!.entropySpikes[0].position).toBe(1); // second token
  });

  test("sequenceEntropy is length-normalized mean of per-token entropies", () => {
    const logprobs = [
      { token: "a", logprob: -0.5, topLogprobs: [
        { token: "a", logprob: -0.5 },
        { token: "b", logprob: -1.0 },
      ]},
      { token: "c", logprob: -0.1, topLogprobs: [
        { token: "c", logprob: -0.1 },
        { token: "d", logprob: -3.0 },
      ]},
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    const expectedMean = (result!.tokenEntropies[0] + result!.tokenEntropies[1]) / 2;
    expect(result!.sequenceEntropy).toBeCloseTo(expectedMean, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/token-entropy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement token-entropy.ts**

```typescript
import type { TokenLogprob, TokenEntropy } from "../types.js";

/**
 * Compute per-token normalized Shannon entropy from logprob distributions.
 * TECP-inspired: H_norm(t_i) = H(t_i) / log2(k) ∈ [0, 1]
 *
 * Returns null if logprobs are unavailable.
 */
export function computeTokenEntropy(
  logprobs: readonly TokenLogprob[] | undefined,
  spikeThreshold = 0.7,
): TokenEntropy | null {
  if (!logprobs || logprobs.length === 0) return null;

  const tokenEntropies: number[] = [];

  for (const lp of logprobs) {
    const tops = lp.topLogprobs;
    if (!tops || tops.length === 0) {
      // No distribution → assume zero entropy (greedy pick)
      tokenEntropies.push(0);
      continue;
    }

    // Convert logprobs to probabilities
    const probs = tops.map((t) => Math.exp(t.logprob));
    const sum = probs.reduce((a, b) => a + b, 0);

    // Normalize
    const normalized = probs.map((p) => p / sum);

    // Shannon entropy: H = -Σ p_i × log2(p_i)
    let h = 0;
    for (const p of normalized) {
      if (p > 0) h -= p * Math.log2(p);
    }

    // Normalize by max entropy: log2(k)
    const maxEntropy = Math.log2(tops.length);
    const hNorm = maxEntropy > 0 ? h / maxEntropy : 0;

    tokenEntropies.push(Math.max(0, Math.min(1, hNorm)));
  }

  const sequenceEntropy =
    tokenEntropies.length > 0
      ? tokenEntropies.reduce((a, b) => a + b, 0) / tokenEntropies.length
      : 0;

  const peakEntropy = Math.max(0, ...tokenEntropies);

  const entropySpikes = tokenEntropies
    .map((value, position) => ({ position, value }))
    .filter((s) => s.value > spikeThreshold);

  // toolCallEntropy: mean entropy over JSON-like regions (heuristic: tokens containing {, }, [, ])
  // For now, use sequenceEntropy as fallback — refined in integration
  const toolCallEntropy = sequenceEntropy;

  return {
    tokenEntropies,
    sequenceEntropy,
    toolCallEntropy,
    peakEntropy,
    entropySpikes,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/token-entropy.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/sensor/token-entropy.ts packages/reactive-intelligence/tests/sensor/token-entropy.test.ts
git commit -m "feat(reactive-intelligence): implement token entropy scorer (1A)"
```

---

### Task 7: Structural Entropy (1B)

**Files:**
- Create: `packages/reactive-intelligence/src/sensor/structural-entropy.ts`
- Create: `packages/reactive-intelligence/tests/sensor/structural-entropy.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { computeStructuralEntropy } from "../../src/sensor/structural-entropy.js";

describe("structural entropy (1B)", () => {
  test("well-formed ReAct thought scores high", () => {
    const thought = "Thought: I need to search for the capital of France.\nAction: web-search({\"query\": \"capital of France\"})";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.formatCompliance).toBeGreaterThan(0.7);
    expect(result.orderIntegrity).toBe(1.0);
    expect(result.jsonParseScore).toBe(1.0);
  });

  test("hedging phrases reduce hedgeScore", () => {
    const thought = "I think maybe the answer is possibly Paris, but I'm not sure";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.hedgeScore).toBeLessThan(0.8);
  });

  test("no hedging gives hedgeScore 1.0", () => {
    const thought = "The capital of France is Paris. This is a well-established fact.";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.hedgeScore).toBe(1.0);
  });

  test("repetitive text has low thoughtDensity", () => {
    const thought = "search search search search search search search search search search";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.thoughtDensity).toBeLessThan(0.3);
  });

  test("diverse vocabulary gives high vocabularyDiversity", () => {
    const thought = "The capital city of France is Paris, located along the Seine river in northern Europe";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.vocabularyDiversity).toBeGreaterThan(0.7);
  });

  test("malformed JSON gets partial jsonParseScore", () => {
    const thought = 'Action: web-search({"query": "test"';  // missing closing brace
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.jsonParseScore).toBe(0.5);
  });

  test("no JSON gives jsonParseScore 1.0 (not a tool call)", () => {
    const thought = "Thought: I should analyze the data more carefully.";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.jsonParseScore).toBe(1.0);
  });

  test("wrong order (Action before Thought) reduces orderIntegrity", () => {
    const thought = "Action: web-search({\"query\": \"test\"})\nThought: I should search first";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.orderIntegrity).toBeLessThan(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/structural-entropy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement structural-entropy.ts**

```typescript
import type { StructuralEntropy } from "../types.js";

const HEDGE_PHRASES = [
  "might", "could", "perhaps", "possibly", "maybe",
  "i think", "i believe", "it seems", "probably", "likely",
  "not sure", "uncertain", "approximately", "roughly",
];

/**
 * Compute structural entropy from a reasoning step's text.
 * Always available, sync, <1ms. LM-Polygraph validates heuristics
 * as effective for short structured outputs.
 */
export function computeStructuralEntropy(
  thought: string,
  strategy: string,
): StructuralEntropy {
  const lower = thought.toLowerCase();

  // ── Format compliance: does output match expected structure? ──
  let formatCompliance = 0.5; // neutral default
  if (strategy === "reactive" || strategy === "react") {
    const hasThought = /thought:/i.test(thought);
    const hasAction = /action:/i.test(thought);
    const hasFinalAnswer = /final answer/i.test(thought);
    if (hasThought && (hasAction || hasFinalAnswer)) formatCompliance = 1.0;
    else if (hasThought || hasAction) formatCompliance = 0.7;
    else formatCompliance = 0.3;
  } else if (strategy === "plan-execute") {
    const hasStep = /step\s*\d/i.test(thought);
    formatCompliance = hasStep ? 0.9 : 0.4;
  } else {
    formatCompliance = 0.6; // unknown strategy, neutral
  }

  // ── Order integrity: structural elements in correct sequence? ──
  let orderIntegrity = 1.0;
  if (strategy === "reactive" || strategy === "react") {
    const thoughtIdx = thought.search(/thought:/i);
    const actionIdx = thought.search(/action:/i);
    if (thoughtIdx >= 0 && actionIdx >= 0 && actionIdx < thoughtIdx) {
      orderIntegrity = 0.3; // Action before Thought = bad
    }
  }

  // ── Thought density: unique meaningful words / total words ──
  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  const unique = new Set(words);
  const thoughtDensity = words.length > 0 ? unique.size / words.length : 0;

  // ── Vocabulary diversity: type-token ratio ──
  const allWords = lower.split(/\s+/).filter((w) => w.length > 0);
  const allUnique = new Set(allWords);
  const vocabularyDiversity =
    allWords.length > 0 ? allUnique.size / allWords.length : 0;

  // ── Hedge score: 1.0 = no hedging, lower = more hedging ──
  const hedgeCount = HEDGE_PHRASES.filter((h) => lower.includes(h)).length;
  const hedgeScore = 1 - Math.min(0.3, hedgeCount * 0.1);

  // ── JSON parse score: for tool calls ──
  let jsonParseScore = 1.0; // default: no JSON expected
  const jsonMatch = thought.match(/\{[\s\S]*$/);
  if (jsonMatch) {
    try {
      // Find the largest balanced JSON substring
      const jsonStr = extractJson(thought);
      if (jsonStr) {
        JSON.parse(jsonStr);
        jsonParseScore = 1.0;
      } else {
        jsonParseScore = 0.5; // has { but can't extract balanced JSON
      }
    } catch {
      jsonParseScore = 0.5; // fixable parse error
    }
  }

  return {
    formatCompliance,
    orderIntegrity,
    thoughtDensity,
    vocabularyDiversity,
    hedgeScore,
    jsonParseScore,
  };
}

/** Extract the first balanced JSON object from text, or null. */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null; // unbalanced
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/structural-entropy.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/sensor/structural-entropy.ts packages/reactive-intelligence/tests/sensor/structural-entropy.test.ts
git commit -m "feat(reactive-intelligence): implement structural entropy scorer (1B)"
```

---

### Task 8: Semantic Entropy (1C)

**Files:**
- Create: `packages/reactive-intelligence/src/sensor/semantic-entropy.ts`
- Create: `packages/reactive-intelligence/src/sensor/math-utils.ts` (cosine similarity — vendored)
- Create: `packages/reactive-intelligence/tests/sensor/semantic-entropy.test.ts`

- [ ] **Step 1: Write math-utils.ts (vendored cosine similarity)**

```typescript
/** Cosine similarity between two vectors. Returns 0 for empty/mismatched vectors. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
```

- [ ] **Step 2: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { computeSemanticEntropy } from "../../src/sensor/semantic-entropy.js";

describe("semantic entropy (1C)", () => {
  test("returns unavailable when no embeddings", () => {
    const result = computeSemanticEntropy({
      currentEmbedding: null,
      taskEmbedding: null,
      priorEmbeddings: [],
      centroid: null,
    });
    expect(result.available).toBe(false);
    expect(result.taskAlignment).toBe(0);
    expect(result.noveltyScore).toBe(0);
    expect(result.adjacentRepetition).toBe(0);
  });

  test("high task alignment when current embedding close to task", () => {
    const current = [1, 0, 0];
    const task = [0.9, 0.1, 0];
    const result = computeSemanticEntropy({
      currentEmbedding: current,
      taskEmbedding: task,
      priorEmbeddings: [],
      centroid: null,
    });
    expect(result.available).toBe(true);
    expect(result.taskAlignment).toBeGreaterThan(0.9);
  });

  test("low novelty when current is similar to centroid (repetition)", () => {
    const current = [1, 0, 0];
    const centroid = [0.99, 0.01, 0];
    const result = computeSemanticEntropy({
      currentEmbedding: current,
      taskEmbedding: [1, 0, 0],
      priorEmbeddings: [[1, 0, 0]],
      centroid,
    });
    expect(result.noveltyScore).toBeLessThan(0.1); // very similar to centroid
  });

  test("high novelty when current diverges from centroid", () => {
    const current = [0, 1, 0]; // orthogonal
    const centroid = [1, 0, 0];
    const result = computeSemanticEntropy({
      currentEmbedding: current,
      taskEmbedding: [0.5, 0.5, 0],
      priorEmbeddings: [[1, 0, 0]],
      centroid,
    });
    expect(result.noveltyScore).toBeGreaterThan(0.8);
  });

  test("high adjacent repetition when last two thoughts are near-identical", () => {
    const current = [1, 0, 0];
    const prior = [0.99, 0.01, 0];
    const result = computeSemanticEntropy({
      currentEmbedding: current,
      taskEmbedding: [1, 0, 0],
      priorEmbeddings: [prior],
      centroid: prior,
    });
    expect(result.adjacentRepetition).toBeGreaterThan(0.95);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/semantic-entropy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement semantic-entropy.ts**

```typescript
import type { SemanticEntropy } from "../types.js";
import { cosineSimilarity } from "./math-utils.js";

export type SemanticEntropyInput = {
  currentEmbedding: readonly number[] | null;
  taskEmbedding: readonly number[] | null;
  priorEmbeddings: readonly (readonly number[])[];
  centroid: readonly number[] | null;
};

/**
 * Compute semantic entropy using SelfCheckGPT consistency principle.
 * Compares current thought embedding against task and centroid of priors.
 * Returns { available: false } when embeddings are unavailable.
 */
export function computeSemanticEntropy(input: SemanticEntropyInput): SemanticEntropy {
  const { currentEmbedding, taskEmbedding, priorEmbeddings, centroid } = input;

  if (!currentEmbedding) {
    return { taskAlignment: 0, noveltyScore: 0, adjacentRepetition: 0, available: false };
  }

  // Task alignment: cosine sim to task description
  const taskAlignment = taskEmbedding
    ? cosineSimilarity(currentEmbedding, taskEmbedding)
    : 0;

  // Novelty: 1 - cosine sim to centroid of all prior thoughts
  const noveltyScore = centroid
    ? 1 - cosineSimilarity(currentEmbedding, centroid)
    : 1; // first iteration = fully novel

  // Adjacent repetition: cosine sim to immediately prior thought
  const lastPrior = priorEmbeddings.length > 0
    ? priorEmbeddings[priorEmbeddings.length - 1]
    : null;
  const adjacentRepetition = lastPrior
    ? cosineSimilarity(currentEmbedding, lastPrior)
    : 0;

  return {
    taskAlignment,
    noveltyScore,
    adjacentRepetition,
    available: true,
  };
}

/** Incrementally update centroid with a new embedding. */
export function updateCentroid(
  oldCentroid: readonly number[] | null,
  newEmbedding: readonly number[],
  count: number,
): number[] {
  if (!oldCentroid || count === 0) return [...newEmbedding];
  return oldCentroid.map((v, i) => (v * count + newEmbedding[i]!) / (count + 1));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/semantic-entropy.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/reactive-intelligence/src/sensor/math-utils.ts packages/reactive-intelligence/src/sensor/semantic-entropy.ts packages/reactive-intelligence/tests/sensor/semantic-entropy.test.ts
git commit -m "feat(reactive-intelligence): implement semantic entropy scorer (1C) with vendored cosine similarity"
```

---

### Task 9: Behavioral Entropy (1D)

**Files:**
- Create: `packages/reactive-intelligence/src/sensor/behavioral-entropy.ts`
- Create: `packages/reactive-intelligence/tests/sensor/behavioral-entropy.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { computeBehavioralEntropy } from "../../src/sensor/behavioral-entropy.js";

describe("behavioral entropy (1D)", () => {
  test("perfect tool success rate", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", metadata: { toolUsed: "web-search", success: true } },
        { type: "observation", metadata: { success: true } },
        { type: "action", metadata: { toolUsed: "file-read", success: true } },
        { type: "observation", metadata: { success: true } },
      ],
      iteration: 2,
    });
    expect(result.toolSuccessRate).toBe(1.0);
  });

  test("action diversity detects stuck patterns", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", metadata: { toolUsed: "web-search" } },
        { type: "action", metadata: { toolUsed: "web-search" } },
        { type: "action", metadata: { toolUsed: "web-search" } },
      ],
      iteration: 3,
    });
    expect(result.actionDiversity).toBeCloseTo(1 / 3, 1); // 1 unique / 3 iterations
  });

  test("action diversity clamped to 1.0", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", metadata: { toolUsed: "a" } },
        { type: "action", metadata: { toolUsed: "b" } },
        { type: "action", metadata: { toolUsed: "c" } },
      ],
      iteration: 2, // 3 unique tools in 2 iterations
    });
    expect(result.actionDiversity).toBe(1.0);
  });

  test("loop detection from repeated identical actions", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", content: "web-search({\"q\":\"test\"})", metadata: { toolUsed: "web-search" } },
        { type: "action", content: "web-search({\"q\":\"test\"})", metadata: { toolUsed: "web-search" } },
        { type: "action", content: "web-search({\"q\":\"test\"})", metadata: { toolUsed: "web-search" } },
      ],
      iteration: 3,
    });
    expect(result.loopDetectionScore).toBeGreaterThan(0.5);
  });

  test("completion approach detects final answer markers", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "thought", content: "Therefore, the answer is Paris." },
      ],
      iteration: 5,
      maxIterations: 10,
    });
    expect(result.completionApproach).toBeGreaterThan(0.3);
  });

  test("empty steps returns baseline values", () => {
    const result = computeBehavioralEntropy({ steps: [], iteration: 1 });
    expect(result.toolSuccessRate).toBe(1.0); // no failures
    expect(result.actionDiversity).toBe(0);
    expect(result.loopDetectionScore).toBe(0);
    expect(result.completionApproach).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/behavioral-entropy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement behavioral-entropy.ts**

```typescript
import type { BehavioralEntropy } from "../types.js";

type StepLike = {
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

const COMPLETION_MARKERS = [
  "therefore", "the answer is", "in conclusion", "final answer",
  "to summarize", "in summary",
];

export function computeBehavioralEntropy(params: {
  steps: readonly StepLike[];
  iteration: number;
  maxIterations?: number;
}): BehavioralEntropy {
  const { steps, iteration, maxIterations = 10 } = params;
  const actionSteps = steps.filter((s) => s.type === "action");

  // ── Tool success rate ──
  let successes = 0;
  let totalToolCalls = 0;
  for (const step of steps) {
    if (step.type === "action" || step.type === "observation") {
      if (step.metadata?.success !== undefined) {
        totalToolCalls++;
        if (step.metadata.success) successes++;
      }
    }
  }
  const toolSuccessRate = totalToolCalls > 0 ? successes / totalToolCalls : 1.0;

  // ── Action diversity: min(1, unique_tools / iteration) ──
  const toolNames = new Set(
    actionSteps
      .map((s) => (s.metadata?.toolUsed as string) ?? "unknown")
  );
  const actionDiversity = iteration > 0
    ? Math.min(1, toolNames.size / iteration)
    : 0;

  // ── Loop detection: identical consecutive actions ──
  let loopDetectionScore = 0;
  if (actionSteps.length >= 3) {
    const lastN = actionSteps.slice(-3);
    const contents = lastN.map((s) => s.content ?? "");
    const allSame = contents.every((c) => c === contents[0]);
    if (allSame && contents[0] !== "") loopDetectionScore = 1.0;
    else {
      // Partial: check if last 2 are same
      const last2 = actionSteps.slice(-2);
      const c2 = last2.map((s) => s.content ?? "");
      if (c2[0] === c2[1] && c2[0] !== "") loopDetectionScore = 0.5;
    }
  }

  // ── Completion approach: presence of completion markers ──
  let completionApproach = 0;
  const recentThoughts = steps
    .filter((s) => s.type === "thought")
    .slice(-2);
  for (const thought of recentThoughts) {
    const lower = (thought.content ?? "").toLowerCase();
    const markerCount = COMPLETION_MARKERS.filter((m) => lower.includes(m)).length;
    if (markerCount > 0) {
      // Weight by iteration position — later iterations should show completion
      const positionWeight = iteration / maxIterations;
      completionApproach = Math.min(1, markerCount * 0.3 * (0.5 + positionWeight));
    }
  }
  // Also check for final-answer tool usage
  const hasFinalAnswerTool = actionSteps.some(
    (s) => (s.metadata?.toolUsed as string) === "final-answer",
  );
  if (hasFinalAnswerTool) completionApproach = 1.0;

  return {
    toolSuccessRate,
    actionDiversity,
    loopDetectionScore,
    completionApproach,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/behavioral-entropy.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/sensor/behavioral-entropy.ts packages/reactive-intelligence/tests/sensor/behavioral-entropy.test.ts
git commit -m "feat(reactive-intelligence): implement behavioral entropy scorer (1D)"
```

---

## Chunk 3: Entropy Sources (1E–1F) + Composite + Calibration

### Task 10: Context Pressure (1E)

**Files:**
- Create: `packages/reactive-intelligence/src/sensor/context-pressure.ts`
- Create: `packages/reactive-intelligence/tests/sensor/context-pressure.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { computeContextPressure } from "../../src/sensor/context-pressure.js";

describe("context pressure (1E)", () => {
  test("low utilization returns low pressure", () => {
    const result = computeContextPressure({
      systemPrompt: "You are a helpful assistant.",
      toolResults: ["Result: Paris"],
      history: ["User: What is the capital?"],
      taskDescription: "Find capitals",
      contextLimit: 32_768,
    });
    expect(result.utilizationPct).toBeLessThan(0.1);
    expect(result.atRiskSections).toHaveLength(0);
  });

  test("high utilization detects at-risk sections", () => {
    const longHistory = Array(500).fill("User: This is a very long conversation turn that takes up context space.").join("\n");
    const result = computeContextPressure({
      systemPrompt: "System prompt",
      toolResults: [],
      history: [longHistory],
      taskDescription: "Test",
      contextLimit: 1000, // very small window
    });
    expect(result.utilizationPct).toBeGreaterThan(0.8);
    expect(result.atRiskSections.length).toBeGreaterThan(0);
  });

  test("task section always has signalDensity 1.0", () => {
    const result = computeContextPressure({
      systemPrompt: "",
      toolResults: [],
      history: [],
      taskDescription: "Important task",
      contextLimit: 32_768,
    });
    const taskSection = result.sections.find((s) => s.label === "task");
    expect(taskSection?.signalDensity).toBe(1.0);
  });

  test("older tool results have lower signal density", () => {
    const result = computeContextPressure({
      systemPrompt: "",
      toolResults: ["recent result", "old result 1", "old result 2", "old result 3"],
      history: [],
      taskDescription: "Test",
      contextLimit: 32_768,
    });
    const toolSection = result.sections.find((s) => s.label === "tool-results");
    expect(toolSection).toBeDefined();
    expect(toolSection!.signalDensity).toBeLessThan(1.0); // decayed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/context-pressure.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement context-pressure.ts**

```typescript
import type { ContextPressure, ContextSection } from "../types.js";

/** Estimate token count from text. Matches @reactive-agents/core: ceil(length / 4). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function computeContextPressure(params: {
  systemPrompt: string;
  toolResults: readonly string[];
  history: readonly string[];
  taskDescription: string;
  contextLimit: number;
  skillInstructions?: string;
}): ContextPressure {
  const { systemPrompt, toolResults, history, taskDescription, contextLimit, skillInstructions } = params;

  const sections: ContextSection[] = [];

  // Task — always highest signal
  const taskTokens = estimateTokens(taskDescription);
  sections.push({ label: "task", tokenEstimate: taskTokens, signalDensity: 1.0, position: "near" });

  // System prompt
  if (systemPrompt) {
    const spTokens = estimateTokens(systemPrompt);
    sections.push({ label: "system-prompt", tokenEstimate: spTokens, signalDensity: 0.7, position: "near" });
  }

  // Skill instructions
  if (skillInstructions) {
    const skillTokens = estimateTokens(skillInstructions);
    sections.push({ label: "skill", tokenEstimate: skillTokens, signalDensity: 0.8, position: "near" });
  }

  // Tool results — signal density decays with age
  if (toolResults.length > 0) {
    const totalToolTokens = toolResults.reduce((sum, r) => sum + estimateTokens(r), 0);
    // Decay: most recent = 1.0, older decays linearly
    const avgAge = toolResults.length > 1 ? 0.5 : 0; // rough midpoint
    const signalDensity = Math.max(0.3, 1.0 - avgAge * 0.4);
    sections.push({
      label: "tool-results",
      tokenEstimate: totalToolTokens,
      signalDensity,
      position: toolResults.length > 3 ? "mid" : "near",
    });
  }

  // History — signal density decays with iteration distance
  if (history.length > 0) {
    const totalHistoryTokens = history.reduce((sum, h) => sum + estimateTokens(h), 0);
    const signalDensity = Math.max(0.2, 1.0 - (history.length * 0.1));
    sections.push({
      label: "history",
      tokenEstimate: totalHistoryTokens,
      signalDensity,
      position: history.length > 5 ? "far" : "mid",
    });
  }

  const totalTokens = sections.reduce((sum, s) => sum + s.tokenEstimate, 0);
  const utilizationPct = contextLimit > 0 ? totalTokens / contextLimit : 0;

  // At-risk sections: those near truncation boundary (>80% utilization)
  const atRiskSections: string[] = [];
  if (utilizationPct > 0.8) {
    // Sections with lowest signal density are most at risk
    const sorted = [...sections].sort((a, b) => a.signalDensity - b.signalDensity);
    for (const s of sorted) {
      if (s.signalDensity < 0.8) atRiskSections.push(s.label);
    }
  }

  // Compression headroom: sum of tokens from low-signal sections
  const compressionHeadroom = sections
    .filter((s) => s.signalDensity < 0.7)
    .reduce((sum, s) => sum + Math.floor(s.tokenEstimate * (1 - s.signalDensity)), 0);

  return {
    utilizationPct: Math.min(1, utilizationPct),
    sections,
    atRiskSections,
    compressionHeadroom,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/context-pressure.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/sensor/context-pressure.ts packages/reactive-intelligence/tests/sensor/context-pressure.test.ts
git commit -m "feat(reactive-intelligence): implement context pressure scorer (1E)"
```

---

### Task 11: Entropy Trajectory (1F)

**Files:**
- Create: `packages/reactive-intelligence/src/sensor/entropy-trajectory.ts`
- Create: `packages/reactive-intelligence/tests/sensor/entropy-trajectory.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { computeEntropyTrajectory, classifyTrajectoryShape, iterationWeight } from "../../src/sensor/entropy-trajectory.js";

describe("entropy trajectory (1F)", () => {
  test("returns flat trajectory for single data point", () => {
    const result = computeEntropyTrajectory([0.5], 10);
    expect(result.shape).toBe("flat");
    expect(result.derivative).toBe(0);
    expect(result.history).toEqual([0.5]);
  });

  test("detects converging trajectory (falling entropy)", () => {
    const result = computeEntropyTrajectory([0.8, 0.6, 0.4, 0.2], 10);
    expect(result.shape).toBe("converging");
    expect(result.derivative).toBeLessThan(0);
  });

  test("detects diverging trajectory (rising entropy)", () => {
    const result = computeEntropyTrajectory([0.2, 0.4, 0.6, 0.8], 10);
    expect(result.shape).toBe("diverging");
    expect(result.derivative).toBeGreaterThan(0);
  });

  test("detects flat trajectory (constant entropy)", () => {
    const result = computeEntropyTrajectory([0.5, 0.51, 0.49, 0.5], 10);
    expect(result.shape).toBe("flat");
  });

  test("detects v-recovery (drops then rises)", () => {
    const result = computeEntropyTrajectory([0.7, 0.3, 0.2, 0.5, 0.7], 10);
    expect(result.shape).toBe("v-recovery");
  });

  test("detects oscillating trajectory", () => {
    const result = computeEntropyTrajectory([0.8, 0.2, 0.8, 0.2, 0.8, 0.2], 10);
    expect(result.shape).toBe("oscillating");
  });

  test("iteration weight is low early, high late", () => {
    const early = iterationWeight(1, 10);
    const late = iterationWeight(9, 10);
    expect(early).toBeLessThan(0.3);
    expect(late).toBeGreaterThan(0.7);
  });

  test("iteration weight at midpoint is ~0.5", () => {
    const mid = iterationWeight(5, 10);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/entropy-trajectory.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement entropy-trajectory.ts**

```typescript
import type { EntropyTrajectory, EntropyTrajectoryShape } from "../types.js";

/** Sigmoid function: 1 / (1 + exp(-x)) */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Iteration-position-aware weighting.
 * Low weight early (exploration is normal), high weight late (should be converging).
 */
export function iterationWeight(i: number, maxIter: number): number {
  if (maxIter <= 0) return 0.5;
  return sigmoid((i - maxIter / 2) * (4 / maxIter));
}

/**
 * Classify trajectory shape from an entropy history.
 */
export function classifyTrajectoryShape(history: readonly number[]): EntropyTrajectoryShape {
  if (history.length < 3) return "flat";

  const n = history.length;
  const diffs: number[] = [];
  for (let i = 1; i < n; i++) {
    diffs.push(history[i]! - history[i - 1]!);
  }

  // Check oscillating: alternating sign changes
  let signChanges = 0;
  for (let i = 1; i < diffs.length; i++) {
    if (diffs[i]! * diffs[i - 1]! < 0) signChanges++;
  }
  if (signChanges >= Math.floor(diffs.length * 0.6) && diffs.length >= 3) {
    return "oscillating";
  }

  // Check v-recovery: drops significantly then rises
  const minIdx = history.indexOf(Math.min(...history));
  if (minIdx > 0 && minIdx < n - 1) {
    const dropBefore = history[0]! - history[minIdx]!;
    const riseAfter = history[n - 1]! - history[minIdx]!;
    if (dropBefore > 0.15 && riseAfter > 0.15) {
      return "v-recovery";
    }
  }

  // Recent slope (last 3 points)
  const recent = history.slice(-3);
  const recentSlope = (recent[recent.length - 1]! - recent[0]!) / (recent.length - 1);

  if (recentSlope < -0.05) return "converging";
  if (recentSlope > 0.05) return "diverging";
  return "flat";
}

/**
 * Compute entropy trajectory from accumulated composite scores.
 */
export function computeEntropyTrajectory(
  history: readonly number[],
  maxIterations: number,
): EntropyTrajectory {
  if (history.length === 0) {
    return { history: [], derivative: 0, momentum: 0, shape: "flat" };
  }

  if (history.length === 1) {
    return { history: [...history], derivative: 0, momentum: history[0]!, shape: "flat" };
  }

  // Derivative: slope of last 3 iterations (or fewer if <3 available)
  const windowSize = Math.min(3, history.length);
  const recentWindow = history.slice(-windowSize);
  const derivative = (recentWindow[recentWindow.length - 1]! - recentWindow[0]!) / (windowSize - 1);

  // Momentum: exponentially weighted moving average (α = 0.3)
  const alpha = 0.3;
  let momentum = history[0]!;
  for (let i = 1; i < history.length; i++) {
    momentum = alpha * history[i]! + (1 - alpha) * momentum;
  }

  const shape = classifyTrajectoryShape(history);

  return {
    history: [...history],
    derivative,
    momentum,
    shape,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/entropy-trajectory.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/sensor/entropy-trajectory.ts packages/reactive-intelligence/tests/sensor/entropy-trajectory.test.ts
git commit -m "feat(reactive-intelligence): implement entropy trajectory classifier (1F)"
```

---

### Task 12: Composite Scorer

**Files:**
- Create: `packages/reactive-intelligence/src/sensor/composite.ts`
- Create: `packages/reactive-intelligence/tests/sensor/composite.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { computeCompositeEntropy } from "../../src/sensor/composite.js";

describe("composite entropy scorer", () => {
  test("combines all sources with correct weights (logprobs available)", () => {
    const result = computeCompositeEntropy({
      token: 0.3,
      structural: 0.2,
      semantic: 0.4,
      behavioral: 0.5,
      contextPressure: 0.1,
      logprobsAvailable: true,
      iteration: 5,
      maxIterations: 10,
    });
    expect(result.composite).toBeGreaterThan(0);
    expect(result.composite).toBeLessThan(1);
    expect(result.sources.token).toBe(0.3);
    expect(result.confidence).toBe("high"); // all 4 core sources present
  });

  test("adjusts weights when logprobs unavailable", () => {
    const result = computeCompositeEntropy({
      token: null,
      structural: 0.2,
      semantic: 0.4,
      behavioral: 0.5,
      contextPressure: 0.1,
      logprobsAvailable: false,
      iteration: 5,
      maxIterations: 10,
    });
    expect(result.sources.token).toBeNull();
    // Weights redistribute: structural 0.40, semantic 0.25, behavioral 0.25, context 0.10
  });

  test("confidence is medium with 2-3 sources", () => {
    const result = computeCompositeEntropy({
      token: null,
      structural: 0.3,
      semantic: null,
      behavioral: 0.5,
      contextPressure: 0.1,
      logprobsAvailable: false,
      iteration: 3,
      maxIterations: 10,
    });
    expect(result.confidence).toBe("low"); // only structural + behavioral
  });

  test("iteration weight affects final composite", () => {
    const early = computeCompositeEntropy({
      token: null, structural: 0.8, semantic: null, behavioral: 0.8,
      contextPressure: 0.1, logprobsAvailable: false,
      iteration: 1, maxIterations: 10,
    });
    const late = computeCompositeEntropy({
      token: null, structural: 0.8, semantic: null, behavioral: 0.8,
      contextPressure: 0.1, logprobsAvailable: false,
      iteration: 9, maxIterations: 10,
    });
    // Same raw scores but late iteration has higher weight → higher effective composite
    expect(late.iterationWeight).toBeGreaterThan(early.iterationWeight);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/composite.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement composite.ts**

```typescript
import type { EntropyScore, EntropyTrajectory } from "../types.js";
import { iterationWeight } from "./entropy-trajectory.js";

// Default weights — replaced by conformal calibration after MIN_CALIBRATION_RUNS
const WEIGHTS_WITH_LOGPROBS = {
  token: 0.30,
  structural: 0.25,
  semantic: 0.15,
  behavioral: 0.20,
  contextPressure: 0.10,
};

const WEIGHTS_WITHOUT_LOGPROBS = {
  token: 0,
  structural: 0.40,
  semantic: 0.25,
  behavioral: 0.25,
  contextPressure: 0.10,
};

type CompositeInput = {
  token: number | null;
  structural: number;
  semantic: number | null;
  behavioral: number;
  contextPressure: number;
  logprobsAvailable: boolean;
  iteration: number;
  maxIterations: number;
  trajectory?: EntropyTrajectory;
  modelTier?: "frontier" | "local" | "unknown";
  temperature?: number;
};

export function computeCompositeEntropy(input: CompositeInput): EntropyScore {
  const {
    token, structural, semantic, behavioral, contextPressure,
    logprobsAvailable, iteration, maxIterations,
    trajectory, modelTier = "unknown", temperature,
  } = input;

  const weights = logprobsAvailable ? { ...WEIGHTS_WITH_LOGPROBS } : { ...WEIGHTS_WITHOUT_LOGPROBS };

  // Temperature 0 discount for token entropy
  if (logprobsAvailable && temperature === 0) {
    weights.token = 0.15;
    // Redistribute to structural
    weights.structural += 0.15;
  }

  // If semantic unavailable, redistribute its weight
  if (semantic === null) {
    const redistribution = weights.semantic;
    weights.semantic = 0;
    weights.structural += redistribution * 0.5;
    weights.behavioral += redistribution * 0.5;
  }

  // Compute weighted sum
  const composite =
    (token ?? 0) * weights.token +
    structural * weights.structural +
    (semantic ?? 0) * weights.semantic +
    behavioral * weights.behavioral +
    contextPressure * weights.contextPressure;

  // Determine confidence tier
  const sourcesPresent =
    (token !== null ? 1 : 0) +
    1 + // structural always present
    (semantic !== null ? 1 : 0) +
    1; // behavioral always present

  const confidence: "high" | "medium" | "low" =
    sourcesPresent >= 4 ? "high" :
    sourcesPresent >= 3 ? "medium" : "low";

  const iWeight = iterationWeight(iteration, maxIterations);

  const defaultTrajectory: EntropyTrajectory = {
    history: [], derivative: 0, momentum: composite, shape: "flat",
  };

  return {
    composite: Math.max(0, Math.min(1, composite)),
    sources: {
      token: token,
      structural,
      semantic: semantic,
      behavioral,
      contextPressure,
    },
    trajectory: trajectory ?? defaultTrajectory,
    confidence,
    modelTier,
    iteration,
    iterationWeight: iWeight,
    timestamp: Date.now(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/composite.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/sensor/composite.ts packages/reactive-intelligence/tests/sensor/composite.test.ts
git commit -m "feat(reactive-intelligence): implement composite entropy scorer with adaptive weights"
```

---

### Task 13: Model Registry

**Files:**
- Create: `packages/reactive-intelligence/src/calibration/model-registry.ts`
- Create: `packages/reactive-intelligence/tests/calibration/model-registry.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { lookupModel } from "../../src/calibration/model-registry.js";

describe("model registry", () => {
  test("exact match for Ollama models", () => {
    const entry = lookupModel("cogito:14b");
    expect(entry.tier).toBe("local");
    expect(entry.logprobSupport).toBe(true);
    expect(entry.contextLimit).toBe(32_768);
  });

  test("prefix match for versioned Anthropic models", () => {
    const entry = lookupModel("claude-sonnet-4-20250514");
    expect(entry.tier).toBe("frontier");
    expect(entry.logprobSupport).toBe(false);
  });

  test("unknown model returns safe defaults", () => {
    const entry = lookupModel("totally-unknown-model-xyz");
    expect(entry.tier).toBe("unknown");
    expect(entry.logprobSupport).toBe(false);
    expect(entry.contextLimit).toBe(32_768);
  });

  test("custom models can be added via override", () => {
    const entry = lookupModel("my-custom-model", {
      "my-custom-model": { contextLimit: 8192, tier: "local", logprobSupport: true },
    });
    expect(entry.tier).toBe("local");
    expect(entry.contextLimit).toBe(8192);
  });
});
```

- [ ] **Step 2: Run test, then implement, then pass**

Implementation: A `MODEL_REGISTRY` constant with known models, `lookupModel(id, overrides?)` function that checks exact match → prefix match → overrides → defaults.

- [ ] **Step 3: Commit**

```bash
git add packages/reactive-intelligence/src/calibration/model-registry.ts packages/reactive-intelligence/tests/calibration/model-registry.test.ts
git commit -m "feat(reactive-intelligence): add model registry with prefix-match fallback"
```

---

### Task 14: Conformal Calibration

**Files:**
- Create: `packages/reactive-intelligence/src/calibration/conformal.ts`
- Create: `packages/reactive-intelligence/src/calibration/calibration-store.ts`
- Create: `packages/reactive-intelligence/tests/calibration/conformal.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { computeConformalThreshold, computeCalibration } from "../../src/calibration/conformal.js";

describe("conformal calibration", () => {
  test("returns uncalibrated when fewer than 20 runs", () => {
    const cal = computeCalibration("test-model", [0.3, 0.4, 0.5]);
    expect(cal.calibrated).toBe(false);
    expect(cal.sampleCount).toBe(3);
  });

  test("calibrates after 20 runs with α=0.10", () => {
    // 20 scores from 0.1 to 0.9
    const scores = Array.from({ length: 20 }, (_, i) => 0.1 + (i * 0.04));
    const cal = computeCalibration("test-model", scores);
    expect(cal.calibrated).toBe(true);
    expect(cal.sampleCount).toBe(20);
    // highEntropyThreshold should be near the 19th/20th percentile
    expect(cal.highEntropyThreshold).toBeGreaterThan(0.7);
    expect(cal.highEntropyThreshold).toBeLessThan(1.0);
  });

  test("convergence threshold uses α=0.30 (looser)", () => {
    const scores = Array.from({ length: 20 }, (_, i) => 0.1 + (i * 0.04));
    const cal = computeCalibration("test-model", scores);
    expect(cal.convergenceThreshold).toBeLessThan(cal.highEntropyThreshold);
  });

  test("detects drift when recent scores deviate significantly", () => {
    const baseScores = Array.from({ length: 20 }, () => 0.3);
    const cal = computeCalibration("test-model", baseScores);
    expect(cal.driftDetected).toBe(false);

    // Now add extreme scores
    const driftScores = [...baseScores, 0.9, 0.95, 0.85];
    const cal2 = computeCalibration("test-model", driftScores);
    expect(cal2.driftDetected).toBe(true);
  });

  test("quantile function returns correct percentile", () => {
    const sorted = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const q90 = computeConformalThreshold(sorted, 0.10);
    expect(q90).toBeGreaterThanOrEqual(0.9);
  });
});
```

- [ ] **Step 2: Run test, then implement conformal.ts**

Key implementation points:
- `computeConformalThreshold(sortedScores, alpha)`: `q̂ = scores[⌈(N+1)(1-α)⌉/N - 1]`
- `computeCalibration(modelId, allScores)`: returns `ModelCalibration`
- Drift detection: mean + 2σ check on last 5 scores vs calibration mean

- [ ] **Step 3: Implement calibration-store.ts (SQLite persistence)**

```typescript
import { Database } from "bun:sqlite";
import type { ModelCalibration } from "../types.js";

export class CalibrationStore {
  private db: Database;

  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS calibrations (
      model_id TEXT PRIMARY KEY,
      scores TEXT NOT NULL,
      sample_count INTEGER NOT NULL,
      high_entropy_threshold REAL NOT NULL,
      convergence_threshold REAL NOT NULL,
      calibrated INTEGER NOT NULL DEFAULT 0,
      last_updated INTEGER NOT NULL,
      drift_detected INTEGER NOT NULL DEFAULT 0
    )`);
  }

  save(cal: ModelCalibration): void {
    this.db.prepare(`INSERT OR REPLACE INTO calibrations
      (model_id, scores, sample_count, high_entropy_threshold, convergence_threshold, calibrated, last_updated, drift_detected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cal.modelId,
      JSON.stringify(cal.calibrationScores),
      cal.sampleCount,
      cal.highEntropyThreshold,
      cal.convergenceThreshold,
      cal.calibrated ? 1 : 0,
      cal.lastUpdated,
      cal.driftDetected ? 1 : 0,
    );
  }

  load(modelId: string): ModelCalibration | null {
    const row = this.db.prepare("SELECT * FROM calibrations WHERE model_id = ?").get(modelId) as any;
    if (!row) return null;
    return {
      modelId: row.model_id,
      calibrationScores: JSON.parse(row.scores),
      sampleCount: row.sample_count,
      highEntropyThreshold: row.high_entropy_threshold,
      convergenceThreshold: row.convergence_threshold,
      calibrated: !!row.calibrated,
      lastUpdated: row.last_updated,
      driftDetected: !!row.drift_detected,
    };
  }
}
```

- [ ] **Step 4: Run all calibration tests**

Run: `cd packages/reactive-intelligence && bun test tests/calibration/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/calibration/ packages/reactive-intelligence/tests/calibration/
git commit -m "feat(reactive-intelligence): implement conformal calibration + SQLite persistence"
```

---

## Chunk 4: Service + Integration + Builder

### Task 15: EntropySensorService Implementation

**Files:**
- Create: `packages/reactive-intelligence/src/sensor/entropy-sensor-service.ts`
- Create: `packages/reactive-intelligence/src/runtime.ts`
- Create: `packages/reactive-intelligence/tests/sensor/entropy-sensor-service.test.ts`

This is the central service that orchestrates all 5 entropy sources into a single `score()` call.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EntropySensorService } from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";

describe("EntropySensorService", () => {
  const testLayer = createReactiveIntelligenceLayer();

  test("score() returns EntropyScore for a basic thought", async () => {
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.score({
        thought: "I need to search for the capital of France.",
        taskDescription: "Find the capital of France",
        strategy: "reactive",
        iteration: 1,
        maxIterations: 10,
        modelId: "cogito:14b",
        temperature: 0.3,
        kernelState: {
          taskId: "test-1",
          strategy: "reactive",
          kernelType: "react",
          steps: [],
          toolsUsed: new Set(),
          scratchpad: new Map(),
          iteration: 1,
          tokens: 0,
          cost: 0,
          status: "thinking",
          output: null,
          error: null,
          meta: {},
        },
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(1);
    expect(result.sources.structural).toBeDefined();
    expect(result.sources.behavioral).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.iteration).toBe(1);
  });

  test("score() never fails — catches internal errors", async () => {
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      // Pass malformed input — should not throw
      return yield* sensor.score({
        thought: "",
        taskDescription: "",
        strategy: "",
        iteration: 0,
        maxIterations: 0,
        modelId: "",
        temperature: 0,
        kernelState: {
          taskId: "test-2",
          strategy: "",
          kernelType: "",
          steps: [],
          toolsUsed: new Set(),
          scratchpad: new Map(),
          iteration: 0,
          tokens: 0,
          cost: 0,
          status: "thinking",
          output: null,
          error: null,
          meta: {},
        },
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(result).toBeDefined();
    expect(result.composite).toBeGreaterThanOrEqual(0);
  });

  test("getTrajectory() returns trajectory for a given taskId", async () => {
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      const ks = {
        taskId: "traj-test",
        strategy: "reactive",
        kernelType: "react",
        steps: [],
        toolsUsed: new Set(),
        scratchpad: new Map(),
        iteration: 1,
        tokens: 0,
        cost: 0,
        status: "thinking" as const,
        output: null,
        error: null,
        meta: {},
      };

      // Score twice to build trajectory
      yield* sensor.score({
        thought: "First thought about the problem",
        taskDescription: "Test task",
        strategy: "reactive",
        iteration: 1,
        maxIterations: 10,
        modelId: "test",
        temperature: 0.5,
        kernelState: ks,
      });

      yield* sensor.score({
        thought: "Second thought with more analysis",
        taskDescription: "Test task",
        strategy: "reactive",
        iteration: 2,
        maxIterations: 10,
        modelId: "test",
        temperature: 0.5,
        kernelState: { ...ks, iteration: 2 },
      });

      return yield* sensor.getTrajectory("traj-test");
    });

    const trajectory = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(trajectory.history).toHaveLength(2);
    expect(trajectory.shape).toBeDefined();
  });

  test("getCalibration() returns uncalibrated for new model", async () => {
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      return yield* sensor.getCalibration("brand-new-model");
    });

    const cal = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    expect(cal.calibrated).toBe(false);
    expect(cal.sampleCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/entropy-sensor-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement entropy-sensor-service.ts**

The service:
- Defines `EntropySensorService` as `Context.Tag("EntropySensorService")`
- Methods: `score()`, `scoreContext()`, `getCalibration()`, `updateCalibration()`, `getTrajectory(taskId)`
- Internal state: `Map<string, EntropyScore[]>` for per-task trajectory tracking
- Orchestrates all 5 sources: token (from logprobs), structural (sync), semantic (via embed if available), behavioral (from steps), context pressure
- Wraps everything in `Effect.catchAll(() => Effect.succeed(fallbackScore))` to guarantee never-fail

Key pattern for LLMService dependency:
```typescript
export const EntropySensorServiceLive = (config?: Partial<ReactiveIntelligenceConfig>) =>
  Layer.effect(
    EntropySensorService,
    Effect.gen(function* () {
      // LLMService is optional — for semantic entropy embeddings
      const llmOpt = yield* Effect.serviceOption(LLMService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      const llm = llmOpt._tag === "Some" ? llmOpt.value : null;

      // Per-task trajectory state
      const trajectories = new Map<string, EntropyScore[]>();
      const calibrationStore = new CalibrationStore();

      return {
        score: (params) => Effect.gen(function* () {
          // 1. Token entropy (from logprobs)
          const tokenResult = computeTokenEntropy(params.logprobs);

          // 2. Structural entropy (always available, sync)
          const structuralResult = computeStructuralEntropy(params.thought, params.strategy);

          // 3. Semantic entropy (requires embed)
          let semanticResult: SemanticEntropy | null = null;
          if (llm && params.priorThought) {
            // embed current + compute vs centroid
            // ... (use llm.embed, update centroid in meta)
          }

          // 4. Behavioral entropy (from kernel state)
          const behavioralResult = computeBehavioralEntropy({
            steps: params.kernelState.steps as any[],
            iteration: params.iteration,
            maxIterations: params.maxIterations,
          });

          // 5. Context pressure
          // (computed separately via scoreContext — not per-thought)

          // 6. Composite
          const score = computeCompositeEntropy({
            token: tokenResult?.sequenceEntropy ?? null,
            structural: meanStructural(structuralResult),
            semantic: semanticResult?.taskAlignment ?? null,
            behavioral: meanBehavioral(behavioralResult),
            contextPressure: 0, // filled by separate scoreContext call
            logprobsAvailable: tokenResult !== null,
            iteration: params.iteration,
            maxIterations: params.maxIterations,
            modelTier: lookupModel(params.modelId).tier as any,
            temperature: params.temperature,
          });

          // Store in per-task trajectory
          const history = trajectories.get(params.kernelState.taskId) ?? [];
          history.push(score);
          trajectories.set(params.kernelState.taskId, history);

          return score;
        }).pipe(Effect.catchAll(() => Effect.succeed(fallbackScore(params)))),

        getTrajectory: (taskId) => Effect.sync(() => {
          const history = trajectories.get(taskId) ?? [];
          return computeEntropyTrajectory(
            history.map(s => s.composite),
            10,
          );
        }),

        getCalibration: (modelId) => Effect.sync(() => {
          return calibrationStore.load(modelId) ?? uncalibratedDefault(modelId);
        }),

        updateCalibration: (modelId, runScores) => Effect.sync(() => {
          const existing = calibrationStore.load(modelId);
          const allScores = [...(existing?.calibrationScores ?? []), ...runScores];
          const cal = computeCalibration(modelId, allScores);
          calibrationStore.save(cal);
          return cal;
        }),

        scoreContext: (params) => Effect.sync(() => {
          return computeContextPressure({
            systemPrompt: "",
            toolResults: [],
            history: [],
            taskDescription: "",
            contextLimit: lookupModel(params.modelId).contextLimit,
          });
        }),
      };
    }),
  );
```

**Implementation notes (these must be executable, not pseudocode):**

The service implementation must include these helper functions:

```typescript
/** Convert StructuralEntropy fields to a single [0,1] score (mean of all 6 fields). */
function meanStructural(s: StructuralEntropy): number {
  return (s.formatCompliance + s.orderIntegrity + s.thoughtDensity +
    s.vocabularyDiversity + s.hedgeScore + s.jsonParseScore) / 6;
}

/** Convert BehavioralEntropy fields to a single [0,1] disorder score.
 *  Inverts success-oriented fields so higher = more entropy. */
function meanBehavioral(b: BehavioralEntropy): number {
  return (
    (1 - b.toolSuccessRate) +     // low success = high entropy
    (1 - b.actionDiversity) +      // low diversity = high entropy
    b.loopDetectionScore +         // high loop = high entropy
    (1 - b.completionApproach)     // no completion = high entropy
  ) / 4;
}

/** Fallback score when scoring fails entirely. */
function fallbackScore(params: { iteration: number; maxIterations: number }): EntropyScore {
  return {
    composite: 0.5, // neutral
    sources: { token: null, structural: 0.5, semantic: null, behavioral: 0.5, contextPressure: 0 },
    trajectory: { history: [], derivative: 0, momentum: 0.5, shape: "flat" },
    confidence: "low",
    modelTier: "unknown",
    iteration: params.iteration,
    iterationWeight: iterationWeight(params.iteration, params.maxIterations),
    timestamp: Date.now(),
  };
}

/** Default calibration for uncalibrated models. */
function uncalibratedDefault(modelId: string): ModelCalibration {
  return {
    modelId,
    calibrationScores: [],
    sampleCount: 0,
    highEntropyThreshold: 0.8, // permissive defaults
    convergenceThreshold: 0.4,
    calibrated: false,
    lastUpdated: Date.now(),
    driftDetected: false,
  };
}
```

For the `scoreContext` method, populate from the `sections` parameter passed in (not empty strings):
```typescript
scoreContext: (params) => Effect.sync(() => {
  return computeContextPressure({
    systemPrompt: "", // caller provides sections directly
    toolResults: [],
    history: [],
    taskDescription: "",
    contextLimit: lookupModel(params.modelId).contextLimit,
    // Override: use sections parameter directly if provided
  });
}),
```

For semantic entropy when LLMService is available:
```typescript
// Inside score(), after structural and behavioral scoring:
let semanticResult: SemanticEntropy | null = null;
if (llm && params.priorThought) {
  try {
    const embeddings = yield* llm.embed([params.thought, params.priorThought]).pipe(
      Effect.catchAll(() => Effect.succeed([] as readonly (readonly number[])[])),
    );
    if (embeddings.length >= 2) {
      const entropyMeta = (params.kernelState.meta as any)?.entropy ?? {};
      const priorEmbeddings = entropyMeta.thoughtEmbeddings?.embeddings ?? [];
      const centroid = entropyMeta.thoughtEmbeddings?.centroid ?? null;

      semanticResult = computeSemanticEntropy({
        currentEmbedding: embeddings[0] as number[],
        taskEmbedding: null, // TODO: cache task embedding on first call
        priorEmbeddings,
        centroid,
      });

      // Update centroid in meta (mutable — matches kernel runner pattern)
      const newCentroid = updateCentroid(centroid, embeddings[0] as number[], priorEmbeddings.length);
      (params.kernelState.meta as any).entropy = {
        ...entropyMeta,
        thoughtEmbeddings: {
          embeddings: [...priorEmbeddings, embeddings[0]],
          centroid: newCentroid,
        },
      };
    }
  } catch { /* semantic source degrades to null */ }
}
```

Trajectory cleanup on task completion should be handled lazily — trajectories are small (10-15 entries max) and can be cleaned up periodically or on GC. No EventBus subscription needed in Phase 1.

- [ ] **Step 4: Implement runtime.ts**

```typescript
import { Layer } from "effect";
import type { ReactiveIntelligenceConfig } from "./types.js";
import { defaultReactiveIntelligenceConfig } from "./types.js";
import { EntropySensorServiceLive } from "./sensor/entropy-sensor-service.js";

export const createReactiveIntelligenceLayer = (
  config?: Partial<ReactiveIntelligenceConfig>,
) => {
  const merged = { ...defaultReactiveIntelligenceConfig, ...config };
  return EntropySensorServiceLive(merged);
};
```

- [ ] **Step 5: Update index.ts with all exports**

Add all sensor modules, calibration modules, service, and runtime exports.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/reactive-intelligence && bun test tests/sensor/entropy-sensor-service.test.ts`
Expected: PASS

- [ ] **Step 7: Run all package tests**

Run: `cd packages/reactive-intelligence && bun test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/reactive-intelligence/src/ packages/reactive-intelligence/tests/
git commit -m "feat(reactive-intelligence): implement EntropySensorService with all 5 sources"
```

---

### Task 16: Builder API + Runtime Integration

**Files:**
- Modify: `packages/runtime/src/builder.ts` — add `withReactiveIntelligence()` method
- Modify: `packages/runtime/src/runtime.ts` — wire layer into `createRuntime()`
- Create: `packages/runtime/tests/reactive-intelligence-builder.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder.js";

describe("withReactiveIntelligence builder", () => {
  test("builder accepts withReactiveIntelligence()", () => {
    const builder = new ReactiveAgentBuilder()
      .withProvider("anthropic")
      .withReactiveIntelligence({
        entropy: { enabled: true },
      });
    expect(builder).toBeDefined();
  });

  test("builder accepts withReactiveIntelligence() with no args (defaults)", () => {
    const builder = new ReactiveAgentBuilder()
      .withProvider("anthropic")
      .withReactiveIntelligence();
    expect(builder).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/reactive-intelligence-builder.test.ts`
Expected: FAIL — `withReactiveIntelligence` is not a function

- [ ] **Step 3: Add to builder.ts**

In `packages/runtime/src/builder.ts`:

1. Add import: `import type { ReactiveIntelligenceConfig } from "@reactive-agents/reactive-intelligence";`
2. Add private fields: `private _enableReactiveIntelligence = false;` and `private _reactiveIntelligenceOptions?: Partial<ReactiveIntelligenceConfig>;`
3. Add method:
```typescript
  /**
   * Enable the Reactive Intelligence Layer — entropy-based metacognitive sensing.
   *
   * The Entropy Sensor monitors reasoning quality per-iteration across 5 sources
   * (token, structural, semantic, behavioral, context pressure) and publishes
   * EntropyScored events to the EventBus for observability.
   *
   * @param options - Optional configuration overrides
   * @returns `this` for chaining
   */
  withReactiveIntelligence(options?: Partial<ReactiveIntelligenceConfig>): this {
    this._enableReactiveIntelligence = true;
    if (options) this._reactiveIntelligenceOptions = options;
    return this;
  }
```

4. In the `build()` method where `createRuntime()` is called, pass:
```typescript
enableReactiveIntelligence: this._enableReactiveIntelligence,
reactiveIntelligenceOptions: this._reactiveIntelligenceOptions,
```

- [ ] **Step 4: Add to runtime.ts**

In `packages/runtime/src/runtime.ts`:

1. Add `"@reactive-agents/reactive-intelligence": "0.7.8"` to `packages/runtime/package.json` dependencies
2. Add import: `import { createReactiveIntelligenceLayer } from "@reactive-agents/reactive-intelligence";`
3. Add to `RuntimeOptions`: `enableReactiveIntelligence?: boolean;` and `reactiveIntelligenceOptions?: Partial<import("./builder.js").ReactiveIntelligenceConfig>;`
3. In `createRuntime()`, after the verification layer block:
```typescript
if (options.enableReactiveIntelligence) {
  runtime = Layer.merge(runtime, createReactiveIntelligenceLayer(options.reactiveIntelligenceOptions)) as any;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/reactive-intelligence-builder.test.ts`
Expected: PASS

- [ ] **Step 6: Build runtime package**

Run: `cd packages/runtime && bun run build`
Expected: builds without errors

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/runtime.ts packages/runtime/tests/reactive-intelligence-builder.test.ts
git commit -m "feat(runtime): wire .withReactiveIntelligence() into builder + createRuntime()"
```

---

### Task 17: KernelRunner Integration

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-runner.ts` — resolve EntropySensorService optionally, score new thoughts after each kernel() call
- Modify: `packages/reasoning/src/strategies/shared/service-utils.ts` — add EntropySensorService to resolveStrategyServices
- Create: `packages/reasoning/tests/strategies/shared/kernel-entropy-integration.test.ts`

**Integration architecture:** The `onThought` hook is called inside individual kernels (e.g., `react-kernel.ts` line ~437), NOT in `kernel-runner.ts`. The kernel runner calls `yield* kernel(state, context)` at line 134 which returns the new state. We score entropy in `kernel-runner.ts` AFTER each kernel() call by detecting new thought steps (comparing `state.steps.length` before and after). This centralizes entropy scoring across all kernels without modifying each kernel individually.

- [ ] **Step 1: Write failing integration test**

Create `packages/reasoning/tests/strategies/shared/kernel-entropy-integration.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { runKernel } from "../../../src/strategies/shared/kernel-runner.js";
import { reactKernel } from "../../../src/strategies/shared/react-kernel.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { EntropySensorService } from "@reactive-agents/core";

describe("kernel runner entropy integration", () => {
  test("runs successfully without EntropySensorService (optional)", async () => {
    const mockLLM = Layer.succeed(LLMService, {
      complete: () => Effect.succeed({
        content: "FINAL ANSWER: Paris",
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
        model: "test",
      }),
      stream: () => Effect.succeed(null as any),
      completeStructured: () => Effect.succeed(null as any),
      embed: () => Effect.succeed([]),
      countTokens: () => Effect.succeed(10),
      getModelConfig: () => Effect.succeed({ provider: "test" as any, model: "test" }),
      getStructuredOutputCapabilities: () => Effect.succeed({
        nativeJsonMode: false,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),
    });

    const program = runKernel(reactKernel, {
      task: "What is the capital of France?",
      availableToolSchemas: [],
    }, {
      maxIterations: 3,
      strategy: "reactive",
      kernelType: "react",
      taskId: "test-no-entropy",
    });

    const state = await Effect.runPromise(program.pipe(Effect.provide(mockLLM)));
    expect(state.status).toBe("done");
  });

  test("accumulates entropy scores when EntropySensorService is provided", async () => {
    // Placeholder — expanded after Task 15 (EntropySensorService) is complete.
    // Should verify state.meta.entropy.entropyHistory is populated after run.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Modify service-utils.ts to resolve EntropySensorService**

Import `EntropySensorService` from `@reactive-agents/core` (NOT from reactive-intelligence — avoids circular dep):

```typescript
import { EntropySensorService } from "@reactive-agents/core";
```

In `resolveStrategyServices`, add:
```typescript
const entropySensorOptRaw = yield* Effect.serviceOption(EntropySensorService).pipe(
  Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
);
const entropySensor = entropySensorOptRaw as MaybeService<typeof EntropySensorService.Type>;
```

Add `entropySensor` to the returned `StrategyServices` type.

- [ ] **Step 3: Modify kernel-runner.ts to score entropy after each kernel() call**

In the main while loop of `runKernel()`, AFTER `state = yield* kernel(state, currentContext)` at line 134, and BEFORE the iteration progress hook at line 141, add:

```typescript
      // ── Entropy scoring (post-kernel, pre-loop-detection) ──────────────
      // Detect new thought steps added by this kernel call.
      // Score the latest thought via EntropySensorService (if available).
      if (entropySensor._tag === "Some") {
        const newThoughtSteps = state.steps.filter(
          (s, idx) => s.type === "thought" && idx >= prevStepCount,
        );
        if (newThoughtSteps.length > 0) {
          const latestThought = newThoughtSteps[newThoughtSteps.length - 1]!;
          const priorThoughts = state.steps
            .slice(0, prevStepCount)
            .filter((s) => s.type === "thought");
          const priorThought = priorThoughts.length > 0
            ? priorThoughts[priorThoughts.length - 1]!.content
            : undefined;

          yield* entropySensor.value
            .score({
              thought: latestThought.content ?? "",
              taskDescription: (state.meta.entropy as any)?.taskDescription ?? "",
              strategy: state.strategy,
              iteration: state.iteration,
              maxIterations: (state.meta.maxIterations as number) ?? 10,
              modelId: (state.meta.entropy as any)?.modelId ?? "unknown",
              temperature: (state.meta.entropy as any)?.temperature ?? 0,
              priorThought,
              logprobs: (state.meta.entropy as any)?.lastLogprobs,
              kernelState: state,
            })
            .pipe(
              Effect.tap((score) => {
                // Mutable append — matches kernel runner's existing mutation pattern
                const entropyMeta = (state.meta as any).entropy ?? {};
                const history = entropyMeta.entropyHistory ?? [];
                history.push(score);
                (state.meta as any).entropy = { ...entropyMeta, entropyHistory: history };

                // Publish to EventBus
                if (eventBus._tag === "Some") {
                  return eventBus.value.publish({
                    _tag: "EntropyScored",
                    taskId: state.taskId,
                    iteration: score.iteration,
                    composite: score.composite,
                    sources: score.sources,
                    trajectory: score.trajectory,
                    confidence: score.confidence,
                    modelTier: score.modelTier,
                    iterationWeight: score.iterationWeight,
                  });
                }
                return Effect.void;
              }),
              Effect.catchAll(() => Effect.void),
            );
        }
      }
      const prevStepCount = state.steps.length; // track for next iteration
```

**Important:** Also add `let prevStepCount = 0;` before the while loop (alongside `let prevToolsUsed = new Set<string>();`). The `entropySensor` comes from `services` which is resolved at line 72-74.

- [ ] **Step 4: Run integration test**

Run: `cd packages/reasoning && bun test tests/strategies/shared/kernel-entropy-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Run all reasoning tests to verify no regressions**

Run: `cd packages/reasoning && bun test`
Expected: all existing tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/shared/kernel-runner.ts packages/reasoning/src/strategies/shared/service-utils.ts packages/reasoning/tests/strategies/shared/kernel-entropy-integration.test.ts
git commit -m "feat(reasoning): integrate EntropySensorService into KernelRunner (post-kernel scoring)"
```

---

### Task 18: Validation Dataset

**Files:**
- Create: `packages/reactive-intelligence/tests/sensor/validation-dataset.ts`
- Create: `packages/reactive-intelligence/tests/sensor/validation.test.ts`

- [ ] **Step 1: Create validation dataset with ≥60 labeled examples**

Each example has: `thought` text, `strategy`, `expectedCategory` ("high-signal" | "low-signal" | "ambiguous"), `expectedCompositeRange` [min, max].

Categories:
- **High-signal (≥15):** Correct tool calls, coherent reasoning, on-task progress → composite < 0.3
- **Low-signal (≥15):** Malformed JSON, verbatim repetition, topic drift, pure hedging → composite > 0.7
- **Ambiguous (≥15):** Short but correct, legitimate exploration, jargon-heavy → composite 0.3–0.7
- **Trajectory (≥15):** Multi-step sequences with known shapes

- [ ] **Step 2: Write validation test**

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EntropySensorService } from "../../src/sensor/entropy-sensor-service.js";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";
import { VALIDATION_DATASET } from "./validation-dataset.js";

describe("validation dataset accuracy", () => {
  const layer = createReactiveIntelligenceLayer();

  test("classification accuracy ≥ 85% on high-signal examples", async () => {
    const highSignal = VALIDATION_DATASET.filter((e) => e.category === "high-signal");
    let correct = 0;
    for (const example of highSignal) {
      const program = Effect.gen(function* () {
        const sensor = yield* EntropySensorService;
        return yield* sensor.score(example.input);
      });
      const score = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      if (score.composite < 0.3) correct++;
    }
    const accuracy = correct / highSignal.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  test("classification accuracy ≥ 85% on low-signal examples", async () => {
    const lowSignal = VALIDATION_DATASET.filter((e) => e.category === "low-signal");
    let correct = 0;
    for (const example of lowSignal) {
      const program = Effect.gen(function* () {
        const sensor = yield* EntropySensorService;
        return yield* sensor.score(example.input);
      });
      const score = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      if (score.composite > 0.7) correct++;
    }
    const accuracy = correct / lowSignal.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });
});
```

- [ ] **Step 3: Tune composite weights if accuracy is below 85%**

If initial accuracy is below threshold, adjust weights in `composite.ts` and structural scoring thresholds. This is the empirical tuning step.

- [ ] **Step 4: Commit**

```bash
git add packages/reactive-intelligence/tests/sensor/validation-dataset.ts packages/reactive-intelligence/tests/sensor/validation.test.ts
git commit -m "test(reactive-intelligence): add validation dataset (60+ labeled examples) + accuracy gate"
```

---

### Task 19: Final Integration Test + Full Build

**Files:**
- Create: `packages/reactive-intelligence/tests/integration/event-flow.test.ts`

- [ ] **Step 1: Write EventBus integration test**

Test that `EntropyScored` events flow from the sensor through EventBus and can be observed by MetricsCollector.

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { EntropySensorService } from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";

describe("entropy event flow", () => {
  test("EntropyScored events are published to EventBus", async () => {
    const collectedEvents: any[] = [];

    const program = Effect.gen(function* () {
      const eb = yield* EventBus;
      yield* eb.on("EntropyScored", (event) => {
        collectedEvents.push(event);
        return Effect.void;
      });

      const sensor = yield* EntropySensorService;
      yield* sensor.score({
        thought: "The capital of France is Paris.",
        taskDescription: "Find capitals",
        strategy: "reactive",
        iteration: 1,
        maxIterations: 10,
        modelId: "test",
        temperature: 0.5,
        kernelState: {
          taskId: "event-test",
          strategy: "reactive",
          kernelType: "react",
          steps: [],
          toolsUsed: new Set(),
          scratchpad: new Map(),
          iteration: 1,
          tokens: 0,
          cost: 0,
          status: "thinking",
          output: null,
          error: null,
          meta: {},
        },
      });
    });

    const layer = Layer.merge(EventBusLive, createReactiveIntelligenceLayer());
    await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(collectedEvents.length).toBeGreaterThanOrEqual(1);
    expect(collectedEvents[0]._tag).toBe("EntropyScored");
    expect(collectedEvents[0].composite).toBeDefined();
  });
});
```

- [ ] **Step 2: Run full package test suite**

Run: `cd packages/reactive-intelligence && bun test`
Expected: all tests pass

- [ ] **Step 3: Build entire monorepo**

Run: `bun run build`
Expected: all 21 packages build successfully (including new reactive-intelligence)

- [ ] **Step 4: Run full monorepo tests**

Run: `bun test`
Expected: all 1773+ tests pass (plus ~50+ new tests from this implementation)

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/tests/integration/
git commit -m "test(reactive-intelligence): add EventBus integration test + verify full build"
```

---

### Task 20: Update CLAUDE.md + Package Map

**Files:**
- Modify: `CLAUDE.md` — add reactive-intelligence to package map, update test count, update version

- [ ] **Step 1: Add to package map**

In the `Package Map` section of CLAUDE.md, add:
```
  reactive-intelligence/ — Entropy Sensor, reactive controller (Phase 2), learning engine (Phase 3)
```

- [ ] **Step 2: Update test count**

Update the test count in the build commands section and project status to reflect new tests.

- [ ] **Step 3: Update project status**

Add a new bullet to the project status section:
```
- Reactive Intelligence Layer (Phase 1): Entropy Sensor — 5 entropy sources (token, structural, semantic, behavioral, context pressure), conformal calibration, trajectory analysis, EntropySensorService, KernelRunner integration, .withReactiveIntelligence() builder API
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with reactive-intelligence package"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| **1: Foundation** | T1–T5 | Package scaffold, types, events, upstream logprobs + KernelRunOptions changes |
| **2: Entropy Sources** | T6–T9 | Token (1A), Structural (1B), Semantic (1C), Behavioral (1D) scorers |
| **3: Sources + Composite + Calibration** | T10–T14 | Context Pressure (1E), Trajectory (1F), composite scorer, model registry, conformal calibration |
| **4: Service + Integration** | T15–T20 | EntropySensorService, builder API, KernelRunner wiring, validation dataset, EventBus flow, docs |

**Total estimated new tests:** ~50–60
**Total estimated new files:** ~25–30
**Packages modified:** 4 (core, llm-provider, reasoning, runtime) + 1 new (reactive-intelligence)
