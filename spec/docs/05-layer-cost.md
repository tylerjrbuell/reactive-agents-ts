# Layer 5: Cost Optimization - AI Agent Implementation Spec

## Overview

Multi-layered cost optimization system: intelligent model routing, semantic caching, prompt compression, budget enforcement, and real-time cost analytics. Achieves **10x cost reduction** vs naive single-model approaches while maintaining quality.

**Package:** `@reactive-agents/cost`
**Dependencies:** `@reactive-agents/core` (EventBus, types), `@reactive-agents/llm-provider` (LLMService), `@reactive-agents/memory` (for semantic cache storage)

---

## Package Structure

```
@reactive-agents/cost/
├── src/
│   ├── index.ts                          # Public API exports
│   ├── cost-service.ts                   # Main CostService (Effect service)
│   ├── types.ts                          # All types & schemas
│   ├── routing/
│   │   └── complexity-router.ts          # Routes tasks to appropriate model tier
│   ├── caching/
│   │   └── semantic-cache.ts             # Embedding-based cache for LLM responses
│   ├── compression/
│   │   └── prompt-compressor.ts          # Reduces token count while preserving meaning
│   ├── budgets/
│   │   └── budget-enforcer.ts            # Per-agent, per-session, daily/monthly limits
│   └── analytics/
│       └── cost-tracker.ts               # Real-time cost tracking & reporting
├── tests/
│   ├── cost-service.test.ts
│   ├── routing/
│   │   └── complexity-router.test.ts
│   ├── caching/
│   │   └── semantic-cache.test.ts
│   ├── budgets/
│   │   └── budget-enforcer.test.ts
│   └── analytics/
│       └── cost-tracker.test.ts
└── package.json
```

---

## Build Order

