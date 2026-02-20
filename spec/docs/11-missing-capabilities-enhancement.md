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

## Package Structure

```
@reactive-agents/guardrails/
├── src/
│   ├── index.ts                      # Public API re-exports
│   ├── types/
│   │   ├── contract.ts               # AgentContract schema
│   │   ├── policy.ts                 # Policy, GuardrailDecision schemas
│   │   ├── result.ts                 # GuardrailResult schema
│   │   └── config.ts                 # GuardrailConfig schema + defaults
│   ├── errors/
│   │   └── errors.ts                 # Data.TaggedError definitions
│   ├── detectors/
│   │   ├── prompt-injection.ts       # Heuristic + LLM prompt injection detection
│   │   ├── pii-detector.ts           # PII regex detection + redaction
│   │   ├── content-filter.ts         # Toxicity / harmful content (LLM-based)
│   │   └── scope-enforcer.ts         # Ensure output matches task scope
│   ├── services/
│   │   ├── policy-engine.ts          # PolicyEngine Context.Tag + Live Layer
│   │   ├── contract-enforcer.ts      # ContractEnforcer Context.Tag + Live Layer
│   │   └── guardrail-service.ts      # GuardrailService Context.Tag + Live Layer
│   └── runtime.ts                    # createGuardrailLayer factory
├── tests/
│   ├── prompt-injection.test.ts
│   ├── pii-detector.test.ts
│   ├── policy-engine.test.ts
│   └── guardrail-service.test.ts
├── package.json
└── tsconfig.json
```

## Build Order

1. `src/types/contract.ts` — AgentContract schema (capabilities, prohibitions, limits, content policy)
2. `src/types/policy.ts` — Policy, GuardrailDecision, PolicyPhase schemas
3. `src/types/result.ts` — GuardrailResult schema
4. `src/types/config.ts` — GuardrailConfig with default policies
5. `src/errors/errors.ts` — GuardrailError, ContractViolationError, PolicyViolationError
6. `src/detectors/prompt-injection.ts` — heuristic regex patterns + LLM fallback
7. `src/detectors/pii-detector.ts` — regex patterns for email, phone, SSN, CC, API keys
8. `src/detectors/content-filter.ts` — LLM-based toxicity scoring
9. `src/detectors/scope-enforcer.ts` — check output relevance to task
10. `src/services/policy-engine.ts` — PolicyEngine + PolicyEngineLive (evaluates policies)
11. `src/services/contract-enforcer.ts` — ContractEnforcer + ContractEnforcerLive (enforces contracts)
12. `src/services/guardrail-service.ts` — GuardrailService + GuardrailServiceLive (orchestrates check pipeline)
13. `src/runtime.ts` — createGuardrailLayer factory
14. `src/index.ts` — Public re-exports
15. Tests

## Core Types

### File: `src/types/contract.ts`

```typescript
// File: src/types/contract.ts
import { Schema } from "effect";

export const AgentContractSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  capabilities: Schema.Array(
    Schema.Struct({
      action: Schema.String,
      constraints: Schema.optional(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      ),
    }),
  ),
  prohibitions: Schema.Array(
    Schema.Struct({
      action: Schema.String,
      reason: Schema.String,
    }),
  ),
  limits: Schema.Struct({
    maxLLMCallsPerTask: Schema.optional(Schema.Number),
    maxToolCallsPerTask: Schema.optional(Schema.Number),
    maxCostPerTask: Schema.optional(Schema.Number),
    maxDurationMs: Schema.optional(Schema.Number),
    maxOutputTokens: Schema.optional(Schema.Number),
  }),
  contentPolicy: Schema.Struct({
    allowPII: Schema.optional(Schema.Boolean),
    allowCodeExecution: Schema.optional(Schema.Boolean),
    toxicityThreshold: Schema.optional(Schema.Number),
    requireSourceAttribution: Schema.optional(Schema.Boolean),
  }),
  escalation: Schema.Struct({
    requireApprovalAboveCost: Schema.optional(Schema.Number),
    requireApprovalForActions: Schema.optional(Schema.Array(Schema.String)),
    notifyOnBoundaryViolation: Schema.optional(Schema.Boolean),
  }),
});
export type AgentContract = typeof AgentContractSchema.Type;
```

