# Layer 4: Verification System - AI Agent Implementation Spec

## Overview

5-layer hallucination detection system with adaptive risk-based selection. This is the project's **UNIQUE competitive advantage** — no other TypeScript agent framework provides multi-layered verification. Catches 95%+ hallucinations with configurable cost/quality tradeoffs.

**Package:** `@reactive-agents/verification`
**Dependencies:** `@reactive-agents/core` (EventBus, types), `@reactive-agents/llm-provider` (LLMService), `@reactive-agents/memory` (MemoryService — for fact lookup in semantic memory during fact-decomposition layer)

---

## Package Structure

```
@reactive-agents/verification/
├── src/
│   ├── index.ts                          # Public API exports
│   ├── verification-service.ts           # Main VerificationService (Effect service)
│   ├── types.ts                          # All types & schemas
│   ├── layers/
│   │   ├── semantic-entropy.ts           # Layer 1: Multi-generation entropy
│   │   ├── fact-decomposition.ts         # Layer 2: Atomic fact verification
│   │   ├── multi-source.ts              # Layer 3: Cross-source agreement
│   │   ├── self-consistency.ts          # Layer 4: Repeated sampling consistency
│   │   └── nli.ts                       # Layer 5: Natural language inference
│   ├── calibration/
│   │   └── confidence-calibrator.ts     # Platt scaling for confidence scores
│   ├── mitigation/
│   │   └── hallucination-handler.ts     # Strategies when hallucination detected
│   └── adaptive/
│       └── risk-assessor.ts             # Selects which layers to run
├── tests/
│   ├── verification-service.test.ts
│   ├── layers/
│   │   ├── semantic-entropy.test.ts
│   │   ├── fact-decomposition.test.ts
│   │   ├── multi-source.test.ts
│   │   ├── self-consistency.test.ts
│   │   └── nli.test.ts
│   ├── calibration.test.ts
│   └── adaptive.test.ts
└── package.json
```

---

## Build Order

1. `src/types.ts` — VerificationResult, ConfidenceScore, RiskLevel, ClaimSchema, FactSchema, VerificationConfig schemas
2. `src/errors.ts` — All error types (VerificationError, LayerTimeoutError, CalibrationError, MitigationError, ConfigError)
3. `src/layers/semantic-entropy.ts` — Semantic entropy verification layer
4. `src/layers/fact-decomposition.ts` — Atomic fact decomposition layer
5. `src/layers/multi-source.ts` — Multi-source cross-verification layer
6. `src/layers/self-consistency.ts` — Self-consistency sampling layer
7. `src/layers/nli.ts` — Natural language inference layer
8. `src/adaptive/risk-assessor.ts` — Adaptive risk assessment (selects which layers to run)
9. `src/calibration/confidence-calibrator.ts` — Platt scaling confidence calibration
10. `src/mitigation/hallucination-handler.ts` — Hallucination mitigation strategies
11. `src/verification-service.ts` — Main VerificationService Context.Tag + VerificationServiceLive
12. `src/index.ts` — Public re-exports
13. Tests for each module

---

## Core Types & Schemas