1. `src/types.ts` — CostRecord, **ModelCostConfig** (not ModelConfig — avoids collision with llm-provider's ModelConfig), ModelTier, UsageSummary, BudgetConfig, CacheEntry schemas
2. `src/errors.ts` — All error types (CostError, BudgetExceededError, CacheError, RoutingError, CompressionError)
3. `src/routing/complexity-router.ts` — Task complexity analysis + model tier routing
4. `src/caching/semantic-cache.ts` — Embedding-based semantic cache for LLM responses
5. `src/compression/prompt-compressor.ts` — Token count reduction while preserving meaning
6. `src/budgets/budget-enforcer.ts` — Per-agent, per-session, daily/monthly budget enforcement
7. `src/analytics/cost-tracker.ts` — Real-time cost tracking and reporting
8. `src/cost-service.ts` — Main CostService Context.Tag + CostServiceLive
9. `src/index.ts` — Public re-exports
10. Tests for each module

---

## Core Types & Schemas

```typescript
import { Schema, Data, Effect, Context, Layer, Ref } from "effect";

// ─── Model Tier ───

export const ModelTier = Schema.Literal("haiku", "sonnet", "opus");
export type ModelTier = typeof ModelTier.Type;

// ─── Model Cost Configuration ───
// NOTE: Named ModelCostConfig (not ModelConfig) to avoid collision with
// @reactive-agents/llm-provider's ModelConfig (which is a request-time config:
// provider/model/temperature/maxTokens). This type is a routing/cost profile.

export const ModelCostConfigSchema = Schema.Struct({
  tier: ModelTier,
  provider: Schema.Literal("anthropic", "openai", "ollama"),
  model: Schema.String,
  costPer1MInput: Schema.Number,
  costPer1MOutput: Schema.Number,
  maxContext: Schema.Number,
  quality: Schema.Number.pipe(Schema.between(0, 1)),
  speedTokensPerSec: Schema.Number,
});
export type ModelCostConfig = typeof ModelCostConfigSchema.Type;

// ─── Cost Entry ───

export const CostEntrySchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.DateFromSelf,
  agentId: Schema.String,
  sessionId: Schema.String,
  model: Schema.String,
  tier: ModelTier,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cost: Schema.Number,
  cachedHit: Schema.Boolean,
  taskType: Schema.String,
  latencyMs: Schema.Number,
});
export type CostEntry = typeof CostEntrySchema.Type;

// ─── Budget ───

export const BudgetLimitsSchema = Schema.Struct({
  perRequest: Schema.Number,
  perSession: Schema.Number,
  daily: Schema.Number,
  monthly: Schema.Number,
});
export type BudgetLimits = typeof BudgetLimitsSchema.Type;

export const BudgetStatusSchema = Schema.Struct({
  currentSession: Schema.Number,
  currentDaily: Schema.Number,
  currentMonthly: Schema.Number,
  limits: BudgetLimitsSchema,
  percentUsedDaily: Schema.Number,
  percentUsedMonthly: Schema.Number,
});
export type BudgetStatus = typeof BudgetStatusSchema.Type;

// ─── Cost Report ───

export const CostReportSchema = Schema.Struct({
  period: Schema.Literal("session", "daily", "weekly", "monthly"),
  totalCost: Schema.Number,
  totalRequests: Schema.Number,
  cacheHits: Schema.Number,
  cacheMisses: Schema.Number,
  cacheHitRate: Schema.Number,
  savings: Schema.Number, // fromCaching + routing optimizations
  costByTier: Schema.Record({ key: Schema.String, value: Schema.Number }),
  costByAgent: Schema.Record({ key: Schema.String, value: Schema.Number }),
  avgCostPerRequest: Schema.Number,
  avgLatencyMs: Schema.Number,
});
export type CostReport = typeof CostReportSchema.Type;

// ─── Complexity Analysis ───

export const ComplexityAnalysisSchema = Schema.Struct({
  score: Schema.Number.pipe(Schema.between(0, 1)),
  factors: Schema.Array(Schema.String),
  recommendedTier: ModelTier,
  estimatedTokens: Schema.Number,
  estimatedCost: Schema.Number,
});
export type ComplexityAnalysis = typeof ComplexityAnalysisSchema.Type;

// ─── Cache Entry ───

export const CacheEntrySchema = Schema.Struct({
  queryEmbedding: Schema.Array(Schema.Number),
  queryHash: Schema.String,
  response: Schema.String,
  model: Schema.String,
  createdAt: Schema.DateFromSelf,
  hitCount: Schema.Number,
  lastHitAt: Schema.DateFromSelf,
  ttlMs: Schema.Number,
});
export type CacheEntry = typeof CacheEntrySchema.Type;

// ─── Degradation Policy (Vision Pillar: Reliability) ───

export const DegradationLevel = Schema.Literal(
  "normal",
  "reduced",
  "minimal",
  "cache-only",
);
export type DegradationLevel = typeof DegradationLevel.Type;

export const DegradationTriggerSchema = Schema.Struct({
  condition: Schema.Literal("high_cost", "high_latency", "high_error_rate"),
  threshold: Schema.Number,
  level: DegradationLevel,
});

export const DegradationPolicySchema = Schema.Struct({
  triggers: Schema.Array(DegradationTriggerSchema),
});
export type DegradationPolicy = typeof DegradationPolicySchema.Type;

// The CostRouter should evaluate DegradationPolicy before Phase 3 (model routing).
// When degradation level is:
//   "reduced"    → skip verification (Phase 6), use haiku tier
//   "minimal"    → reduce context window by 50%, skip verification
//   "cache-only" → return cached results only, no LLM calls
```

---

## Error Types

```typescript
import { Data } from "effect";

export class BudgetExceededError extends Data.TaggedError(
  "BudgetExceededError",
)<{
  readonly message: string;
  readonly budgetType: "perRequest" | "perSession" | "daily" | "monthly";
  readonly limit: number;
  readonly current: number;
  readonly requested: number;
}> {}

export class CostTrackingError extends Data.TaggedError("CostTrackingError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CacheError extends Data.TaggedError("CacheError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class RoutingError extends Data.TaggedError("RoutingError")<{
  readonly message: string;
  readonly taskComplexity?: number;
}> {}
```

---

## Effect Service Definition

```typescript
import { Effect, Context } from "effect";

export class CostService extends Context.Tag("CostService")<
  CostService,
  {
    /**
     * Route a task to the optimal model tier based on complexity analysis.
     * Returns the recommended model cost configuration.
     */
    readonly routeToModel: (
      task: string,
      context?: string,
    ) => Effect.Effect<ModelCostConfig, RoutingError>;

    /**
     * Check semantic cache before making an LLM call.
     * Returns cached response if a sufficiently similar query was seen before.
     */
    readonly checkCache: (
      query: string,
    ) => Effect.Effect<string | null, CacheError>;

    /**
     * Store a response in the semantic cache for future reuse.
     */
    readonly cacheResponse: (
      query: string,
      response: string,
      model: string,
      ttlMs?: number,
    ) => Effect.Effect<void, CacheError>;

    /**
     * Compress a prompt to reduce token count while preserving meaning.
     * Returns compressed prompt and estimated token savings.
     */
    readonly compressPrompt: (
      prompt: string,
      maxTokens?: number,
    ) => Effect.Effect<
      { compressed: string; savedTokens: number },
      CostTrackingError
    >;

    /**
     * Check if a request is within budget before executing.
     * Throws BudgetExceededError if any limit would be exceeded.
     */
    readonly checkBudget: (
      estimatedCost: number,
      agentId: string,
      sessionId: string,
    ) => Effect.Effect<void, BudgetExceededError>;

    /**
     * Record actual cost of an LLM call after execution.
     */
    readonly recordCost: (
      entry: Omit<CostEntry, "id" | "timestamp">,
    ) => Effect.Effect<void, CostTrackingError>;

    /**
     * Get current budget status for an agent.
     */
    readonly getBudgetStatus: (
      agentId: string,
    ) => Effect.Effect<BudgetStatus, CostTrackingError>;

    /**
     * Generate cost report for a time period.
     */
    readonly getReport: (
      period: "session" | "daily" | "weekly" | "monthly",
      agentId?: string,
    ) => Effect.Effect<CostReport, CostTrackingError>;

    /**
     * Wrap an LLM call with full cost optimization pipeline:
     * 1. Check cache → 2. Route to model → 3. Check budget → 4. Compress → 5. Execute → 6. Cache result → 7. Record cost
     */
    readonly optimizedCall: <A>(
      query: string,
      execute: (
        model: ModelCostConfig,
        compressedQuery: string,
      ) => Effect.Effect<A, unknown>,
      options?: { agentId?: string; sessionId?: string; taskType?: string },
    ) => Effect.Effect<A, BudgetExceededError | CostTrackingError>;
  }
>() {}
```

---

## Complexity Router Implementation

````typescript
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

export const makeComplexityRouter = Effect.gen(function* () {
  const llm = yield* LLMService;

  // ─── Heuristic pre-classification (no LLM call needed) ───

  const heuristicClassify = (task: string): ModelTier | null => {
    const wordCount = task.split(/\s+/).length;
    const hasCodeBlock = /```/.test(task);
    const hasMultiStep = /\b(step|then|next|finally|after|before)\b/i.test(
      task,
    );
    const hasAnalysis =
      /\b(analyze|compare|evaluate|synthesize|critique)\b/i.test(task);

    // Simple tasks < 50 words, no code, no multi-step
    if (wordCount < 50 && !hasCodeBlock && !hasMultiStep && !hasAnalysis) {
      return "haiku";
    }

    // Complex tasks with code, multi-step, or analysis
    if (hasCodeBlock && hasMultiStep && hasAnalysis) {
      return "opus";
    }

    // Need LLM for intermediate cases
    return null;
  };

  // ─── LLM-based complexity analysis ───

  const analyzeComplexity = (
    task: string,
    context?: string,
  ): Effect.Effect<ComplexityAnalysis, RoutingError> =>
    Effect.gen(function* () {
      // Try heuristic first
      const heuristic = heuristicClassify(task);
      if (heuristic) {
        const config = getModelCostConfig(heuristic);
        return {
          score:
            heuristic === "haiku" ? 0.2 : heuristic === "sonnet" ? 0.5 : 0.9,
          factors: ["heuristic-classification"],
          recommendedTier: heuristic,
          estimatedTokens: estimateTokens(task),
          estimatedCost: estimateCost(task, config),
        };
      }

      // LLM-based analysis for ambiguous cases
      const analysis = yield* llm.completeStructured({
        messages: [
          {
            role: "user",
            content: `Analyze the complexity of this task to determine which AI model tier to use.\n\nTask: ${task}\n\nContext: ${context ?? "none"}\n\nScore complexity 0-1 (0=trivial, 1=extremely complex). Recommend tier: haiku (simple), sonnet (moderate), opus (complex). List factors that influenced your decision. Estimate input+output tokens needed.`,
          },
        ],
        schema: ComplexityAnalysisSchema,
        model: { provider: "anthropic", model: "claude-3-5-haiku-20241022" }, // Use cheap model for routing
      });

      return analysis;
    }).pipe(
      Effect.mapError(
        (e) =>
          new RoutingError({
            message: "Complexity analysis failed",
            taskComplexity: undefined,
          }),
      ),
    );

  const route = (
    task: string,
    context?: string,
  ): Effect.Effect<ModelCostConfig, RoutingError> =>
    Effect.gen(function* () {
      const analysis = yield* analyzeComplexity(task, context);
      return getModelCostConfig(analysis.recommendedTier);
    });

  return { route, analyzeComplexity, heuristicClassify };
});

// ─── Model cost configurations ───

function getModelCostConfig(tier: ModelTier): ModelCostConfig {
  const configs: Record<ModelTier, ModelCostConfig> = {
    haiku: {
      tier: "haiku",
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
      costPer1MInput: 1.0,
      costPer1MOutput: 5.0,
      maxContext: 200_000,
      quality: 0.6,
      speedTokensPerSec: 150,
    },
    sonnet: {
      tier: "sonnet",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      costPer1MInput: 3.0,
      costPer1MOutput: 15.0,
      maxContext: 200_000,
      quality: 0.85,
      speedTokensPerSec: 80,
    },
    opus: {
      tier: "opus",
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      costPer1MInput: 15.0,
      costPer1MOutput: 75.0,
      maxContext: 1_000_000,
      quality: 1.0,
      speedTokensPerSec: 40,
    },
  };

  return configs[tier];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // Rough estimate: ~4 chars per token
}

function estimateCost(text: string, config: ModelCostConfig): number {
  const tokens = estimateTokens(text);
  return (tokens / 1_000_000) * config.costPer1MInput;
}
````

---

## Semantic Cache Implementation

```typescript
import { Effect, Ref } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

export const makeSemanticCache = Effect.gen(function* () {
  const llm = yield* LLMService;

  // In-memory cache with embeddings (could be backed by LanceDB for persistence)
  const cacheRef = yield* Ref.make<CacheEntry[]>([]);

  const SIMILARITY_THRESHOLD = 0.95;
  const DEFAULT_TTL_MS = 3_600_000; // 1 hour
  const MAX_CACHE_SIZE = 10_000;

  const check = (query: string): Effect.Effect<string | null, CacheError> =>
    Effect.gen(function* () {
      const queryEmbedding = yield* llm.embed(query);
      const entries = yield* Ref.get(cacheRef);

      // Find most similar cached entry
      let bestMatch: { entry: CacheEntry; similarity: number } | null = null;

      for (const entry of entries) {
        // Check TTL
        const age = Date.now() - entry.createdAt.getTime();
        if (age > entry.ttlMs) continue;

        const similarity = cosineSimilarity(
          queryEmbedding,
          entry.queryEmbedding,
        );
        if (similarity >= SIMILARITY_THRESHOLD) {
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { entry, similarity };
          }
        }
      }

      if (bestMatch) {
        // Update hit count
        yield* Ref.update(cacheRef, (entries) =>
          entries.map((e) =>
            e.queryHash === bestMatch!.entry.queryHash
              ? { ...e, hitCount: e.hitCount + 1, lastHitAt: new Date() }
              : e,
          ),
        );

        return bestMatch.entry.response;
      }

      return null;
    }).pipe(
      Effect.mapError(
        (e) => new CacheError({ message: "Cache lookup failed", cause: e }),
      ),
    );

  const store = (
    query: string,
    response: string,
    model: string,
    ttlMs: number = DEFAULT_TTL_MS,
  ): Effect.Effect<void, CacheError> =>
    Effect.gen(function* () {
      const queryEmbedding = yield* llm.embed(query);
      const queryHash = hashString(query);

      const entry: CacheEntry = {
        queryEmbedding,
        queryHash,
        response,
        model,
        createdAt: new Date(),
        hitCount: 0,
        lastHitAt: new Date(),
        ttlMs,
      };

      yield* Ref.update(cacheRef, (entries) => {
        // Evict expired entries
        const now = Date.now();
        const valid = entries.filter(
          (e) => now - e.createdAt.getTime() < e.ttlMs,
        );

        // Evict LRU if at capacity
        if (valid.length >= MAX_CACHE_SIZE) {
          valid.sort((a, b) => b.lastHitAt.getTime() - a.lastHitAt.getTime());
          valid.pop();
        }

        return [...valid, entry];
      });
    }).pipe(
      Effect.mapError(
        (e) => new CacheError({ message: "Cache store failed", cause: e }),
      ),
    );

  const getStats = Effect.gen(function* () {
    const entries = yield* Ref.get(cacheRef);
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    return {
      entries: entries.length,
      totalHits,
      avgHitsPerEntry: entries.length > 0 ? totalHits / entries.length : 0,
    };
  });

  return { check, store, getStats };
});

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
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

---

## Budget Enforcer Implementation

```typescript
import { Effect, Ref } from "effect";

export interface BudgetState {
  readonly sessionSpend: Record<string, number>; // sessionId -> total
  readonly dailySpend: Record<string, number>; // agentId -> today's total
  readonly monthlySpend: Record<string, number>; // agentId -> month's total
}

export const makeBudgetEnforcer = (limits: BudgetLimits) =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<BudgetState>({
      sessionSpend: {},
      dailySpend: {},
      monthlySpend: {},
    });

    const check = (
      estimatedCost: number,
      agentId: string,
      sessionId: string,
    ): Effect.Effect<void, BudgetExceededError> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);

        const sessionCurrent = state.sessionSpend[sessionId] ?? 0;
        const dailyCurrent = state.dailySpend[agentId] ?? 0;
        const monthlyCurrent = state.monthlySpend[agentId] ?? 0;

        // Check per-request limit
        if (estimatedCost > limits.perRequest) {
          return yield* Effect.fail(
            new BudgetExceededError({
              message: `Request cost $${estimatedCost.toFixed(4)} exceeds per-request limit $${limits.perRequest}`,
              budgetType: "perRequest",
              limit: limits.perRequest,
              current: 0,
              requested: estimatedCost,
            }),
          );
        }

        // Check session limit
        if (sessionCurrent + estimatedCost > limits.perSession) {
          return yield* Effect.fail(
            new BudgetExceededError({
              message: `Session spend $${(sessionCurrent + estimatedCost).toFixed(4)} exceeds limit $${limits.perSession}`,
              budgetType: "perSession",
              limit: limits.perSession,
              current: sessionCurrent,
              requested: estimatedCost,
            }),
          );
        }

        // Check daily limit
        if (dailyCurrent + estimatedCost > limits.daily) {
          return yield* Effect.fail(
            new BudgetExceededError({
              message: `Daily spend $${(dailyCurrent + estimatedCost).toFixed(4)} exceeds limit $${limits.daily}`,
              budgetType: "daily",
              limit: limits.daily,
              current: dailyCurrent,
              requested: estimatedCost,
            }),
          );
        }

        // Check monthly limit
        if (monthlyCurrent + estimatedCost > limits.monthly) {
          return yield* Effect.fail(
            new BudgetExceededError({
              message: `Monthly spend $${(monthlyCurrent + estimatedCost).toFixed(4)} exceeds limit $${limits.monthly}`,
              budgetType: "monthly",
              limit: limits.monthly,
              current: monthlyCurrent,
              requested: estimatedCost,
            }),
          );
        }
      });

    const record = (
      cost: number,
      agentId: string,
      sessionId: string,
    ): Effect.Effect<void, never> =>
      Ref.update(stateRef, (state) => ({
        sessionSpend: {
          ...state.sessionSpend,
          [sessionId]: (state.sessionSpend[sessionId] ?? 0) + cost,
        },
        dailySpend: {
          ...state.dailySpend,
          [agentId]: (state.dailySpend[agentId] ?? 0) + cost,
        },
        monthlySpend: {
          ...state.monthlySpend,
          [agentId]: (state.monthlySpend[agentId] ?? 0) + cost,
        },
      }));

    const getStatus = (agentId: string): Effect.Effect<BudgetStatus, never> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const daily = state.dailySpend[agentId] ?? 0;
        const monthly = state.monthlySpend[agentId] ?? 0;

        return {
          currentSession: 0, // Would need sessionId for this
          currentDaily: daily,
          currentMonthly: monthly,
          limits,
          percentUsedDaily: (daily / limits.daily) * 100,
          percentUsedMonthly: (monthly / limits.monthly) * 100,
        };
      });

    return { check, record, getStatus };
  });
```

---

## Prompt Compressor

```typescript
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

export const makePromptCompressor = Effect.gen(function* () {
  const llm = yield* LLMService;

  const compress = (
    prompt: string,
    maxTokens?: number,
  ): Effect.Effect<
    { compressed: string; savedTokens: number },
    CostTrackingError
  > =>
    Effect.gen(function* () {
      const originalTokens = yield* llm.countTokens(prompt);

      // Skip compression for short prompts
      if (originalTokens < 500) {
        return { compressed: prompt, savedTokens: 0 };
      }

      // Step 1: Remove redundant whitespace and formatting
      let compressed = prompt
        .replace(/\n{3,}/g, "\n\n") // Collapse multiple newlines
        .replace(/[ \t]{2,}/g, " ") // Collapse multiple spaces
        .replace(/^\s+$/gm, ""); // Remove blank lines

      // Step 2: If still over maxTokens, use LLM to summarize context sections
      if (maxTokens) {
        const compressedTokens = yield* llm.countTokens(compressed);
        if (compressedTokens > maxTokens) {
          const result = yield* llm.complete({
            messages: [
              {
                role: "user",
                content: `Compress this text to fit within ${maxTokens} tokens while preserving all essential information, key facts, and instructions. Remove redundancy and verbose explanations.\n\n${compressed}`,
              },
            ],
            model: {
              provider: "anthropic",
              model: "claude-3-5-haiku-20241022",
            },
          });
          compressed = result.content;
        }
      }

      const compressedTokens = yield* llm.countTokens(compressed);
      return {
        compressed,
        savedTokens: originalTokens - compressedTokens,
      };
    }).pipe(
      Effect.mapError(
        (e) =>
          new CostTrackingError({
            message: "Prompt compression failed",
            cause: e,
          }),
      ),
    );

  return { compress };
});
```

---

## Cost Tracker & Analytics

```typescript
import { Effect, Ref } from "effect";

export const makeCostTracker = Effect.gen(function* () {
  const entriesRef = yield* Ref.make<CostEntry[]>([]);

  const record = (
    entry: Omit<CostEntry, "id" | "timestamp">,
  ): Effect.Effect<void, CostTrackingError> =>
    Effect.gen(function* () {
      const fullEntry: CostEntry = {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: new Date(),
      };

      yield* Ref.update(entriesRef, (entries) => [...entries, fullEntry]);
    }).pipe(
      Effect.mapError(
        (e) =>
          new CostTrackingError({
            message: "Failed to record cost entry",
            cause: e,
          }),
      ),
    );

  const getReport = (
    period: "session" | "daily" | "weekly" | "monthly",
    agentId?: string,
  ): Effect.Effect<CostReport, CostTrackingError> =>
    Effect.gen(function* () {
      const allEntries = yield* Ref.get(entriesRef);
      const now = Date.now();

      // Filter by time period
      const periodMs: Record<string, number> = {
        session: 0, // All entries in current session
        daily: 86_400_000,
        weekly: 604_800_000,
        monthly: 2_592_000_000,
      };

      let entries =
        period === "session"
          ? allEntries
          : allEntries.filter(
              (e) => now - e.timestamp.getTime() < periodMs[period],
            );

      // Filter by agent if specified
      if (agentId) {
        entries = entries.filter((e) => e.agentId === agentId);
      }

      const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
      const cacheHits = entries.filter((e) => e.cachedHit).length;
      const cacheMisses = entries.filter((e) => !e.cachedHit).length;

      // Cost by tier
      const costByTier: Record<string, number> = {};
      for (const entry of entries) {
        costByTier[entry.tier] = (costByTier[entry.tier] ?? 0) + entry.cost;
      }

      // Cost by agent
      const costByAgent: Record<string, number> = {};
      for (const entry of entries) {
        costByAgent[entry.agentId] =
          (costByAgent[entry.agentId] ?? 0) + entry.cost;
      }

      return {
        period,
        totalCost,
        totalRequests: entries.length,
        cacheHits,
        cacheMisses,
        cacheHitRate: entries.length > 0 ? cacheHits / entries.length : 0,
        savings: 0, // Calculated separately
        costByTier,
        costByAgent,
        avgCostPerRequest: entries.length > 0 ? totalCost / entries.length : 0,
        avgLatencyMs:
          entries.length > 0
            ? entries.reduce((sum, e) => sum + e.latencyMs, 0) / entries.length
            : 0,
      };
    }).pipe(
      Effect.mapError(
        (e) =>
          new CostTrackingError({
            message: "Failed to generate report",
            cause: e,
          }),
      ),
    );

  return { record, getReport };
});
```

---

## Main CostService Implementation

```typescript
import { Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { EventBus } from "@reactive-agents/core";

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  perRequest: 1.0, // $1 max per request
  perSession: 5.0, // $5 max per session
  daily: 25.0, // $25 max per day
  monthly: 200.0, // $200 max per month
};

export const CostServiceLive = Layer.effect(
  CostService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;

    // Initialize subsystems
    const router = yield* makeComplexityRouter;
    const cache = yield* makeSemanticCache;
    const compressor = yield* makePromptCompressor;
    const budget = yield* makeBudgetEnforcer(DEFAULT_BUDGET_LIMITS);
    const tracker = yield* makeCostTracker;

    const routeToModel = (task: string, context?: string) =>
      router.route(task, context);

    const checkCache = (query: string) => cache.check(query);

    const cacheResponse = (
      query: string,
      response: string,
      model: string,
      ttlMs?: number,
    ) => cache.store(query, response, model, ttlMs);

    const compressPrompt = (prompt: string, maxTokens?: number) =>
      compressor.compress(prompt, maxTokens);

    const checkBudget = (
      estimatedCost: number,
      agentId: string,
      sessionId: string,
    ) => budget.check(estimatedCost, agentId, sessionId);

    const recordCost = (entry: Omit<CostEntry, "id" | "timestamp">) =>
      tracker.record(entry);

    const getBudgetStatus = (agentId: string) => budget.getStatus(agentId);

    const getReport = (
      period: "session" | "daily" | "weekly" | "monthly",
      agentId?: string,
    ) => tracker.getReport(period, agentId);

    // ─── Full optimization pipeline ───

    const optimizedCall = <A>(
      query: string,
      execute: (
        model: ModelConfig,
        compressedQuery: string,
      ) => Effect.Effect<A, unknown>,
      options?: { agentId?: string; sessionId?: string; taskType?: string },
    ): Effect.Effect<A, BudgetExceededError | CostTrackingError> =>
      Effect.gen(function* () {
        const agentId = options?.agentId ?? "default";
        const sessionId = options?.sessionId ?? "default";
        const taskType = options?.taskType ?? "unknown";
        const startTime = Date.now();

        // 1. Check cache
        const cached = yield* cache
          .check(query)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (cached !== null) {
          yield* tracker.record({
            agentId,
            sessionId,
            model: "cache",
            tier: "haiku",
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            cachedHit: true,
            taskType,
            latencyMs: Date.now() - startTime,
          });

          yield* eventBus.publish({
            type: "cost.cache-hit",
            payload: { query: query.slice(0, 50), agentId },
          });

          return cached as A;
        }

        // 2. Route to model
        const model = yield* router
          .route(query)
          .pipe(
            Effect.catchAll(() => Effect.succeed(getModelCostConfig("sonnet"))),
          );

        // 3. Estimate cost & check budget
        const estimatedTokens = estimateTokens(query);
        const estimatedCost =
          (estimatedTokens / 1_000_000) * model.costPer1MInput;
        yield* budget.check(estimatedCost, agentId, sessionId);

        // 4. Compress prompt
        const { compressed, savedTokens } = yield* compressor
          .compress(query)
          .pipe(
            Effect.catchAll(() =>
              Effect.succeed({ compressed: query, savedTokens: 0 }),
            ),
          );

        // 5. Execute
        const result = yield* execute(model, compressed).pipe(
          Effect.mapError(
            (e) =>
              new CostTrackingError({
                message: "LLM call failed in cost pipeline",
                cause: e,
              }),
          ),
        );

        // 6. Cache result
        if (typeof result === "string") {
          yield* cache
            .store(query, result, model.model)
            .pipe(Effect.catchAll(() => Effect.void));
        }

        // 7. Record cost
        const actualCost = estimatedCost; // Would be replaced with actual token counts
        yield* budget.record(actualCost, agentId, sessionId);
        yield* tracker.record({
          agentId,
          sessionId,
          model: model.model,
          tier: model.tier,
          inputTokens: estimatedTokens - savedTokens,
          outputTokens: 0,
          cost: actualCost,
          cachedHit: false,
          taskType,
          latencyMs: Date.now() - startTime,
        });

        yield* eventBus.publish({
          type: "cost.call-completed",
          payload: {
            model: model.model,
            tier: model.tier,
            cost: actualCost,
            savedTokens,
          },
        });

        return result;
      });

    return {
      routeToModel,
      checkCache,
      cacheResponse,
      compressPrompt,
      checkBudget,
      recordCost,
      getBudgetStatus,
      getReport,
      optimizedCall,
    };
  }),
);
```

---

## Testing

```typescript
import { Effect, Layer } from "effect";
import { describe, it, expect } from "vitest";
import { CostService, CostServiceLive, BudgetExceededError } from "../src";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider/testing";

const TestCostLayer = CostServiceLive.pipe(
  Layer.provide(TestLLMServiceLayer),
  Layer.provide(TestEventBusLayer),
);

describe("CostService", () => {
  it("should route simple tasks to haiku", async () => {
    const program = Effect.gen(function* () {
      const cost = yield* CostService;
      const model = yield* cost.routeToModel("What is 2+2?");
      expect(model.tier).toBe("haiku");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestCostLayer)));
  });

  it("should route complex tasks to sonnet or opus", async () => {
    const program = Effect.gen(function* () {
      const cost = yield* CostService;
      const model = yield* cost.routeToModel(
        "Analyze the following code, compare it against best practices, evaluate performance characteristics, and then synthesize a comprehensive refactoring plan with step-by-step instructions.",
      );
      expect(["sonnet", "opus"]).toContain(model.tier);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestCostLayer)));
  });

  it("should return cached responses on cache hit", async () => {
    const program = Effect.gen(function* () {
      const cost = yield* CostService;

      // Store in cache
      yield* cost.cacheResponse(
        "What is TypeScript?",
        "TypeScript is...",
        "haiku",
      );

      // Should hit cache
      const cached = yield* cost.checkCache("What is TypeScript?");
      expect(cached).toBe("TypeScript is...");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestCostLayer)));
  });

  it("should enforce budget limits", async () => {
    const program = Effect.gen(function* () {
      const cost = yield* CostService;

      // This should fail if budget is exceeded
      const result = yield* cost.checkBudget(999, "agent-1", "session-1").pipe(
        Effect.flip, // Expect failure
      );

      expect(result._tag).toBe("BudgetExceededError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestCostLayer)));
  });

  it("should generate accurate cost reports", async () => {
    const program = Effect.gen(function* () {
      const cost = yield* CostService;

      // Record some costs
      yield* cost.recordCost({
        agentId: "agent-1",
        sessionId: "sess-1",
        model: "claude-haiku",
        tier: "haiku",
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.002,
        cachedHit: false,
        taskType: "qa",
        latencyMs: 500,
      });

      yield* cost.recordCost({
        agentId: "agent-1",
        sessionId: "sess-1",
        model: "claude-sonnet",
        tier: "sonnet",
        inputTokens: 2000,
        outputTokens: 1000,
        cost: 0.021,
        cachedHit: false,
        taskType: "analysis",
        latencyMs: 1500,
      });

      const report = yield* cost.getReport("session", "agent-1");
      expect(report.totalRequests).toBe(2);
      expect(report.totalCost).toBeCloseTo(0.023, 3);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestCostLayer)));
  });
});
```

---

## Configuration

```typescript
export const CostConfig = {
  // Budget defaults
  defaultBudgetLimits: {
    perRequest: 1.0,
    perSession: 5.0,
    daily: 25.0,
    monthly: 200.0,
  },

  // Semantic cache
  cache: {
    similarityThreshold: 0.95,
    defaultTtlMs: 3_600_000, // 1 hour
    maxEntries: 10_000,
  },

  // Prompt compression
  compression: {
    minTokensForCompression: 500,
    targetReduction: 0.3, // 30% reduction target
  },

  // Complexity routing
  routing: {
    haikuThreshold: 0.3, // complexity < 0.3 → haiku
    sonnetThreshold: 0.7, // 0.3-0.7 → sonnet
    // > 0.7 → opus
  },

  // Analytics
  analytics: {
    retentionDays: 90,
    exportIntervalMs: 60_000, // Export metrics every minute
  },
};
```

---

## Performance Targets

| Metric               | Target | Notes                                   |
| -------------------- | ------ | --------------------------------------- |
| Cache hit rate       | >80%   | For similar queries within same session |
| Cost reduction       | 10x    | vs always using best model              |
| Routing latency      | <50ms  | Heuristic path; <500ms with LLM         |
| Compression savings  | 20-40% | Token count reduction                   |
| Budget check latency | <1ms   | In-memory Ref check                     |
| Report generation    | <100ms | Up to 10K entries                       |

---

## Integration Points

- **LLMService** (Layer 1.5): Uses `embed()` for semantic cache, `complete()` for complexity analysis, `countTokens()` for compression
- **EventBus** (Layer 1): Emits `cost.cache-hit`, `cost.call-completed`, `cost.budget-warning`, `cost.budget-exceeded` events
- **Verification** (Layer 4): Verification layer calls are tracked for cost
- **Reasoning** (Layer 3): All reasoning LLM calls routed through cost optimization
- **Observability** (Layer 9): Cost metrics exported to monitoring/dashboard

## Success Criteria

- [ ] 10x cost reduction vs naive single-model
- [ ] Semantic cache with >80% hit rate for repeated queries
- [ ] Budget enforcement prevents overspend
- [ ] Real-time cost tracking with per-agent, per-session breakdown
- [ ] Automatic model routing based on task complexity
- [ ] Prompt compression reduces token usage by 20-40%
- [ ] All subsystems use Effect-TS patterns (no raw async/await)

---

## Package Config

### File: `package.json`

```json
{
  "name": "@reactive-agents/cost",
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
**Priority: Phase 2 (Weeks 8-9)**