### File: `src/types/policy.ts`

```typescript
// File: src/types/policy.ts
import { Schema } from "effect";

export const GuardrailDecision = Schema.Literal(
  "allow",
  "block",
  "modify",
  "escalate",
);
export type GuardrailDecision = typeof GuardrailDecision.Type;

export const PolicyPhase = Schema.Literal(
  "input",
  "output",
  "action",
  "always",
);
export type PolicyPhase = typeof PolicyPhase.Type;

export const PolicyCheck = Schema.Literal(
  "prompt-injection",
  "pii",
  "toxicity",
  "scope",
  "resource-limit",
  "cost-limit",
  "action-boundary",
  "content-filter",
  "custom",
);
export type PolicyCheck = typeof PolicyCheck.Type;

export const PolicySeverity = Schema.Literal("info", "warning", "critical");
export type PolicySeverity = typeof PolicySeverity.Type;

export const PolicySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  enabled: Schema.Boolean,
  priority: Schema.Number,
  when: Schema.Struct({
    phase: PolicyPhase,
    agentTypes: Schema.optional(Schema.Array(Schema.String)),
    taskTypes: Schema.optional(Schema.Array(Schema.String)),
  }),
  check: PolicyCheck,
  action: GuardrailDecision,
  config: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type Policy = typeof PolicySchema.Type;
```

### File: `src/types/result.ts`

```typescript
// File: src/types/result.ts
import { Schema } from "effect";
import { GuardrailDecision, PolicySeverity } from "./policy.js";

export const GuardrailResultSchema = Schema.Struct({
  decision: GuardrailDecision,
  guardrail: Schema.String,
  reason: Schema.String,
  severity: PolicySeverity,
  originalContent: Schema.optional(Schema.String),
  modifiedContent: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type GuardrailResult = typeof GuardrailResultSchema.Type;
```

## Error Types

### File: `src/errors/errors.ts`

```typescript
// File: src/errors/errors.ts
import { Data } from "effect";

export class GuardrailError extends Data.TaggedError("GuardrailError")<{
  readonly message: string;
  readonly guardrail: string;
  readonly cause?: unknown;
}> {}

export class ContractViolationError extends Data.TaggedError(
  "ContractViolationError",
)<{
  readonly agentId: string;
  readonly violation: string;
  readonly contractName: string;
}> {}

export class PolicyViolationError extends Data.TaggedError(
  "PolicyViolationError",
)<{
  readonly policyId: string;
  readonly policyName: string;
  readonly reason: string;
  readonly severity: string;
}> {}

export type GuardrailErrors =
  | GuardrailError
  | ContractViolationError
  | PolicyViolationError;
```

## Services

### File: `src/services/policy-engine.ts`

