# Enhancement Packages - AI Agent Implementation Spec

## Overview

Seven enhancement capabilities organized into **3 new packages** plus **4 integration extensions** for existing layers. These transform Reactive Agents from a strong framework into an industry-defining one.

**New Packages:**

1. `@reactive-agents/guardrails` — Agent safety contracts, input/output filtering, runtime boundaries
2. `@reactive-agents/eval` — Evaluation suites, benchmarking, regression detection, shadow eval
3. `@reactive-agents/prompts` — Prompt templates, versioning, A/B testing, composition

**Extensions to Existing Layers (not separate packages):** 4. `AgentLearningService` → add to `@reactive-agents/reasoning` (Layer 3) 5. `ContextWindowManager` → add to `@reactive-agents/core` (Layer 1) 6. `StreamingService` → add to `@reactive-agents/core` (Layer 1) 7. `@reactive-agents/cli` → developer tooling (CLI commands, project scaffolding)

**Phase:** P0 capabilities (guardrails, eval) in Phase 2 Weeks 5-8; P1 (prompts, CLI, learning) in Phase 3 Weeks 9-12.

---

# Package 1: `@reactive-agents/guardrails`

> **Design Evolution (v0.4.0):** The original spec proposed a multi-service architecture with
> PolicyEngine, ContractEnforcer, scope-enforcer, and content-filter as separate Context.Tag services.
> The shipped implementation is intentionally simpler: a single `GuardrailService` backed by 3
> heuristic detectors (injection, PII, toxicity) plus an optional AgentContract check. This avoids
> over-engineering for the current use case while preserving the ability to add PolicyEngine and
> ContractEnforcer as separate services in v1.x when policy-based routing becomes necessary.

## Package Structure (Shipped)

```
@reactive-agents/guardrails/
├── src/
│   ├── index.ts                      # Public API re-exports
│   ├── types.ts                      # ViolationType, Severity, GuardrailResult, AgentContract, GuardrailConfig schemas
│   ├── errors.ts                     # Data.TaggedError definitions
│   ├── detectors/
│   │   ├── injection-detector.ts     # Heuristic prompt injection detection
│   │   ├── pii-detector.ts           # PII regex detection (email, phone, SSN, CC, API keys)
│   │   └── toxicity-detector.ts      # Keyword/blocklist-based toxicity detection
│   ├── contracts/
│   │   └── agent-contract.ts         # AgentContract topic/action boundary enforcement
│   ├── guardrail-service.ts          # GuardrailService Context.Tag + Live Layer (orchestrates all checks)
│   └── runtime.ts                    # createGuardrailLayer factory
├── tests/
│   ├── injection-detector.test.ts
│   ├── pii-detector.test.ts
│   ├── toxicity-detector.test.ts
│   └── guardrail-service.test.ts
├── package.json
└── tsconfig.json
```

## Build Order

1. `src/types.ts` — ViolationType, Severity, GuardrailResult, AgentContract, GuardrailConfig schemas + defaults
2. `src/errors.ts` — GuardrailError
3. `src/detectors/injection-detector.ts` — heuristic regex patterns for prompt injection
4. `src/detectors/pii-detector.ts` — regex patterns for email, phone, SSN, CC, API keys
5. `src/detectors/toxicity-detector.ts` — keyword/blocklist-based toxicity scoring
6. `src/contracts/agent-contract.ts` — topic/action boundary enforcement against AgentContract
7. `src/guardrail-service.ts` — GuardrailService + GuardrailServiceLive (orchestrates check pipeline)
8. `src/runtime.ts` — createGuardrailLayer factory
9. `src/index.ts` — Public re-exports
10. Tests

> **Future Enhancements (v1.x):**
> - `PolicyEngine` — configurable policy rules with phase-aware evaluation (input/output/action/always)
> - `ContractEnforcer` — separate service for enforcing complex agent contracts with capability/prohibition checks
> - `scope-enforcer` — LLM-based output relevance checking
> - `content-filter` — LLM-based toxicity scoring (currently heuristic-only)

## Core Types (Shipped)

### File: `src/types.ts`

```typescript
// File: src/types.ts
import { Schema } from "effect";

// ─── Violation Type ───

export const ViolationType = Schema.Literal(
  "prompt-injection",
  "pii-detected",
  "toxicity",
  "scope-violation",
  "contract-violation",
);
export type ViolationType = typeof ViolationType.Type;

// ─── Severity ───

export const Severity = Schema.Literal("low", "medium", "high", "critical");
export type Severity = typeof Severity.Type;

// ─── Guardrail Result ───

export const GuardrailResultSchema = Schema.Struct({
  passed: Schema.Boolean,
  violations: Schema.Array(
    Schema.Struct({
      type: ViolationType,
      severity: Severity,
      message: Schema.String,
      details: Schema.optional(Schema.String),
    }),
  ),
  score: Schema.Number, // 0-1, 1 = fully safe
  checkedAt: Schema.DateFromSelf,
});
export type GuardrailResult = typeof GuardrailResultSchema.Type;

// ─── Agent Contract ───

export const AgentContractSchema = Schema.Struct({
  allowedTopics: Schema.Array(Schema.String),
  deniedTopics: Schema.Array(Schema.String),
  allowedActions: Schema.Array(Schema.String),
  deniedActions: Schema.Array(Schema.String),
  maxOutputLength: Schema.optional(Schema.Number),
  requireDisclosure: Schema.optional(Schema.Boolean),
});
export type AgentContract = typeof AgentContractSchema.Type;

// ─── Guardrail Config ───

export const GuardrailConfigSchema = Schema.Struct({
  enableInjectionDetection: Schema.Boolean,
  enablePiiDetection: Schema.Boolean,
  enableToxicityDetection: Schema.Boolean,
  contract: Schema.optional(AgentContractSchema),
  customBlocklist: Schema.optional(Schema.Array(Schema.String)),
});
export type GuardrailConfig = typeof GuardrailConfigSchema.Type;

export const defaultGuardrailConfig: GuardrailConfig = {
  enableInjectionDetection: true,
  enablePiiDetection: true,
  enableToxicityDetection: true,
};
```