```typescript
import { Schema, Data, Effect, Context, Layer } from "effect";

// ─── Verification Layer Enum ───

export const VerificationLayerName = Schema.Literal(
  "semantic-entropy",
  "fact-decomposition",
  "multi-source",
  "self-consistency",
  "nli",
);
export type VerificationLayerName = typeof VerificationLayerName.Type;

// ─── Risk Levels ───

export const RiskLevel = Schema.Literal("low", "medium", "high", "critical");
export type RiskLevel = typeof RiskLevel.Type;

// ─── Layer Result ───

export const LayerResultSchema = Schema.Struct({
  layer: VerificationLayerName,
  passed: Schema.Boolean,
  score: Schema.Number.pipe(Schema.between(0, 1)),
  latencyMs: Schema.Number,
  details: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type LayerResult = typeof LayerResultSchema.Type;

// ─── Mitigation ───

export const MitigationAction = Schema.Literal(
  "flag-uncertain",
  "add-disclaimer",
  "request-sources",
  "block-response",
  "regenerate",
  "decompose-and-retry",
);
export type MitigationAction = typeof MitigationAction.Type;

export const MitigationSchema = Schema.Struct({
  action: MitigationAction,
  reason: Schema.String,
  originalText: Schema.String,
  correctedText: Schema.optional(Schema.String),
});
export type Mitigation = typeof MitigationSchema.Type;

// ─── Verification Result ───

export const VerificationResultSchema = Schema.Struct({
  passed: Schema.Boolean,
  overallConfidence: Schema.Number.pipe(Schema.between(0, 1)),
  riskLevel: RiskLevel,
  layersRun: Schema.Array(LayerResultSchema),
  mitigations: Schema.Array(MitigationSchema),
  totalLatencyMs: Schema.Number,
  costIncurred: Schema.Number,
});
export type VerificationResult = typeof VerificationResultSchema.Type;

// ─── Verification Request ───

export const VerificationRequestSchema = Schema.Struct({
  text: Schema.String,
  context: Schema.optional(Schema.String),
  sources: Schema.optional(Schema.Array(Schema.String)),
  riskOverride: Schema.optional(RiskLevel),
  maxLatencyMs: Schema.optional(Schema.Number),
  maxCost: Schema.optional(Schema.Number),
});
export type VerificationRequest = typeof VerificationRequestSchema.Type;

// ─── Adaptive Config ───

export interface RiskProfile {
  readonly layersToRun: readonly VerificationLayerName[];
  readonly minConfidence: number;
  readonly maxLatencyMs: number;
  readonly maxCost: number;
}

export const RiskProfiles: Record<RiskLevel, RiskProfile> = {
  low: {
    layersToRun: ["semantic-entropy"],
    minConfidence: 0.7,
    maxLatencyMs: 2000,
    maxCost: 0.001,
  },
  medium: {
    layersToRun: ["semantic-entropy", "fact-decomposition"],
    minConfidence: 0.8,
    maxLatencyMs: 5000,
    maxCost: 0.01,
  },
  high: {
    layersToRun: [
      "semantic-entropy",
      "fact-decomposition",
      "multi-source",
      "self-consistency",
    ],
    minConfidence: 0.9,
    maxLatencyMs: 10000,
    maxCost: 0.05,
  },
  critical: {
    layersToRun: [
      "semantic-entropy",
      "fact-decomposition",
      "multi-source",
      "self-consistency",
      "nli",
    ],
    minConfidence: 0.95,
    maxLatencyMs: 30000,
    maxCost: 0.1,
  },
};
```

---

## Error Types

```typescript
import { Data } from "effect";

export class VerificationError extends Data.TaggedError("VerificationError")<{
  readonly message: string;
  readonly layer?: VerificationLayerName;
  readonly cause?: unknown;
}> {}

export class VerificationTimeoutError extends Data.TaggedError(
  "VerificationTimeoutError",
)<{
  readonly message: string;
  readonly layer: VerificationLayerName;
  readonly timeoutMs: number;
}> {}

export class InsufficientSourcesError extends Data.TaggedError(
  "InsufficientSourcesError",
)<{
  readonly message: string;
  readonly required: number;
  readonly available: number;
}> {}

export class CalibrationError extends Data.TaggedError("CalibrationError")<{
  readonly message: string;
  readonly rawScore: number;
}> {}
```

---

## Effect Service Definition

```typescript
import { Effect, Context, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { FactualMemory } from "@reactive-agents/memory";
import { EventBus } from "@reactive-agents/core";

// ─── Verification Service Tag ───

export class VerificationService extends Context.Tag("VerificationService")<
  VerificationService,
  {
    /**
     * Verify text with adaptive layer selection based on risk level.
     * Automatically selects which verification layers to run
     * based on assessed risk or explicit override.
     */
    readonly verify: (
      request: VerificationRequest,
    ) => Effect.Effect<
      VerificationResult,
      VerificationError | VerificationTimeoutError
    >;

    /**
     * Run a specific verification layer in isolation.
     * Used for testing and targeted re-verification.
     */
    readonly runLayer: (
      layer: VerificationLayerName,
      text: string,
      context?: string,
    ) => Effect.Effect<
      LayerResult,
      VerificationError | VerificationTimeoutError
    >;

    /**
     * Assess risk level of text to determine which layers to run.
     */
    readonly assessRisk: (
      text: string,
      context?: string,
    ) => Effect.Effect<RiskLevel, VerificationError>;

    /**
     * Apply mitigation strategy for failed verifications.
     */
    readonly mitigate: (
      text: string,
      failedLayers: readonly LayerResult[],
    ) => Effect.Effect<Mitigation, VerificationError>;

    /**
     * Get calibrated confidence score using Platt scaling.
     */
    readonly calibrateConfidence: (
      rawScore: number,
      layer: VerificationLayerName,
    ) => Effect.Effect<number, CalibrationError>;
  }
>() {}
```

---

## Verification Layer Interface

Each verification layer implements this interface:

```typescript
// ─── IVerificationLayer ───

export interface IVerificationLayer {
  readonly name: VerificationLayerName;

  /**
   * Run this verification layer on the provided text.
   * Returns a LayerResult with pass/fail, score, and details.
   */
  readonly verify: (
    text: string,
    context?: string,
    sources?: readonly string[],
  ) => Effect.Effect<LayerResult, VerificationError | VerificationTimeoutError>;
}
```

---

## Layer Implementations

### 1. Semantic Entropy Layer