```typescript
// File: src/services/policy-engine.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { Policy, PolicyPhase } from "../types/policy.js";
import type { GuardrailResult } from "../types/result.js";
import { GuardrailError } from "../errors/errors.js";

export class PolicyEngine extends Context.Tag("PolicyEngine")<
  PolicyEngine,
  {
    readonly addPolicy: (policy: Policy) => Effect.Effect<void>;
    readonly removePolicy: (policyId: string) => Effect.Effect<void>;
    readonly evaluate: (params: {
      readonly phase: PolicyPhase;
      readonly content: string;
      readonly context: { agentId: string; taskType?: string };
    }) => Effect.Effect<GuardrailResult, GuardrailError>;
    readonly listPolicies: () => Effect.Effect<readonly Policy[]>;
  }
>() {}

export const PolicyEngineLive = Layer.effect(
  PolicyEngine,
  Effect.gen(function* () {
    const policiesRef = yield* Ref.make<Map<string, Policy>>(new Map());

    return {
      addPolicy: (policy) =>
        Ref.update(policiesRef, (m) => {
          const n = new Map(m);
          n.set(policy.id, policy);
          return n;
        }),

      removePolicy: (policyId) =>
        Ref.update(policiesRef, (m) => {
          const n = new Map(m);
          n.delete(policyId);
          return n;
        }),

      evaluate: (params) =>
        Effect.gen(function* () {
          const policies = yield* Ref.get(policiesRef);
          const applicable = Array.from(policies.values())
            .filter(
              (p) =>
                p.enabled &&
                (p.when.phase === params.phase || p.when.phase === "always"),
            )
            .sort((a, b) => b.priority - a.priority);

          for (const policy of applicable) {
            // Each detector is called based on policy.check
            // Simplified: return first violation found
            // Full implementation delegates to specific detectors
            if (policy.check === "prompt-injection") {
              const isInjection = detectPromptInjectionHeuristic(
                params.content,
              );
              if (isInjection.detected) {
                return {
                  decision: policy.action,
                  guardrail: policy.name,
                  reason: `Prompt injection detected: ${isInjection.technique}`,
                  severity: "critical" as const,
                  originalContent: params.content,
                };
              }
            }

            if (policy.check === "pii") {
              const piiResult = detectPII(params.content);
              if (piiResult.hasPII) {
                return {
                  decision: policy.action,
                  guardrail: policy.name,
                  reason: `PII detected: ${piiResult.types.join(", ")}`,
                  severity: "warning" as const,
                  originalContent: params.content,
                  modifiedContent: piiResult.redacted,
                };
              }
            }
          }

          return {
            decision: "allow" as const,
            guardrail: "none",
            reason: "No policy violations",
            severity: "info" as const,
          };
        }),

      listPolicies: () =>
        Ref.get(policiesRef).pipe(Effect.map((m) => Array.from(m.values()))),
    };
  }),
);

// ─── Inline helpers (used by policy engine) ───

function detectPromptInjectionHeuristic(input: string): {
  detected: boolean;
  technique?: string;
} {
  const patterns = [
    {
      regex: /ignore\s+(previous|above|all)\s+(instructions|prompts)/i,
      technique: "instruction-override",
    },
    { regex: /you\s+are\s+now\s+/i, technique: "role-hijacking" },
    { regex: /system\s*:\s*/i, technique: "system-prompt-injection" },
    {
      regex: /\[INST\]|\[\/INST\]|<\|im_start\|>/i,
      technique: "format-injection",
    },
    {
      regex: /pretend\s+you\s+(are|can|have)/i,
      technique: "persona-manipulation",
    },
  ];
  for (const { regex, technique } of patterns) {
    if (regex.test(input)) return { detected: true, technique };
  }
  return { detected: false };
}

function detectPII(text: string): {
  hasPII: boolean;
  types: string[];
  redacted: string;
} {
  const patterns = [
    {
      type: "email",
      regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      replacement: "[EMAIL]",
    },
    {
      type: "phone",
      regex: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      replacement: "[PHONE]",
    },
    {
      type: "ssn",
      regex: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
      replacement: "[SSN]",
    },
    {
      type: "credit-card",
      regex: /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
      replacement: "[CC]",
    },
    {
      type: "api-key",
      regex: /\b(sk-|pk-|api[_-]?key[_-]?)[a-zA-Z0-9]{20,}\b/gi,
      replacement: "[API_KEY]",
    },
  ];
  let redacted = text;
  const types: string[] = [];
  for (const { type, regex, replacement } of patterns) {
    if (regex.test(text)) {
      types.push(type);
      redacted = redacted.replace(regex, replacement);
    }
  }
  return { hasPII: types.length > 0, types, redacted };
}
```

### File: `src/services/guardrail-service.ts`