## Error Types (Shipped)

### File: `src/errors.ts`

```typescript
// File: src/errors.ts
import { Data } from "effect";

export class GuardrailError extends Data.TaggedError("GuardrailError")<{
  readonly message: string;
  readonly guardrail?: string;
  readonly cause?: unknown;
}> {}

export type GuardrailErrors = GuardrailError;
```

## Services (Shipped)

### File: `src/guardrail-service.ts`

The shipped `GuardrailService` is a single service that orchestrates 3 detectors + optional contract check.
It does NOT use PolicyEngine or ContractEnforcer as separate services.

```typescript
// File: src/guardrail-service.ts
import { Effect, Context, Layer } from "effect";
import type { GuardrailResult, GuardrailConfig } from "./types.js";
import { GuardrailError } from "./errors.js";
import { detectInjection } from "./detectors/injection-detector.js";
import { detectPii } from "./detectors/pii-detector.js";
import { detectToxicity } from "./detectors/toxicity-detector.js";
import { checkContract } from "./contracts/agent-contract.js";

export class GuardrailService extends Context.Tag("GuardrailService")<
  GuardrailService,
  {
    /** Check input text against all configured guardrails. */
    readonly check: (text: string) => Effect.Effect<GuardrailResult, GuardrailError>;

    /** Check output text (PII + toxicity, not injection). */
    readonly checkOutput: (text: string) => Effect.Effect<GuardrailResult, GuardrailError>;

    /** Get current config. */
    readonly getConfig: () => Effect.Effect<GuardrailConfig, never>;
  }
>() {}

export const GuardrailServiceLive = (config: GuardrailConfig) =>
  Layer.succeed(GuardrailService, {
    check: (text) =>
      Effect.gen(function* () {
        const violations = [];
        if (config.enableInjectionDetection) {
          const result = yield* detectInjection(text);
          if (result.detected) violations.push({ ...result });
        }
        if (config.enablePiiDetection) {
          const result = yield* detectPii(text);
          if (result.detected) violations.push({ ...result });
        }
        if (config.enableToxicityDetection) {
          const result = yield* detectToxicity(text, config.customBlocklist ?? []);
          if (result.detected) violations.push({ ...result });
        }
        if (config.contract) {
          const result = yield* checkContract(text, config.contract);
          if (result.detected) violations.push({ ...result });
        }
        const score = violations.length === 0 ? 1 : Math.max(0, 1 - violations.length * 0.25);
        return { passed: violations.length === 0, violations, score, checkedAt: new Date() };
      }),
    checkOutput: (text) => /* same as check but skips injection detection */,
    getConfig: () => Effect.succeed(config),
  });
```

### File: `src/runtime.ts`

```typescript
// File: src/runtime.ts
import { Layer } from "effect";
import { GuardrailServiceLive } from "./guardrail-service.js";
import type { GuardrailConfig } from "./types.js";
import { defaultGuardrailConfig } from "./types.js";

/**
 * Provides: GuardrailService
 * Requires: None (standalone, no LLM dependency)
 */
export const createGuardrailLayer = (config: GuardrailConfig = defaultGuardrailConfig) =>
  GuardrailServiceLive(config);
```

### Package Config

```json
{
  "name": "@reactive-agents/guardrails",
  "version": "0.4.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:^"
  }
}
```

> **Note:** The shipped guardrails package uses heuristic-only detectors and does NOT depend on
> `@reactive-agents/llm-provider`. LLM-based scoring (content-filter, scope-enforcer) is deferred to v1.x.
> When LLM-based detectors are added, `llm-provider` will become an optional dependency accessed via
> `Effect.serviceOption(LLMService)` so the service degrades gracefully to heuristics-only.

---

# Package 2: `@reactive-agents/eval`

> **Design Evolution (v0.4.0):** The original spec envisioned shadow eval, A/B testing, regression
> alerts, and benchmark suites as first-class features. The shipped implementation focuses on the
> core evaluation loop: LLM-as-judge scoring across 5 dimensions (accuracy, relevance, completeness,
> safety, cost-efficiency), with `EvalStore` for SQLite persistence and `DatasetService` for managing
> eval datasets. Shadow eval and A/B testing are deferred to v1.x.

## Package Structure (Shipped)

```
@reactive-agents/eval/
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── eval-case.ts              # EvalCase, EvalSuite schemas
│   │   ├── eval-result.ts            # EvalResult, DimensionScore, EvalRun, EvalRunSummary schemas
│   │   └── config.ts                 # EvalConfig schema + DEFAULT_EVAL_CONFIG
│   ├── errors/
│   │   └── errors.ts                 # EvalError, BenchmarkError
│   ├── dimensions/
│   │   ├── accuracy.ts               # LLM-as-judge accuracy scorer
│   │   ├── relevance.ts              # LLM-as-judge relevance scorer
│   │   ├── completeness.ts           # LLM-as-judge completeness scorer
│   │   ├── safety.ts                 # LLM-as-judge safety scorer
│   │   └── cost-efficiency.ts        # Quality-per-dollar calculation (no LLM needed)
│   ├── services/
│   │   ├── eval-service.ts           # EvalService Context.Tag + makeEvalServiceLive factory
│   │   ├── eval-store.ts             # EvalStore — SQLite persistence for eval runs
│   │   └── dataset-service.ts        # DatasetService Context.Tag + Live Layer
│   └── runtime.ts                    # createEvalLayer factory
├── tests/
├── package.json
└── tsconfig.json
```