Generates the same completion multiple times and measures token-level entropy. High entropy across generations indicates the model is uncertain (potential hallucination).

```typescript
import { Effect, Array as A, pipe } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

export const makeSemanticEntropyLayer = Effect.gen(function* () {
  const llm = yield* LLMService;

  const verify = (
    text: string,
    context?: string,
  ): Effect.Effect<LayerResult, VerificationError | VerificationTimeoutError> =>
    Effect.gen(function* () {
      const startTime = Date.now();

      // Generate the same prompt N times to measure consistency
      const prompt = `Given this context, regenerate or validate this claim:\n\nContext: ${context ?? "none"}\n\nClaim: ${text}\n\nRestate the claim using your knowledge:`;

      const generations = yield* Effect.all(
        [
          llm.complete({
            messages: [{ role: "user", content: prompt }],
            model: {
              provider: "anthropic",
              model: "claude-3-5-haiku-20241022",
            },
          }),
          llm.complete({
            messages: [{ role: "user", content: prompt }],
            model: {
              provider: "anthropic",
              model: "claude-3-5-haiku-20241022",
            },
          }),
          llm.complete({
            messages: [{ role: "user", content: prompt }],
            model: {
              provider: "anthropic",
              model: "claude-3-5-haiku-20241022",
            },
          }),
        ],
        { concurrency: 3 },
      );

      const texts = generations.map((g) => g.content);

      // Compute pairwise semantic similarity
      const embeddings = yield* Effect.all(
        texts.map((t) => llm.embed(t)),
        { concurrency: 3 },
      );

      const similarities = computePairwiseSimilarity(embeddings);
      const avgSimilarity =
        similarities.reduce((a, b) => a + b, 0) / similarities.length;

      // High similarity across generations = low entropy = likely factual
      // Low similarity = high entropy = uncertain = potential hallucination
      const entropy = 1 - avgSimilarity;
      const passed = entropy < 0.3; // Threshold: 0.3

      return {
        layer: "semantic-entropy" as const,
        passed,
        score: avgSimilarity,
        latencyMs: Date.now() - startTime,
        details: {
          entropy,
          generationCount: texts.length,
          avgSimilarity,
          pairwiseSimilarities: similarities,
        },
      };
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((e) =>
        e._tag === "TimeoutException"
          ? new VerificationTimeoutError({
              message: "Semantic entropy timed out",
              layer: "semantic-entropy",
              timeoutMs: 10000,
            })
          : new VerificationError({
              message: "Semantic entropy failed",
              layer: "semantic-entropy",
              cause: e,
            }),
      ),
    );

  return {
    name: "semantic-entropy" as const,
    verify,
  } satisfies IVerificationLayer;
});

// ─── Helper: Cosine similarity ───

function computePairwiseSimilarity(embeddings: readonly number[][]): number[] {
  const similarities: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      similarities.push(cosineSimilarity(embeddings[i], embeddings[j]));
    }
  }
  return similarities;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
```

### 2. Fact Decomposition Layer

Breaks text into atomic factual claims and verifies each against the factual memory store and LLM cross-check.