```typescript
// File: src/services/guardrail-service.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { AgentContract } from "../types/contract.js";
import type { GuardrailResult } from "../types/result.js";
import { GuardrailError, ContractViolationError } from "../errors/errors.js";
import { PolicyEngine } from "./policy-engine.js";

export class GuardrailService extends Context.Tag("GuardrailService")<
  GuardrailService,
  {
    readonly checkInput: (
      input: string,
      context: { agentId: string; taskType?: string },
    ) => Effect.Effect<GuardrailResult, GuardrailError>;

    readonly checkOutput: (
      output: string,
      context: { agentId: string; taskType?: string; originalInput?: string },
    ) => Effect.Effect<GuardrailResult, GuardrailError>;

    readonly checkAction: (
      action: { tool: string; input: unknown },
      context: { agentId: string; contract: AgentContract },
    ) => Effect.Effect<
      GuardrailResult,
      GuardrailError | ContractViolationError
    >;

    readonly registerContract: (
      agentId: string,
      contract: AgentContract,
    ) => Effect.Effect<void>;

    readonly killAgent: (
      agentId: string,
      reason: string,
    ) => Effect.Effect<void>;

    readonly getViolations: (filter?: {
      agentId?: string;
      severity?: string;
      since?: Date;
    }) => Effect.Effect<readonly GuardrailResult[]>;
  }
>() {}

export const GuardrailServiceLive = Layer.effect(
  GuardrailService,
  Effect.gen(function* () {
    const policyEngine = yield* PolicyEngine;
    const contractsRef = yield* Ref.make<Map<string, AgentContract>>(new Map());
    const violationsRef = yield* Ref.make<GuardrailResult[]>([]);

    return {
      checkInput: (input, context) =>
        policyEngine.evaluate({ phase: "input", content: input, context }),

      checkOutput: (output, context) =>
        policyEngine.evaluate({ phase: "output", content: output, context }),

      checkAction: (action, context) =>
        Effect.gen(function* () {
          // Check if action is prohibited by contract
          const prohibited = context.contract.prohibitions.find(
            (p) => p.action === action.tool,
          );
          if (prohibited) {
            const result: GuardrailResult = {
              decision: "block",
              guardrail: "contract-enforcer",
              reason: `Action "${action.tool}" prohibited: ${prohibited.reason}`,
              severity: "critical",
            };
            yield* Ref.update(violationsRef, (v) => [...v, result]);
            return result;
          }

          // Check resource limits
          return yield* policyEngine.evaluate({
            phase: "action",
            content: JSON.stringify(action),
            context: { agentId: context.agentId },
          });
        }),

      registerContract: (agentId, contract) =>
        Ref.update(contractsRef, (m) => {
          const n = new Map(m);
          n.set(agentId, contract);
          return n;
        }),

      killAgent: (agentId, reason) =>
        Effect.gen(function* () {
          // Publish kill event so the ExecutionEngine and other listeners can halt work
          const eventBus = yield* Effect.serviceOption(
            Context.GenericTag<{
              publish: (event: unknown) => Effect.Effect<void>;
            }>("EventBus"),
          );
          if (eventBus._tag === "Some") {
            yield* eventBus.value.publish({
              _tag: "GuardrailKillAgent",
              agentId,
              reason,
              timestamp: new Date(),
            });
          }
          // Log unconditionally as a safety backstop
          console.error(`[GUARDRAIL KILL] Agent ${agentId}: ${reason}`);
        }),

      getViolations: (filter) =>
        Ref.get(violationsRef).pipe(
          Effect.map((violations) =>
            violations.filter((v) => {
              if (filter?.severity && v.severity !== filter.severity)
                return false;
              return true;
            }),
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
import { PolicyEngineLive } from "./services/policy-engine.js";
import { GuardrailServiceLive } from "./services/guardrail-service.js";

/**
 * Provides: GuardrailService, PolicyEngine
 * Requires: None (standalone)
 */
export const createGuardrailLayer = () => {
  const PolicyLayer = PolicyEngineLive;
  const ServiceLayer = GuardrailServiceLive.pipe(Layer.provide(PolicyLayer));
  return Layer.mergeAll(ServiceLayer, PolicyLayer);
};
```