## Build Order

1. `src/types/eval-case.ts` — EvalCase, EvalSuite schemas
2. `src/types/eval-result.ts` — DimensionScore, EvalResult, EvalRun, EvalRunSummary schemas
3. `src/types/config.ts` — EvalConfig schema + DEFAULT_EVAL_CONFIG (passThreshold, regressionThreshold, parallelism)
4. `src/errors/errors.ts` — EvalError, BenchmarkError
5. `src/dimensions/accuracy.ts` — LLM-as-judge accuracy scorer
6. `src/dimensions/relevance.ts` — LLM-as-judge relevance scorer
7. `src/dimensions/completeness.ts` — LLM-as-judge completeness scorer
8. `src/dimensions/safety.ts` — LLM-as-judge safety scorer
9. `src/dimensions/cost-efficiency.ts` — quality-per-dollar calculation
10. `src/services/eval-store.ts` — EvalStore (SQLite persistence via bun:sqlite)
11. `src/services/dataset-service.ts` — DatasetService + DatasetServiceLive
12. `src/services/eval-service.ts` — EvalService + makeEvalServiceLive (optionally accepts EvalStore)
13. `src/runtime.ts` — createEvalLayer factory
14. `src/index.ts` — Public re-exports
15. Tests

> **Future Enhancements (v1.x):**
> - **Shadow eval** — run eval suites in the background against live traffic without affecting responses
> - **A/B testing** — compare two agent configurations side-by-side with statistical significance
> - **Regression alerts** — automated CI alerts when eval scores drop below baseline
> - **Benchmark suites** — standardized industry benchmarks (MMLU, HumanEval, etc.)

## Core Types

### File: `src/types/eval-case.ts`

```typescript
// File: src/types/eval-case.ts
import { Schema } from "effect";

export const EvalCaseSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  input: Schema.String,
  expectedOutput: Schema.optional(Schema.String),
  expectedBehavior: Schema.optional(
    Schema.Struct({
      shouldUseTool: Schema.optional(Schema.String),
      shouldAskUser: Schema.optional(Schema.Boolean),
      maxSteps: Schema.optional(Schema.Number),
      maxCost: Schema.optional(Schema.Number),
    }),
  ),
  tags: Schema.optional(Schema.Array(Schema.String)),
});
export type EvalCase = typeof EvalCaseSchema.Type;

export const EvalSuiteSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  cases: Schema.Array(EvalCaseSchema),
  dimensions: Schema.Array(Schema.String),
  config: Schema.optional(
    Schema.Struct({
      parallelism: Schema.optional(Schema.Number),
      timeoutMs: Schema.optional(Schema.Number),
      retries: Schema.optional(Schema.Number),
    }),
  ),
});
export type EvalSuite = typeof EvalSuiteSchema.Type;
```

### File: `src/types/eval-result.ts`

```typescript
// File: src/types/eval-result.ts
import { Schema } from "effect";

export const DimensionScoreSchema = Schema.Struct({
  dimension: Schema.String,
  score: Schema.Number,
  details: Schema.optional(Schema.String),
});
export type DimensionScore = typeof DimensionScoreSchema.Type;

export const EvalResultSchema = Schema.Struct({
  caseId: Schema.String,
  timestamp: Schema.DateFromSelf,
  agentConfig: Schema.String,
  scores: Schema.Array(DimensionScoreSchema),
  overallScore: Schema.Number,
  actualOutput: Schema.String,
  latencyMs: Schema.Number,
  costUsd: Schema.Number,
  tokensUsed: Schema.Number,
  stepsExecuted: Schema.Number,
  passed: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
export type EvalResult = typeof EvalResultSchema.Type;

export const EvalRunSummarySchema = Schema.Struct({
  totalCases: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
  avgScore: Schema.Number,
  avgLatencyMs: Schema.Number,
  totalCostUsd: Schema.Number,
  dimensionAverages: Schema.Record({
    key: Schema.String,
    value: Schema.Number,
  }),
});
export type EvalRunSummary = typeof EvalRunSummarySchema.Type;

export const EvalRunSchema = Schema.Struct({
  id: Schema.String,
  suiteId: Schema.String,
  timestamp: Schema.DateFromSelf,
  agentConfig: Schema.String,
  results: Schema.Array(EvalResultSchema),
  summary: EvalRunSummarySchema,
});
export type EvalRun = typeof EvalRunSchema.Type;
```

## Error Types

### File: `src/errors/errors.ts`

```typescript
// File: src/errors/errors.ts
import { Data } from "effect";

export class EvalError extends Data.TaggedError("EvalError")<{
  readonly message: string;
  readonly caseId?: string;
  readonly cause?: unknown;
}> {}

export class BenchmarkError extends Data.TaggedError("BenchmarkError")<{
  readonly message: string;
  readonly suiteId: string;
}> {}

export type EvalErrors = EvalError | BenchmarkError;
```

## Services

### File: `src/services/eval-service.ts`

The shipped EvalService uses a `makeEvalServiceLive` factory that optionally accepts an `EvalStore`
for SQLite persistence. Each dimension scorer is a separate module that takes a captured LLM instance.