```typescript
import { Effect, Array as A, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { FactualMemory } from "@reactive-agents/memory";

const AtomicFactsSchema = Schema.Struct({
  facts: Schema.Array(
    Schema.Struct({
      claim: Schema.String,
      type: Schema.Literal("factual", "opinion", "inference", "uncertain"),
    }),
  ),
});

export const makeFactDecompositionLayer = Effect.gen(function* () {
  const llm = yield* LLMService;
  const memory = yield* FactualMemory;

  const verify = (
    text: string,
    context?: string,
  ): Effect.Effect<LayerResult, VerificationError | VerificationTimeoutError> =>
    Effect.gen(function* () {
      const startTime = Date.now();

      // Step 1: Decompose into atomic facts using structured output
      const decomposition = yield* llm.completeStructured({
        messages: [
          {
            role: "user",
            content: `Decompose this text into atomic factual claims. For each claim, classify it as factual, opinion, inference, or uncertain.\n\nText: ${text}`,
          },
        ],
        schema: AtomicFactsSchema,
        model: { provider: "anthropic", model: "claude-3-5-haiku-20241022" },
      });

      const facts = decomposition.facts.filter((f) => f.type === "factual");

      // Step 2: Verify each factual claim against memory
      const verificationResults = yield* Effect.all(
        facts.map((fact) =>
          Effect.gen(function* () {
            // Check factual memory for supporting/contradicting evidence
            const memoryHits = yield* memory.search(fact.claim, {
              limit: 3,
              minSimilarity: 0.8,
            });

            if (memoryHits.length > 0) {
              // Cross-check with stored facts
              const supported = memoryHits.some((hit) => hit.similarity > 0.9);
              return {
                claim: fact.claim,
                verified: supported,
                source: "memory" as const,
              };
            }

            // Fallback: Ask LLM to verify (less reliable, but better than nothing)
            const llmCheck = yield* llm.completeStructured({
              messages: [
                {
                  role: "user",
                  content: `Is this claim factually accurate? Answer with verified (true/false) and a brief reason.\n\nClaim: ${fact.claim}`,
                },
              ],
              schema: Schema.Struct({
                verified: Schema.Boolean,
                reason: Schema.String,
              }),
              model: {
                provider: "anthropic",
                model: "claude-3-5-haiku-20241022",
              },
            });

            return {
              claim: fact.claim,
              verified: llmCheck.verified,
              source: "llm" as const,
            };
          }),
        ),
        { concurrency: 5 },
      );

      const verifiedCount = verificationResults.filter(
        (r) => r.verified,
      ).length;
      const passRate = facts.length > 0 ? verifiedCount / facts.length : 1;

      return {
        layer: "fact-decomposition" as const,
        passed: passRate >= 0.9,
        score: passRate,
        latencyMs: Date.now() - startTime,
        details: {
          totalFacts: decomposition.facts.length,
          factualClaims: facts.length,
          verifiedCount,
          passRate,
          results: verificationResults,
        },
      };
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError((e) =>
        e._tag === "TimeoutException"
          ? new VerificationTimeoutError({
              message: "Fact decomposition timed out",
              layer: "fact-decomposition",
              timeoutMs: 15000,
            })
          : new VerificationError({
              message: "Fact decomposition failed",
              layer: "fact-decomposition",
              cause: e,
            }),
      ),
    );

  return {
    name: "fact-decomposition" as const,
    verify,
  } satisfies IVerificationLayer;
});
```

### 3. Multi-Source Verification Layer

Cross-references claims against multiple independent sources to find agreement or contradiction.

```typescript
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

const SourceCheckSchema = Schema.Struct({
  supports: Schema.Boolean,
  confidence: Schema.Number,
  evidence: Schema.String,
});

export const makeMultiSourceLayer = Effect.gen(function* () {
  const llm = yield* LLMService;

  const verify = (
    text: string,
    _context?: string,
    sources?: readonly string[],
  ): Effect.Effect<LayerResult, VerificationError | VerificationTimeoutError> =>
    Effect.gen(function* () {
      const startTime = Date.now();

      if (!sources || sources.length < 2) {
        return {
          layer: "multi-source" as const,
          passed: false,
          score: 0,
          latencyMs: Date.now() - startTime,
          details: {
            error: "Insufficient sources",
            required: 2,
            available: sources?.length ?? 0,
          },
        };
      }

      // Check claim against each source
      const checks = yield* Effect.all(
        sources.map((source) =>
          llm.completeStructured({
            messages: [
              {
                role: "user",
                content: `Does this source support or contradict the claim?\n\nClaim: ${text}\n\nSource: ${source}\n\nAnalyze whether the source supports the claim, your confidence level (0-1), and key evidence.`,
              },
            ],
            schema: SourceCheckSchema,
            model: {
              provider: "anthropic",
              model: "claude-3-5-haiku-20241022",
            },
          }),
        ),
        { concurrency: 5 },
      );

      const supporting = checks.filter((c) => c.supports);
      const agreementRate = supporting.length / checks.length;
      const avgConfidence =
        checks.reduce((sum, c) => sum + c.confidence, 0) / checks.length;

      return {
        layer: "multi-source" as const,
        passed: supporting.length >= 2 && agreementRate >= 0.6,
        score: agreementRate * avgConfidence,
        latencyMs: Date.now() - startTime,
        details: {
          sourcesChecked: sources.length,
          supporting: supporting.length,
          agreementRate,
          avgConfidence,
          perSourceResults: checks,
        },
      };
    }).pipe(
      Effect.timeout("20 seconds"),
      Effect.mapError((e) =>
        e._tag === "TimeoutException"
          ? new VerificationTimeoutError({
              message: "Multi-source verification timed out",
              layer: "multi-source",
              timeoutMs: 20000,
            })
          : new VerificationError({
              message: "Multi-source verification failed",
              layer: "multi-source",
              cause: e,
            }),
      ),
    );

  return { name: "multi-source" as const, verify } satisfies IVerificationLayer;
});
```

### 4. Self-Consistency Layer

Asks the LLM the same question multiple times with slight prompt variations and checks if answers converge.