### `guarded()` Helper

```typescript
// File: src/guarded.ts
// Wrap any agent Effect with guardrail enforcement
import { Effect } from "effect";
import { GuardrailService } from "./services/guardrail-service.js";
import { GuardrailError } from "./errors/errors.js";

export const guarded = <A, E>(
  agentId: string,
  effect: Effect.Effect<A, E>,
  options?: { input?: string; output?: string },
): Effect.Effect<A, E | GuardrailError, GuardrailService> =>
  Effect.gen(function* () {
    const guardrails = yield* GuardrailService;
    if (options?.input) {
      const r = yield* guardrails.checkInput(options.input, { agentId });
      if (r.decision === "block") {
        return yield* Effect.fail(
          new GuardrailError({
            message: `Input blocked: ${r.reason}`,
            guardrail: r.guardrail,
          }),
        );
      }
    }
    const result = yield* effect;
    if (options?.output) {
      const r = yield* guardrails.checkOutput(options.output, { agentId });
      if (r.decision === "block") {
        return yield* Effect.fail(
          new GuardrailError({
            message: `Output blocked: ${r.reason}`,
            guardrail: r.guardrail,
          }),
        );
      }
    }
    return result;
  });
```

### Package Config

```json
{
  "name": "@reactive-agents/guardrails",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*"
  }
}
```

> **Note:** `llm-provider` is required by `content-filter.ts` (LLM-based toxicity scoring) and `scope-enforcer.ts` (LLM-based relevance check). Heuristic-only detectors (`prompt-injection.ts`, `pii-detector.ts`) do not require it. `GuardrailServiceLive` should use `Effect.serviceOption(LLMService)` so the service degrades gracefully (heuristics-only) when no LLM layer is provided.

---

# Package 2: `@reactive-agents/eval`

## Package Structure

```
@reactive-agents/eval/
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── eval-case.ts              # EvalCase, EvalSuite schemas
│   │   ├── eval-result.ts            # EvalResult, DimensionScore, EvalRun schemas
│   │   └── config.ts                 # EvalConfig schema
│   ├── errors/
│   │   └── errors.ts                 # EvalError, BenchmarkError
│   ├── dimensions/
│   │   ├── accuracy.ts               # Accuracy scorer (LLM-as-judge)
│   │   ├── relevance.ts              # Relevance scorer
│   │   ├── completeness.ts           # Completeness scorer
│   │   ├── safety.ts                 # Safety scorer
│   │   └── cost-efficiency.ts        # Cost per quality unit
│   ├── services/
│   │   ├── eval-service.ts           # EvalService Context.Tag + Live Layer
│   │   └── dataset-service.ts        # DatasetService Context.Tag + Live Layer
│   └── runtime.ts                    # createEvalLayer factory
├── tests/
├── package.json
└── tsconfig.json
```

## Build Order

1. `src/types/eval-case.ts` — EvalCase, EvalSuite schemas
2. `src/types/eval-result.ts` — DimensionScore, EvalResult, EvalRun schemas
3. `src/types/config.ts` — EvalConfig schema
4. `src/errors/errors.ts` — EvalError, BenchmarkError
5. `src/dimensions/accuracy.ts` — LLM-as-judge accuracy scorer
6. `src/dimensions/relevance.ts` — relevance scorer
7. `src/dimensions/completeness.ts` — completeness scorer
8. `src/dimensions/safety.ts` — safety scorer
9. `src/dimensions/cost-efficiency.ts` — cost per quality unit
10. `src/services/dataset-service.ts` — DatasetService + DatasetServiceLive
11. `src/services/eval-service.ts` — EvalService + EvalServiceLive
12. `src/runtime.ts` — createEvalLayer factory
13. `src/index.ts` — Public re-exports
14. Tests

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