```typescript
// File: src/services/eval-service.ts
import { Context, Effect, Layer, Ref } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { EvalSuite, EvalCase } from "../types/eval-case.js";
import type { EvalRun, EvalResult, EvalRunSummary, DimensionScore } from "../types/eval-result.js";
import type { EvalConfig } from "../types/config.js";
import { DEFAULT_EVAL_CONFIG } from "../types/config.js";
import { EvalError, BenchmarkError } from "../errors/errors.js";
import type { EvalStore } from "./eval-store.js";

export class EvalService extends Context.Tag("EvalService")<
  EvalService,
  {
    readonly runSuite: (
      suite: EvalSuite,
      agentConfig: string,
      config?: Partial<EvalConfig>,
    ) => Effect.Effect<EvalRun, BenchmarkError>;

    readonly runCase: (
      evalCase: EvalCase,
      agentConfig: string,
      dimensions: readonly string[],
      actualOutput: string,
      metrics?: { latencyMs?: number; costUsd?: number; tokensUsed?: number; stepsExecuted?: number },
    ) => Effect.Effect<EvalResult, EvalError>;

    readonly compare: (
      runA: EvalRun,
      runB: EvalRun,
    ) => Effect.Effect<{
      improved: string[];
      regressed: string[];
      unchanged: string[];
    }>;

    readonly checkRegression: (
      current: EvalRun,
      baseline: EvalRun,
      threshold?: number,
    ) => Effect.Effect<{ hasRegression: boolean; details: string[] }>;

    readonly getHistory: (
      suiteId: string,
      options?: { limit?: number },
    ) => Effect.Effect<readonly EvalRun[]>;
  }
>() {}

/**
 * Create EvalServiceLive with optional persistent store.
 * When a store is provided, runs are persisted to SQLite and history is loaded from disk.
 */
export const makeEvalServiceLive = (store?: EvalStore) =>
  Layer.effect(
    EvalService,
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const historyRef = yield* Ref.make<EvalRun[]>([]);

      return {
        runSuite: (suite, agentConfig, configOverride) =>
          Effect.gen(function* () {
            const config = { ...DEFAULT_EVAL_CONFIG, ...configOverride };
            // Score each case across all dimensions using LLM-as-judge
            // Persist to store if available
            // Return EvalRun with summary
          }),

        runCase: (evalCase, agentConfig, dimensions, actualOutput, metrics) =>
          Effect.gen(function* () {
            // Score each dimension, compute overall score
            // cost-efficiency dimension uses quality-per-dollar (no LLM call)
          }),

        compare: (runA, runB) => /* dimension-level delta comparison (>0.02 threshold) */,

        checkRegression: (current, baseline, threshold) =>
          /* per-dimension + overall regression check */,

        getHistory: (suiteId, options) =>
          /* load from store if available, else from in-memory Ref */,
      };
    }),
  );

/** EvalServiceLive without persistence (in-memory only). */
export const EvalServiceLive = makeEvalServiceLive();

/** Convenience layer with SQLite persistence. */
export const makeEvalServicePersistentLive = (dbPath?: string) => {
  const { createEvalStore } = require("./eval-store.js");
  return makeEvalServiceLive(createEvalStore(dbPath));
};
```

### File: `src/services/eval-store.ts`

```typescript
// File: src/services/eval-store.ts
// SQLite-backed persistence for eval runs using bun:sqlite
// Stores runs as JSON blobs keyed by suiteId + runId
// Provides: saveRun(), loadHistory(), loadRun()
```

### File: `src/runtime.ts`

```typescript
// File: src/runtime.ts
import { Layer } from "effect";
import { EvalServiceLive } from "./services/eval-service.js";

/**
 * Provides: EvalService
 * Requires: LLMService (from Layer 1.5)
 */
export const createEvalLayer = () => EvalServiceLive;
```

### Package Config

```json
{
  "name": "@reactive-agents/eval",
  "version": "0.4.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:^",
    "@reactive-agents/llm-provider": "workspace:^"
  }
}
```

---

# Package 3: `@reactive-agents/prompts`

## Package Structure

```
@reactive-agents/prompts/
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── template.ts               # PromptTemplate, CompiledPrompt schemas
│   │   └── config.ts                 # PromptConfig schema
│   ├── errors/
│   │   └── errors.ts                 # PromptError, TemplateNotFoundError
│   ├── services/
│   │   ├── prompt-service.ts         # PromptService Context.Tag + Live Layer
│   │   └── template-engine.ts        # Variable interpolation logic
│   ├── templates/
│   │   ├── reasoning/                # Built-in reasoning prompt templates
│   │   │   ├── react.ts
│   │   │   ├── plan-execute.ts
│   │   │   ├── tree-of-thought.ts
│   │   │   └── reflexion.ts
│   │   └── verification/
│   │       └── fact-check.ts
│   └── runtime.ts                    # createPromptLayer factory
├── tests/
├── package.json
└── tsconfig.json
```

## Build Order

1. `src/types/template.ts` — PromptTemplate, PromptVariable, CompiledPrompt schemas
2. `src/errors/errors.ts` — PromptError, TemplateNotFoundError
3. `src/services/template-engine.ts` — variable interpolation + Handlebars-lite
4. `src/templates/reasoning/react.ts` — built-in ReAct prompt
5. `src/templates/reasoning/plan-execute.ts` — built-in PlanExecute prompt
6. `src/templates/reasoning/tree-of-thought.ts` — built-in ToT prompt
7. `src/templates/reasoning/reflexion.ts` — built-in Reflexion prompt
8. `src/templates/verification/fact-check.ts` — built-in fact-check prompt
9. `src/services/prompt-service.ts` — PromptService + PromptServiceLive
10. `src/runtime.ts` — createPromptLayer factory
11. `src/index.ts` — Public re-exports
12. Tests

## Core Types

### File: `src/types/template.ts`