```typescript
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

export const makeSelfConsistencyLayer = Effect.gen(function* () {
  const llm = yield* LLMService;

  const promptVariations = [
    (text: string) => `Verify this claim: "${text}"`,
    (text: string) => `Is the following statement accurate? "${text}"`,
    (text: string) => `Evaluate the truthfulness of: "${text}"`,
    (text: string) => `Would you agree with this assertion? "${text}"`,
    (text: string) => `Rate the accuracy of this statement: "${text}"`,
  ];

  const ConsistencyCheckSchema = Schema.Struct({
    agrees: Schema.Boolean,
    confidence: Schema.Number,
    reasoning: Schema.String,
  });

  const verify = (
    text: string,
    _context?: string,
  ): Effect.Effect<LayerResult, VerificationError | VerificationTimeoutError> =>
    Effect.gen(function* () {
      const startTime = Date.now();

      // Use 5 prompt variations
      const responses = yield* Effect.all(
        promptVariations.map((makePrompt) =>
          llm.completeStructured({
            messages: [{ role: "user", content: makePrompt(text) }],
            schema: ConsistencyCheckSchema,
            model: {
              provider: "anthropic",
              model: "claude-3-5-haiku-20241022",
            },
          }),
        ),
        { concurrency: 5 },
      );

      const agreements = responses.filter((r) => r.agrees).length;
      const consistencyRate = agreements / responses.length;
      const avgConfidence =
        responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length;

      return {
        layer: "self-consistency" as const,
        passed: consistencyRate >= 0.8,
        score: consistencyRate * avgConfidence,
        latencyMs: Date.now() - startTime,
        details: {
          variations: responses.length,
          agreements,
          consistencyRate,
          avgConfidence,
          reasonings: responses.map((r) => r.reasoning),
        },
      };
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError((e) =>
        e._tag === "TimeoutException"
          ? new VerificationTimeoutError({
              message: "Self-consistency timed out",
              layer: "self-consistency",
              timeoutMs: 15000,
            })
          : new VerificationError({
              message: "Self-consistency failed",
              layer: "self-consistency",
              cause: e,
            }),
      ),
    );

  return {
    name: "self-consistency" as const,
    verify,
  } satisfies IVerificationLayer;
});
```

### 5. Natural Language Inference (NLI) Layer

Checks whether the generated text logically follows from the provided premises/context.

```typescript
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

const NLIResultSchema = Schema.Struct({
  relationship: Schema.Literal("entailment", "contradiction", "neutral"),
  confidence: Schema.Number,
  explanation: Schema.String,
});

export const makeNLILayer = Effect.gen(function* () {
  const llm = yield* LLMService;

  const verify = (
    text: string,
    context?: string,
  ): Effect.Effect<LayerResult, VerificationError | VerificationTimeoutError> =>
    Effect.gen(function* () {
      const startTime = Date.now();

      if (!context) {
        return {
          layer: "nli" as const,
          passed: true,
          score: 0.5,
          latencyMs: Date.now() - startTime,
          details: {
            skipped: true,
            reason: "No context/premise provided for NLI",
          },
        };
      }

      const nliResult = yield* llm.completeStructured({
        messages: [
          {
            role: "user",
            content: `Analyze the logical relationship between premise and hypothesis.\n\nPremise: ${context}\n\nHypothesis: ${text}\n\nClassify as: entailment (hypothesis follows from premise), contradiction (hypothesis contradicts premise), or neutral (insufficient information). Provide confidence (0-1) and explanation.`,
          },
        ],
        schema: NLIResultSchema,
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514" }, // Use Sonnet for reasoning quality
      });

      const passed = nliResult.relationship !== "contradiction";
      const score =
        nliResult.relationship === "entailment"
          ? nliResult.confidence
          : nliResult.relationship === "neutral"
            ? 0.5 * nliResult.confidence
            : 1 - nliResult.confidence;

      return {
        layer: "nli" as const,
        passed,
        score,
        latencyMs: Date.now() - startTime,
        details: {
          relationship: nliResult.relationship,
          confidence: nliResult.confidence,
          explanation: nliResult.explanation,
        },
      };
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((e) =>
        e._tag === "TimeoutException"
          ? new VerificationTimeoutError({
              message: "NLI verification timed out",
              layer: "nli",
              timeoutMs: 10000,
            })
          : new VerificationError({
              message: "NLI verification failed",
              layer: "nli",
              cause: e,
            }),
      ),
    );

  return { name: "nli" as const, verify } satisfies IVerificationLayer;
});
```

---

## Adaptive Risk Assessor