```typescript
// File: src/services/eval-service.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { EvalSuite, EvalCase } from "../types/eval-case.js";
import type { EvalRun, EvalResult } from "../types/eval-result.js";
import { EvalError } from "../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";

export class EvalService extends Context.Tag("EvalService")<
  EvalService,
  {
    readonly runSuite: (
      suite: EvalSuite,
      agentConfig: string,
    ) => Effect.Effect<EvalRun, EvalError>;

    readonly runCase: (
      evalCase: EvalCase,
      agentConfig: string,
      dimensions: readonly string[],
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
      threshold: number,
    ) => Effect.Effect<{ hasRegression: boolean; details: string[] }>;

    readonly getHistory: (
      suiteId: string,
      options?: { limit?: number },
    ) => Effect.Effect<readonly EvalRun[]>;
  }
>() {}

export const EvalServiceLive = Layer.effect(
  EvalService,
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const historyRef = yield* Ref.make<EvalRun[]>([]);

    return {
      runSuite: (suite, agentConfig) =>
        Effect.gen(function* () {
          const results: EvalResult[] = [];

          for (const evalCase of suite.cases) {
            // Each case is scored by LLM-as-judge across requested dimensions
            const scores = yield* Effect.all(
              suite.dimensions.map((dim) =>
                Effect.tryPromise({
                  try: () =>
                    llm.complete({
                      prompt: `Evaluate the following output on "${dim}" (score 0.0-1.0):\nInput: ${evalCase.input}\nExpected: ${evalCase.expectedOutput ?? "N/A"}\n\nScore (number only):`,
                      maxTokens: 10,
                      temperature: 0.1,
                    }),
                  catch: (err) =>
                    new EvalError({
                      message: `Scoring "${dim}" failed`,
                      caseId: evalCase.id,
                      cause: err,
                    }),
                }).pipe(
                  Effect.map((r) => ({
                    dimension: dim,
                    score: Math.max(
                      0,
                      Math.min(1, parseFloat(r.text.trim()) || 0.5),
                    ),
                  })),
                ),
              ),
            );

            const avg = scores.reduce((s, d) => s + d.score, 0) / scores.length;
            results.push({
              caseId: evalCase.id,
              timestamp: new Date(),
              agentConfig,
              scores,
              overallScore: avg,
              actualOutput: "[evaluated via LLM-as-judge]",
              latencyMs: 0,
              costUsd: 0,
              tokensUsed: 0,
              stepsExecuted: 0,
              passed: avg >= 0.7,
            });
          }

          const run: EvalRun = {
            id: crypto.randomUUID(),
            suiteId: suite.id,
            timestamp: new Date(),
            agentConfig,
            results,
            summary: {
              totalCases: results.length,
              passed: results.filter((r) => r.passed).length,
              failed: results.filter((r) => !r.passed).length,
              avgScore:
                results.reduce((s, r) => s + r.overallScore, 0) /
                results.length,
              avgLatencyMs: 0,
              totalCostUsd: 0,
              dimensionAverages: {} as Record<string, number>,
            },
          };

          yield* Ref.update(historyRef, (h) => [...h, run]);
          return run;
        }),

      runCase: (evalCase, agentConfig, dimensions) =>
        Effect.succeed({
          caseId: evalCase.id,
          timestamp: new Date(),
          agentConfig,
          scores: [],
          overallScore: 0,
          actualOutput: "",
          latencyMs: 0,
          costUsd: 0,
          tokensUsed: 0,
          stepsExecuted: 0,
          passed: false,
        }),

      compare: (runA, runB) =>
        Effect.succeed({
          improved: [] as string[],
          regressed: [] as string[],
          unchanged: [] as string[],
        }),

      checkRegression: (current, baseline, threshold) =>
        Effect.succeed({
          hasRegression:
            current.summary.avgScore < baseline.summary.avgScore - threshold,
          details: [] as string[],
        }),

      getHistory: (suiteId, options) =>
        Ref.get(historyRef).pipe(
          Effect.map((h) =>
            h
              .filter((r) => r.suiteId === suiteId)
              .slice(-(options?.limit ?? 100)),
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
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*"
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
8. Built-in evaluation & benchmarking
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