```typescript
// File: src/types/template.ts
import { Schema } from "effect";

export const PromptVariableType = Schema.Literal(
  "string",
  "number",
  "boolean",
  "array",
  "object",
);
export type PromptVariableType = typeof PromptVariableType.Type;

export const PromptVariableSchema = Schema.Struct({
  name: Schema.String,
  required: Schema.Boolean,
  type: PromptVariableType,
  description: Schema.optional(Schema.String),
  defaultValue: Schema.optional(Schema.Unknown),
});
export type PromptVariable = typeof PromptVariableSchema.Type;

export const PromptTemplateSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  template: Schema.String,
  variables: Schema.Array(PromptVariableSchema),
  metadata: Schema.optional(
    Schema.Struct({
      author: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
      tags: Schema.optional(Schema.Array(Schema.String)),
      model: Schema.optional(Schema.String),
      maxTokens: Schema.optional(Schema.Number),
    }),
  ),
});
export type PromptTemplate = typeof PromptTemplateSchema.Type;

export const CompiledPromptSchema = Schema.Struct({
  templateId: Schema.String,
  version: Schema.Number,
  content: Schema.String,
  tokenEstimate: Schema.Number,
  variables: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type CompiledPrompt = typeof CompiledPromptSchema.Type;
```

## Error Types

### File: `src/errors/errors.ts`

```typescript
// File: src/errors/errors.ts
import { Data } from "effect";

export class PromptError extends Data.TaggedError("PromptError")<{
  readonly message: string;
  readonly templateId?: string;
  readonly cause?: unknown;
}> {}

export class TemplateNotFoundError extends Data.TaggedError(
  "TemplateNotFoundError",
)<{
  readonly templateId: string;
  readonly version?: number;
}> {}

export class VariableError extends Data.TaggedError("VariableError")<{
  readonly templateId: string;
  readonly variableName: string;
  readonly message: string;
}> {}

export type PromptErrors = PromptError | TemplateNotFoundError | VariableError;
```

## Services

### File: `src/services/prompt-service.ts`

```typescript
// File: src/services/prompt-service.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { PromptTemplate, CompiledPrompt } from "../types/template.js";
import {
  PromptError,
  TemplateNotFoundError,
  VariableError,
} from "../errors/errors.js";

export class PromptService extends Context.Tag("PromptService")<
  PromptService,
  {
    readonly register: (template: PromptTemplate) => Effect.Effect<void>;

    readonly compile: (
      templateId: string,
      variables: Record<string, unknown>,
      options?: { maxTokens?: number },
    ) => Effect.Effect<CompiledPrompt, TemplateNotFoundError | VariableError>;

    readonly compose: (
      prompts: readonly CompiledPrompt[],
      options?: { separator?: string; maxTokens?: number },
    ) => Effect.Effect<CompiledPrompt>;

    readonly getVersion: (
      templateId: string,
      version: number,
    ) => Effect.Effect<PromptTemplate, TemplateNotFoundError>;

    readonly getVersionHistory: (
      templateId: string,
    ) => Effect.Effect<readonly PromptTemplate[]>;
  }
>() {}

export const PromptServiceLive = Layer.effect(
  PromptService,
  Effect.gen(function* () {
    // Keyed by "templateId:version"
    const templatesRef = yield* Ref.make<Map<string, PromptTemplate>>(
      new Map(),
    );
    // Latest version per template
    const latestRef = yield* Ref.make<Map<string, number>>(new Map());

    return {
      register: (template) =>
        Effect.gen(function* () {
          const key = `${template.id}:${template.version}`;
          yield* Ref.update(templatesRef, (m) => {
            const n = new Map(m);
            n.set(key, template);
            return n;
          });
          yield* Ref.update(latestRef, (m) => {
            const n = new Map(m);
            const current = n.get(template.id) ?? 0;
            if (template.version > current)
              n.set(template.id, template.version);
            return n;
          });
        }),

      compile: (templateId, variables, options) =>
        Effect.gen(function* () {
          const latest = yield* Ref.get(latestRef);
          const version = latest.get(templateId);
          if (version == null) {
            return yield* Effect.fail(
              new TemplateNotFoundError({ templateId }),
            );
          }

          const templates = yield* Ref.get(templatesRef);
          const template = templates.get(`${templateId}:${version}`)!;

          // Validate required variables
          for (const v of template.variables) {
            if (
              v.required &&
              !(v.name in variables) &&
              v.defaultValue === undefined
            ) {
              return yield* Effect.fail(
                new VariableError({
                  templateId,
                  variableName: v.name,
                  message: "Required variable missing",
                }),
              );
            }
          }

          // Interpolate variables
          let content = template.template;
          for (const [key, value] of Object.entries(variables)) {
            content = content.replaceAll(`{{${key}}}`, String(value));
          }

          // Fill defaults for missing optional variables
          for (const v of template.variables) {
            if (
              !v.required &&
              !(v.name in variables) &&
              v.defaultValue !== undefined
            ) {
              content = content.replaceAll(
                `{{${v.name}}}`,
                String(v.defaultValue),
              );
            }
          }

          // Rough token estimate: ~4 chars per token
          const tokenEstimate = Math.ceil(content.length / 4);

          return {
            templateId,
            version,
            content:
              options?.maxTokens && tokenEstimate > options.maxTokens
                ? content.slice(0, options.maxTokens * 4)
                : content,
            tokenEstimate: Math.min(
              tokenEstimate,
              options?.maxTokens ?? tokenEstimate,
            ),
            variables,
          };
        }),

      compose: (prompts, options) =>
        Effect.succeed({
          templateId: "composed",
          version: 1,
          content: prompts
            .map((p) => p.content)
            .join(options?.separator ?? "\n\n"),
          tokenEstimate: prompts.reduce((s, p) => s + p.tokenEstimate, 0),
          variables: {},
        }),

      getVersion: (templateId, version) =>
        Effect.gen(function* () {
          const templates = yield* Ref.get(templatesRef);
          const template = templates.get(`${templateId}:${version}`);
          if (!template)
            return yield* Effect.fail(
              new TemplateNotFoundError({ templateId, version }),
            );
          return template;
        }),

      getVersionHistory: (templateId) =>
        Ref.get(templatesRef).pipe(
          Effect.map((m) =>
            Array.from(m.values())
              .filter((t) => t.id === templateId)
              .sort((a, b) => a.version - b.version),
          ),
        ),
    };
  }),
);
```