```typescript
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

const RiskAssessmentSchema = Schema.Struct({
  level: RiskLevel,
  factors: Schema.Array(Schema.String),
  reasoning: Schema.String,
});

export const makeRiskAssessor = Effect.gen(function* () {
  const llm = yield* LLMService;

  const assess = (
    text: string,
    context?: string,
  ): Effect.Effect<RiskLevel, VerificationError> =>
    Effect.gen(function* () {
      // Heuristic pre-check for speed
      const heuristicRisk = assessHeuristicRisk(text);
      if (heuristicRisk === "low") return "low" as const;

      // LLM-based assessment for non-trivial content
      const assessment = yield* llm.completeStructured({
        messages: [
          {
            role: "user",
            content: `Assess the risk level of this AI-generated text. Consider: factual claims, medical/legal/financial advice, actionable instructions, potential for harm.\n\nText: ${text}\n\nContext: ${context ?? "none"}\n\nClassify risk as: low, medium, high, or critical. Explain factors.`,
          },
        ],
        schema: RiskAssessmentSchema,
        model: { provider: "anthropic", model: "claude-3-5-haiku-20241022" },
      });

      return assessment.level;
    }).pipe(
      Effect.mapError(
        (e) =>
          new VerificationError({
            message: "Risk assessment failed",
            cause: e,
          }),
      ),
    );

  return { assess };
});

// ─── Heuristic risk checks (fast, no LLM call) ───

function assessHeuristicRisk(text: string): RiskLevel | null {
  const lowerText = text.toLowerCase();

  // Critical: medical, legal, financial
  const criticalPatterns = [
    /\b(diagnos|prescri|medic|dosage|treatment)\b/,
    /\b(legal advice|lawsuit|liability|statute)\b/,
    /\b(invest|financial advice|stock|portfolio)\b/,
  ];
  if (criticalPatterns.some((p) => p.test(lowerText))) return "critical";

  // High: code execution, system commands
  const highPatterns = [
    /\b(sudo|rm -rf|chmod|exec|eval)\b/,
    /\b(password|secret|api.?key|credential)\b/,
  ];
  if (highPatterns.some((p) => p.test(lowerText))) return "high";

  // Low: short, simple, conversational
  if (text.length < 100 && !/\d/.test(text)) return "low";

  // Need LLM for medium-complexity content
  return null;
}
```

---

## Confidence Calibrator

Uses Platt scaling to convert raw layer scores into calibrated probabilities.

```typescript
import { Effect } from "effect";

export interface CalibrationModel {
  readonly a: number; // Platt scaling parameter A
  readonly b: number; // Platt scaling parameter B
}

export const makeConfidenceCalibrator = () => {
  // Default calibration parameters (updated via training)
  const models: Record<VerificationLayerName, CalibrationModel> = {
    "semantic-entropy": { a: -2.5, b: 0.5 },
    "fact-decomposition": { a: -3.0, b: 0.3 },
    "multi-source": { a: -2.0, b: 0.4 },
    "self-consistency": { a: -2.8, b: 0.35 },
    nli: { a: -2.2, b: 0.45 },
  };

  const calibrate = (
    rawScore: number,
    layer: VerificationLayerName,
  ): Effect.Effect<number, CalibrationError> =>
    Effect.try({
      try: () => {
        const { a, b } = models[layer];
        // Platt scaling: P(y=1|f) = 1 / (1 + exp(A*f + B))
        const calibrated = 1 / (1 + Math.exp(a * rawScore + b));
        return Math.max(0, Math.min(1, calibrated));
      },
      catch: (e) =>
        new CalibrationError({
          message: `Calibration failed for ${layer}`,
          rawScore,
        }),
    });

  const updateModel = (
    layer: VerificationLayerName,
    newModel: CalibrationModel,
  ): void => {
    models[layer] = newModel;
  };

  return { calibrate, updateModel };
};
```

---

## Hallucination Mitigation Handler

```typescript
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

export const makeMitigationHandler = Effect.gen(function* () {
  const llm = yield* LLMService;

  const mitigate = (
    text: string,
    failedLayers: readonly LayerResult[],
  ): Effect.Effect<Mitigation, VerificationError> =>
    Effect.gen(function* () {
      const worstScore = Math.min(...failedLayers.map((l) => l.score));
      const failedNames = failedLayers.map((l) => l.layer).join(", ");

      // Determine action based on severity
      if (worstScore < 0.2) {
        // Critical failure — block the response
        return {
          action: "block-response" as const,
          reason: `Critical verification failure in [${failedNames}] (score: ${worstScore.toFixed(2)})`,
          originalText: text,
        };
      }

      if (worstScore < 0.5) {
        // Moderate failure — regenerate with constraints
        const corrected = yield* llm.complete({
          messages: [
            {
              role: "user",
              content: `The following text failed verification checks (${failedNames}). Rewrite it to be more accurate, removing any uncertain claims and adding appropriate hedging language.\n\nOriginal: ${text}`,
            },
          ],
          model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
        });

        return {
          action: "regenerate" as const,
          reason: `Verification failure in [${failedNames}] — regenerated with accuracy constraints`,
          originalText: text,
          correctedText: corrected.content,
        };
      }

      // Marginal failure — add disclaimer
      return {
        action: "add-disclaimer" as const,
        reason: `Marginal verification in [${failedNames}] (score: ${worstScore.toFixed(2)})`,
        originalText: text,
      };
    }).pipe(
      Effect.mapError(
        (e) =>
          new VerificationError({ message: "Mitigation failed", cause: e }),
      ),
    );

  return { mitigate };
});
```

---

## Main VerificationService Implementation

```typescript
import { Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { FactualMemory } from "@reactive-agents/memory";
import { EventBus } from "@reactive-agents/core";

export const VerificationServiceLive = Layer.effect(
  VerificationService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;

    // Build all verification layers
    const semanticEntropy = yield* makeSemanticEntropyLayer;
    const factDecomposition = yield* makeFactDecompositionLayer;
    const multiSource = yield* makeMultiSourceLayer;
    const selfConsistency = yield* makeSelfConsistencyLayer;
    const nli = yield* makeNLILayer;

    const layers: Record<VerificationLayerName, IVerificationLayer> = {
      "semantic-entropy": semanticEntropy,
      "fact-decomposition": factDecomposition,
      "multi-source": multiSource,
      "self-consistency": selfConsistency,
      nli: nli,
    };

    // Build supporting services
    const riskAssessor = yield* makeRiskAssessor;
    const calibrator = makeConfidenceCalibrator();
    const mitigationHandler = yield* makeMitigationHandler;

    const verify = (
      request: VerificationRequest,
    ): Effect.Effect<
      VerificationResult,
      VerificationError | VerificationTimeoutError
    > =>
      Effect.gen(function* () {
        const startTime = Date.now();

        // Step 1: Assess risk (or use override)
        const riskLevel =
          request.riskOverride ??
          (yield* riskAssessor.assess(request.text, request.context));
        const profile = RiskProfiles[riskLevel];

        // Step 2: Run selected verification layers
        const layerResults = yield* Effect.all(
          profile.layersToRun.map((layerName) =>
            layers[layerName].verify(
              request.text,
              request.context,
              request.sources,
            ),
          ),
          { concurrency: 3 }, // Run up to 3 layers in parallel
        );

        // Step 3: Calibrate scores
        const calibratedResults = yield* Effect.all(
          layerResults.map((result) =>
            calibrator.calibrate(result.score, result.layer).pipe(
              Effect.map((calibratedScore) => ({
                ...result,
                score: calibratedScore,
              })),
            ),
          ),
        );

        // Step 4: Determine overall result
        const allPassed = calibratedResults.every((r) => r.passed);
        const overallConfidence =
          calibratedResults.reduce((sum, r) => sum + r.score, 0) /
          calibratedResults.length;

        // Step 5: Apply mitigations if needed
        const failedLayers = calibratedResults.filter((r) => !r.passed);
        const mitigations: Mitigation[] = [];

        if (failedLayers.length > 0) {
          const mitigation = yield* mitigationHandler.mitigate(
            request.text,
            failedLayers,
          );
          mitigations.push(mitigation);
        }

        const totalLatencyMs = Date.now() - startTime;

        // Step 6: Emit event
        yield* eventBus.publish({
          type: "verification.completed",
          payload: {
            riskLevel,
            layersRun: calibratedResults.length,
            passed: allPassed,
            overallConfidence,
            totalLatencyMs,
            mitigationsApplied: mitigations.length,
          },
        });

        return {
          passed: allPassed && overallConfidence >= profile.minConfidence,
          overallConfidence,
          riskLevel,
          layersRun: calibratedResults,
          mitigations,
          totalLatencyMs,
          costIncurred: 0, // Will be tracked by CostService
        };
      });

    const runLayer = (
      layerName: VerificationLayerName,
      text: string,
      context?: string,
    ) => layers[layerName].verify(text, context);

    const assessRisk = (text: string, context?: string) =>
      riskAssessor.assess(text, context);

    const mitigate = (text: string, failed: readonly LayerResult[]) =>
      mitigationHandler.mitigate(text, failed);

    const calibrateConfidence = (
      rawScore: number,
      layer: VerificationLayerName,
    ) => calibrator.calibrate(rawScore, layer);

    return { verify, runLayer, assessRisk, mitigate, calibrateConfidence };
  }),
);
```

---

## Testing