### File: `src/runtime.ts`

```typescript
// File: src/runtime.ts
import { Layer } from "effect";
import { PromptServiceLive } from "./services/prompt-service.js";

/**
 * Provides: PromptService
 * Requires: None (standalone)
 */
export const createPromptLayer = () => PromptServiceLive;
```

### Package Config

```json
{
  "name": "@reactive-agents/prompts",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*"
  }
}
```

---

# Extension 4: Agent Self-Improvement (add to `@reactive-agents/reasoning`)

Add `AgentLearningService` to `@reactive-agents/reasoning` package.

### File: `src/services/agent-learning.ts` (new file in reasoning package)

```typescript
// File: src/services/agent-learning.ts
import { Context, Effect, Layer, Ref, Schema } from "effect";

export const ExecutionOutcomeSchema = Schema.Struct({
  taskId: Schema.String,
  agentId: Schema.String,
  taskType: Schema.String,
  strategy: Schema.String,
  tools: Schema.Array(Schema.String),
  success: Schema.Boolean,
  qualityScore: Schema.optional(Schema.Number),
  latencyMs: Schema.Number,
  costUsd: Schema.Number,
  stepsExecuted: Schema.Number,
  timestamp: Schema.DateFromSelf,
});
export type ExecutionOutcome = typeof ExecutionOutcomeSchema.Type;

export const LearnedPreferenceSchema = Schema.Struct({
  taskType: Schema.String,
  preferredStrategy: Schema.String,
  strategyConfidence: Schema.Number,
  avgQualityScore: Schema.Number,
  avgCostUsd: Schema.Number,
  sampleSize: Schema.Number,
  lastUpdated: Schema.DateFromSelf,
});
export type LearnedPreference = typeof LearnedPreferenceSchema.Type;

export class AgentLearningService extends Context.Tag("AgentLearningService")<
  AgentLearningService,
  {
    readonly recordOutcome: (outcome: ExecutionOutcome) => Effect.Effect<void>;
    readonly recommendStrategy: (taskType: string) => Effect.Effect<{
      strategy: string;
      confidence: number;
      avgScore: number;
      sampleSize: number;
    } | null>;
    readonly getTrends: (agentId: string) => Effect.Effect<{
      qualityTrend: number;
      costTrend: number;
      successRate: number;
      totalExecutions: number;
    }>;
  }
>() {}

export const AgentLearningServiceLive = Layer.effect(
  AgentLearningService,
  Effect.gen(function* () {
    const outcomesRef = yield* Ref.make<ExecutionOutcome[]>([]);
    const prefsRef = yield* Ref.make<Map<string, LearnedPreference>>(new Map());

    return {
      recordOutcome: (outcome) =>
        Effect.gen(function* () {
          yield* Ref.update(outcomesRef, (list) => [...list, outcome]);

          // Update learned preference for this task type
          yield* Ref.update(prefsRef, (prefs) => {
            const next = new Map(prefs);
            const existing = next.get(outcome.taskType);
            if (!existing) {
              next.set(outcome.taskType, {
                taskType: outcome.taskType,
                preferredStrategy: outcome.strategy,
                strategyConfidence: outcome.success ? 0.6 : 0.4,
                avgQualityScore:
                  outcome.qualityScore ?? (outcome.success ? 0.8 : 0.3),
                avgCostUsd: outcome.costUsd,
                sampleSize: 1,
                lastUpdated: new Date(),
              });
            } else {
              const n = existing.sampleSize;
              const newScore =
                outcome.qualityScore ?? (outcome.success ? 0.8 : 0.3);
              const avgScore =
                (existing.avgQualityScore * n + newScore) / (n + 1);
              next.set(outcome.taskType, {
                ...existing,
                // Only update preferred strategy if new one performs better
                preferredStrategy:
                  newScore > existing.avgQualityScore
                    ? outcome.strategy
                    : existing.preferredStrategy,
                strategyConfidence: Math.min(
                  1.0,
                  existing.strategyConfidence + 0.05,
                ),
                avgQualityScore: avgScore,
                avgCostUsd:
                  (existing.avgCostUsd * n + outcome.costUsd) / (n + 1),
                sampleSize: n + 1,
                lastUpdated: new Date(),
              });
            }
            return next;
          });
        }),

      recommendStrategy: (taskType) =>
        Ref.get(prefsRef).pipe(
          Effect.map((prefs) => {
            const pref = prefs.get(taskType);
            if (!pref || pref.sampleSize < 3) return null;
            return {
              strategy: pref.preferredStrategy,
              confidence: pref.strategyConfidence,
              avgScore: pref.avgQualityScore,
              sampleSize: pref.sampleSize,
            };
          }),
        ),

      getTrends: (agentId) =>
        Ref.get(outcomesRef).pipe(
          Effect.map((outcomes) => {
            const agentOutcomes = outcomes.filter((o) => o.agentId === agentId);
            const total = agentOutcomes.length;
            if (total === 0)
              return {
                qualityTrend: 0,
                costTrend: 0,
                successRate: 0,
                totalExecutions: 0,
              };
            const successRate =
              agentOutcomes.filter((o) => o.success).length / total;
            return {
              qualityTrend: 0,
              costTrend: 0,
              successRate,
              totalExecutions: total,
            };
          }),
        ),
    };
  }),
);
```