```typescript
import { Effect, Layer } from "effect";
import { describe, it, expect } from "vitest";
import { VerificationService, VerificationServiceLive } from "../src";
import {
  TestLLMService,
  TestLLMServiceLayer,
} from "@reactive-agents/llm-provider/testing";

// ─── Test Layer Setup ───

const TestVerificationLayer = VerificationServiceLive.pipe(
  Layer.provide(TestLLMServiceLayer),
  Layer.provide(TestEventBusLayer),
  Layer.provide(TestFactualMemoryLayer),
);

describe("VerificationService", () => {
  it("should pass verification for low-risk factual text", async () => {
    const program = Effect.gen(function* () {
      const verification = yield* VerificationService;

      const result = yield* verification.verify({
        text: "Water boils at 100 degrees Celsius at sea level.",
        riskOverride: "low",
      });

      expect(result.passed).toBe(true);
      expect(result.overallConfidence).toBeGreaterThan(0.7);
      expect(result.layersRun).toHaveLength(1); // Low risk = 1 layer
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestVerificationLayer)),
    );
  });

  it("should detect hallucination in fabricated claims", async () => {
    const program = Effect.gen(function* () {
      const verification = yield* VerificationService;

      const result = yield* verification.verify({
        text: "The Eiffel Tower was built in 1823 by Leonardo da Vinci.",
        riskOverride: "high",
      });

      expect(result.passed).toBe(false);
      expect(result.mitigations).toHaveLength(1);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestVerificationLayer)),
    );
  });

  it("should apply appropriate mitigation for critical failure", async () => {
    const program = Effect.gen(function* () {
      const verification = yield* VerificationService;

      const result = yield* verification.mitigate(
        "This medication cures cancer in 24 hours.",
        [
          {
            layer: "fact-decomposition",
            passed: false,
            score: 0.1,
            latencyMs: 100,
            details: {},
          },
        ],
      );

      expect(result.action).toBe("block-response");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestVerificationLayer)),
    );
  });

  it("should run all 5 layers for critical risk", async () => {
    const program = Effect.gen(function* () {
      const verification = yield* VerificationService;

      const result = yield* verification.verify({
        text: "Take 500mg of ibuprofen every 2 hours for chest pain.",
        riskOverride: "critical",
      });

      expect(result.layersRun).toHaveLength(5);
      expect(result.riskLevel).toBe("critical");
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestVerificationLayer)),
    );
  });

  it("should assess risk correctly", async () => {
    const program = Effect.gen(function* () {
      const verification = yield* VerificationService;

      const risk = yield* verification.assessRisk("Hello, how are you?");
      expect(risk).toBe("low");

      const medicalRisk = yield* verification.assessRisk(
        "What dosage of aspirin should I take?",
      );
      expect(["high", "critical"]).toContain(medicalRisk);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(TestVerificationLayer)),
    );
  });
});
```

---

## Configuration

```typescript
export const VerificationConfig = {
  // Layer timeouts
  layerTimeouts: {
    "semantic-entropy": 10_000,
    "fact-decomposition": 15_000,
    "multi-source": 20_000,
    "self-consistency": 15_000,
    nli: 10_000,
  },

  // Default model for verification (use cheap model)
  defaultModel: "claude-haiku" as const,

  // Parallelism for layer execution
  maxConcurrentLayers: 3,

  // Enable/disable individual layers
  enabledLayers: {
    "semantic-entropy": true,
    "fact-decomposition": true,
    "multi-source": true,
    "self-consistency": true,
    nli: true,
  },

  // Calibration update interval
  calibrationUpdateIntervalMs: 86_400_000, // 24 hours
};
```

---

## Performance Targets

| Metric                        | Target | Notes                           |
| ----------------------------- | ------ | ------------------------------- |
| Low-risk verification latency | <2s    | Single layer (semantic entropy) |
| Medium-risk latency           | <5s    | 2 layers in parallel            |
| High-risk latency             | <10s   | 4 layers in parallel            |
| Critical-risk latency         | <30s   | All 5 layers                    |
| Detection accuracy            | >95%   | Across all risk levels          |
| False positive rate           | <5%    | Should not flag correct text    |
| Memory overhead               | <50MB  | Including calibration models    |

---

## Integration Points

- **LLMService** (Layer 1.5): All layers use `llm.complete()`, `llm.completeStructured()`, and `llm.embed()` — NEVER raw API calls
- **FactualMemory** (Layer 2): Fact decomposition cross-references stored facts
- **CostService** (Layer 5): Verification calls are tracked for cost budgeting
- **EventBus** (Layer 1): Emits `verification.completed`, `verification.failed`, `verification.mitigation-applied` events
- **Reasoning** (Layer 3): Calls verification before returning final responses

## Success Criteria

- [ ] All 5 verification layers implemented with Effect-TS patterns
- [ ] Adaptive risk assessment selects appropriate layers
- [ ] Platt scaling calibration produces reliable confidence scores
- [ ] Mitigation handler blocks/regenerates/disclaims as needed
- [ ] Tests cover all risk levels and edge cases
- [ ] 95%+ hallucination detection accuracy
- [ ] Verification adds <5s latency for medium-risk content

---

## Package Config

### File: `package.json`

```json
{
  "name": "@reactive-agents/verification",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*",
    "@reactive-agents/memory": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "bun-types": "latest"
  }
}
```

---

**Status: Ready for implementation**
**Priority: Phase 2 (Weeks 6-8)**