---

# Extension 5: Context Window Manager

> **NOTE:** `ContextWindowManager` is already defined in `@reactive-agents/core` (see `layer-01-core-detailed-design.md` Step 12). The implementation below is the **reference spec** for that core service. Do **not** create a second copy — it ships as part of `@reactive-agents/core`.

### File: `src/services/context-window-manager.ts` (in `@reactive-agents/core`)

```typescript
// File: src/services/context-window-manager.ts
import { Context, Effect, Layer, Schema } from "effect";
import { Data } from "effect";

export class ContextError extends Data.TaggedError("ContextError")<{
  readonly message: string;
}> {}

export const ContextItemSchema = Schema.Struct({
  content: Schema.String,
  tokenCount: Schema.Number,
  priority: Schema.Number,
  recency: Schema.Number,
  relevance: Schema.Number,
  type: Schema.Literal("system", "task", "memory", "tool-result", "history"),
});
export type ContextItem = typeof ContextItemSchema.Type;

export class ContextWindowManager extends Context.Tag("ContextWindowManager")<
  ContextWindowManager,
  {
    /** Build an optimized context within a token budget. */
    readonly buildContext: (params: {
      readonly items: readonly ContextItem[];
      readonly maxTokens: number;
      readonly reserveForOutput: number;
    }) => Effect.Effect<{
      selected: readonly ContextItem[];
      totalTokens: number;
      truncated: boolean;
    }>;

    /** Prioritize items for context inclusion. */
    readonly prioritize: (
      items: readonly ContextItem[],
      budget: number,
    ) => Effect.Effect<readonly ContextItem[]>;
  }
>() {}

export const ContextWindowManagerLive = Layer.succeed(ContextWindowManager, {
  buildContext: (params) =>
    Effect.sync(() => {
      const budget = params.maxTokens - params.reserveForOutput;
      // Sort by composite score: priority * 0.5 + recency * 0.3 + relevance * 0.2
      const sorted = [...params.items].sort((a, b) => {
        const scoreA = a.priority * 0.5 + a.recency * 0.3 + a.relevance * 0.2;
        const scoreB = b.priority * 0.5 + b.recency * 0.3 + b.relevance * 0.2;
        return scoreB - scoreA;
      });

      const selected: ContextItem[] = [];
      let used = 0;
      for (const item of sorted) {
        if (used + item.tokenCount <= budget) {
          selected.push(item);
          used += item.tokenCount;
        }
      }

      return {
        selected,
        totalTokens: used,
        truncated: selected.length < params.items.length,
      };
    }),

  prioritize: (items, budget) =>
    Effect.sync(() => {
      const sorted = [...items].sort((a, b) => {
        const scoreA = a.priority * 0.5 + a.recency * 0.3 + a.relevance * 0.2;
        const scoreB = b.priority * 0.5 + b.recency * 0.3 + b.relevance * 0.2;
        return scoreB - scoreA;
      });
      let used = 0;
      return sorted.filter((item) => {
        if (used + item.tokenCount <= budget) {
          used += item.tokenCount;
          return true;
        }
        return false;
      });
    }),
});
```

---

# Extension 6: Streaming Service (add to `@reactive-agents/core`)

> **Scope clarification:** `LLMService.stream()` (from `@reactive-agents/llm-provider`) handles raw LLM token streaming.
> `StreamingService` (below) is a **higher-level agent event bus** that publishes structured lifecycle events
> (thinking, action, verification, state-change, cost-update, etc.) as an `Effect.Stream` so UIs, dashboards,
> and the interaction layer can subscribe to real-time agent progress. It is built **on top of** EventBus events
> and does **not** duplicate LLM streaming.

### File: `src/services/streaming-service.ts` (new file in core package)

```typescript
// File: src/services/streaming-service.ts
import { Context, Effect, Layer, Ref, Schema, Stream, Queue } from "effect";
import { Data } from "effect";

export class StreamError extends Data.TaggedError("StreamError")<{
  readonly message: string;
  readonly agentId?: string;
}> {}

export const AgentStreamEventType = Schema.Literal(
  "thinking",
  "action",
  "action-result",
  "verification",
  "output-chunk",
  "state-change",
  "mode-change",
  "checkpoint",
  "error",
  "complete",
  "cost-update",
);
export type AgentStreamEventType = typeof AgentStreamEventType.Type;

export const AgentStreamEventSchema = Schema.Struct({
  type: AgentStreamEventType,
  agentId: Schema.String,
  content: Schema.Unknown,
  timestamp: Schema.DateFromSelf,
});
export type AgentStreamEvent = typeof AgentStreamEventSchema.Type;

export class StreamingService extends Context.Tag("StreamingService")<
  StreamingService,
  {
    /** Publish an event to an agent's stream. */
    readonly publish: (
      agentId: string,
      event: { type: AgentStreamEventType; content: unknown },
    ) => Effect.Effect<void>;

    /** Subscribe to an agent's event stream. Returns a Stream of events. */
    readonly subscribe: (
      agentId: string,
      filter?: readonly AgentStreamEventType[],
    ) => Effect.Effect<Stream.Stream<AgentStreamEvent, never>>;
  }
>() {}

export const StreamingServiceLive = Layer.effect(
  StreamingService,
  Effect.gen(function* () {
    // Per-agent queues for event distribution
    const queuesRef = yield* Ref.make<
      Map<string, Queue.Queue<AgentStreamEvent>>
    >(new Map());

    const getOrCreateQueue = (agentId: string) =>
      Effect.gen(function* () {
        const queues = yield* Ref.get(queuesRef);
        const existing = queues.get(agentId);
        if (existing) return existing;

        const queue = yield* Queue.unbounded<AgentStreamEvent>();
        yield* Ref.update(queuesRef, (m) => {
          const n = new Map(m);
          n.set(agentId, queue);
          return n;
        });
        return queue;
      });

    return {
      publish: (agentId, event) =>
        Effect.gen(function* () {
          const queue = yield* getOrCreateQueue(agentId);
          yield* Queue.offer(queue, {
            type: event.type,
            agentId,
            content: event.content,
            timestamp: new Date(),
          });
        }),

      subscribe: (agentId, filter) =>
        Effect.gen(function* () {
          const queue = yield* getOrCreateQueue(agentId);
          const stream = Stream.fromQueue(queue);
          if (filter && filter.length > 0) {
            return Stream.filter(stream, (e) => filter.includes(e.type));
          }
          return stream;
        }),
    };
  }),
);
```

---

# Extension 7: CLI (`@reactive-agents/cli`)

The CLI is **not an Effect service layer** — it's a Bun-based command-line tool. Spec is intentionally lighter (no Schema/Layer.effect needed for CLI commands).

## Package Structure

```
apps/cli/
├── src/
│   ├── index.ts                  # CLI entry point (uses Bun.argv)
│   ├── commands/
│   │   ├── init.ts               # `reactive-agents init <name> --template <t>`
│   │   ├── create-agent.ts       # `reactive-agents create agent <name>`
│   │   ├── dev.ts                # `reactive-agents dev` (dev server)
│   │   ├── eval.ts               # `reactive-agents eval run --suite <s>`
│   │   ├── playground.ts         # `reactive-agents playground` (interactive REPL)
│   │   └── inspect.ts            # `reactive-agents inspect <agent-id>`
│   ├── templates/
│   │   ├── project/              # Project scaffolding templates
│   │   │   ├── minimal/          # Core + LLM only
│   │   │   ├── standard/         # Core + Memory + Reasoning + Tools
│   │   │   └── full/             # All layers
│   │   └── agent/                # Agent file templates
│   └── generators/
│       ├── project-generator.ts  # Generates monorepo structure
│       └── agent-generator.ts    # Generates agent definition file
├── package.json
└── tsconfig.json
```

## Build Order

1. `src/templates/project/` — Project template files (tsconfig, package.json, example agent)
2. `src/templates/agent/` — Agent definition file templates
3. `src/generators/project-generator.ts` — File generation logic
4. `src/generators/agent-generator.ts` — Agent file generation
5. `src/commands/init.ts` — `reactive-agents init` command
6. `src/commands/create-agent.ts` — `reactive-agents create agent` command
7. `src/commands/dev.ts` — Dev server with file watching
8. `src/commands/eval.ts` — Eval runner CLI wrapper
9. `src/commands/playground.ts` — Interactive REPL
10. `src/commands/inspect.ts` — Agent state inspection
11. `src/index.ts` — CLI router (command dispatch)
12. Tests

## Key Commands

```bash
# Create project
bunx reactive-agents init my-project --template standard

# Create agent
bunx reactive-agents create agent research-agent --recipe researcher

# Dev server
bun run dev  # Starts server + dashboard + playground

# Run evals
bunx reactive-agents eval run --suite my-suite

# Inspect agent
bunx reactive-agents inspect research-agent --trace last
```

### Package Config

```json
{
  "name": "@reactive-agents/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "reactive-agents": "src/index.ts" },
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*"
  }
}
```

---

## Integration Map

| Enhancement      | Integrates With                         | How                                                       |
| ---------------- | --------------------------------------- | --------------------------------------------------------- |
| Guardrails       | L3 Reasoning, L8 Tools, L10 Interaction | Wraps agent execution pipeline via `guarded()` helper     |
| Eval             | L9 Observability, L3 Reasoning, CLI     | Uses tracing data; evals run via CLI or programmatically  |
| Prompts          | L3 Reasoning, L4 Verification, L1.5 LLM | All strategies use PromptService for template compilation |
| Self-Improvement | L3 Reasoning, L5 Cost, L9 Observability | Records outcomes; feeds into strategy selection           |
| Context Window   | L1 Core, L1.5 LLM                       | Called before every LLM invocation to optimize context    |
| Streaming        | L1 Core, L10 Interaction                | Event stream foundation for real-time UI features         |
| CLI              | All packages                            | Scaffolds projects, runs evals, inspects agents           |

## Updated Competitive Advantage Count

**13 unique advantages** (no other framework has these):

1. Multi-strategy reasoning with AI selection
2. 5-layer hallucination verification
3. Cost-first architecture (10x reduction target)
4. Zettelkasten agentic memory
5. Certificate-based agent identity
6. Multi-modal adaptive interaction (5 modes)
7. Agent behavioral contracts & guardrails
8. Built-in LLM-as-judge evaluation with 5 dimensions + EvalStore persistence
9. CLI, playground, and scaffolding
10. Versioned prompt engineering system
11. Cross-task self-improvement loop
12. Context window intelligence
13. Full-stack streaming architecture

---

**Status: Implementation-Ready**
**Phase 2 (P0):** Guardrails + Eval (Weeks 5-8)
**Phase 3 (P1):** Prompts + CLI + Self-Improvement (Weeks 9-12)
**Phase 3 (P2):** Context Window + Streaming (Weeks 11-14)
