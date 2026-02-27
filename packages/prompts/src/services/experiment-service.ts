import { Context, Effect, Layer, Ref } from "effect";

// ─── Types ───

export interface Experiment {
  readonly id: string;
  readonly templateId: string;
  /** Map of variant name → template version */
  readonly variants: ReadonlyMap<string, number>;
  /** Split ratios per variant (sums to 1.0) */
  readonly splitRatio: ReadonlyMap<string, number>;
  readonly createdAt: Date;
  readonly status: "active" | "paused" | "completed";
}

export interface ExperimentOutcome {
  readonly experimentId: string;
  readonly variant: string;
  readonly userId: string;
  readonly success: boolean;
  readonly score?: number;
  readonly metadata?: Record<string, unknown>;
  readonly recordedAt: Date;
}

export interface ExperimentResults {
  readonly experimentId: string;
  readonly variants: Record<string, {
    readonly assignments: number;
    readonly outcomes: number;
    readonly successRate: number;
    readonly avgScore: number;
  }>;
  readonly winner: string | null;
  readonly totalAssignments: number;
  readonly totalOutcomes: number;
}

// ─── Service Tag ───

export class ExperimentService extends Context.Tag("ExperimentService")<
  ExperimentService,
  {
    /** Create a new A/B experiment for a prompt template. */
    readonly createExperiment: (
      templateId: string,
      variants: Record<string, number>,
      splitRatio?: Record<string, number>,
    ) => Effect.Effect<Experiment>;

    /** Deterministically assign a user to a variant based on hashed userId. */
    readonly assignVariant: (
      experimentId: string,
      userId: string,
    ) => Effect.Effect<{ variant: string; version: number } | null>;

    /** Record an outcome for an experiment variant. */
    readonly recordOutcome: (
      experimentId: string,
      variant: string,
      userId: string,
      outcome: { success: boolean; score?: number; metadata?: Record<string, unknown> },
    ) => Effect.Effect<void>;

    /** Get aggregated results for an experiment. */
    readonly getExperimentResults: (
      experimentId: string,
    ) => Effect.Effect<ExperimentResults | null>;

    /** List all experiments for a template. */
    readonly listExperiments: (
      templateId?: string,
    ) => Effect.Effect<readonly Experiment[]>;

    /** Pause or complete an experiment. */
    readonly updateStatus: (
      experimentId: string,
      status: "active" | "paused" | "completed",
    ) => Effect.Effect<void>;
  }
>() {}

// ─── Deterministic Hash ───

/**
 * Simple deterministic hash for variant assignment.
 * Uses FNV-1a 32-bit hash for consistent bucketing.
 */
const fnv1aHash = (str: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
};

const assignBucket = (
  userId: string,
  experimentId: string,
  variants: ReadonlyMap<string, number>,
  splitRatio: ReadonlyMap<string, number>,
): { variant: string; version: number } | null => {
  const variantNames = Array.from(variants.keys()).sort();
  if (variantNames.length === 0) return null;

  const hash = fnv1aHash(`${experimentId}:${userId}`);
  const normalized = (hash % 10000) / 10000; // 0.0 - 0.9999

  let cumulative = 0;
  for (const name of variantNames) {
    cumulative += splitRatio.get(name) ?? (1 / variantNames.length);
    if (normalized < cumulative) {
      return { variant: name, version: variants.get(name)! };
    }
  }

  // Fallback to last variant (rounding edge case)
  const last = variantNames[variantNames.length - 1]!;
  return { variant: last, version: variants.get(last)! };
};

// ─── Implementation ───

export const ExperimentServiceLive = Layer.effect(
  ExperimentService,
  Effect.gen(function* () {
    const experimentsRef = yield* Ref.make<Map<string, Experiment>>(new Map());
    const outcomesRef = yield* Ref.make<ExperimentOutcome[]>([]);
    const assignmentsRef = yield* Ref.make<Map<string, Map<string, string>>>(new Map()); // experimentId → userId → variant
    const nextIdRef = yield* Ref.make(1);

    return {
      createExperiment: (templateId, variants, splitRatio) =>
        Effect.gen(function* () {
          const nextId = yield* Ref.getAndUpdate(nextIdRef, (n) => n + 1);
          const id = `exp-${nextId}`;
          const variantMap = new Map(Object.entries(variants));
          const variantNames = Array.from(variantMap.keys());

          // Default to equal split if not specified
          let ratioMap: Map<string, number>;
          if (splitRatio) {
            ratioMap = new Map(Object.entries(splitRatio));
          } else {
            ratioMap = new Map(
              variantNames.map((n) => [n, 1 / variantNames.length]),
            );
          }

          const experiment: Experiment = {
            id,
            templateId,
            variants: variantMap,
            splitRatio: ratioMap,
            createdAt: new Date(),
            status: "active",
          };

          yield* Ref.update(experimentsRef, (m) => {
            const n = new Map(m);
            n.set(id, experiment);
            return n;
          });

          return experiment;
        }),

      assignVariant: (experimentId, userId) =>
        Effect.gen(function* () {
          const experiments = yield* Ref.get(experimentsRef);
          const experiment = experiments.get(experimentId);
          if (!experiment || experiment.status !== "active") return null;

          // Check for existing assignment (sticky)
          const assignments = yield* Ref.get(assignmentsRef);
          const expAssignments = assignments.get(experimentId);
          if (expAssignments?.has(userId)) {
            const variant = expAssignments.get(userId)!;
            const version = experiment.variants.get(variant);
            if (version != null) return { variant, version };
          }

          // Deterministic assignment
          const result = assignBucket(
            userId,
            experimentId,
            experiment.variants,
            experiment.splitRatio,
          );

          if (result) {
            yield* Ref.update(assignmentsRef, (m) => {
              const n = new Map(m);
              const expMap = new Map(n.get(experimentId) ?? []);
              expMap.set(userId, result.variant);
              n.set(experimentId, expMap);
              return n;
            });
          }

          return result;
        }),

      recordOutcome: (experimentId, variant, userId, outcome) =>
        Ref.update(outcomesRef, (outcomes) => [
          ...outcomes,
          {
            experimentId,
            variant,
            userId,
            success: outcome.success,
            score: outcome.score,
            metadata: outcome.metadata,
            recordedAt: new Date(),
          },
        ]),

      getExperimentResults: (experimentId) =>
        Effect.gen(function* () {
          const experiments = yield* Ref.get(experimentsRef);
          const experiment = experiments.get(experimentId);
          if (!experiment) return null;

          const allOutcomes = yield* Ref.get(outcomesRef);
          const expOutcomes = allOutcomes.filter((o) => o.experimentId === experimentId);
          const assignments = yield* Ref.get(assignmentsRef);
          const expAssignments = assignments.get(experimentId) ?? new Map();

          const variantNames = Array.from(experiment.variants.keys());
          const variantResults: Record<string, {
            assignments: number;
            outcomes: number;
            successRate: number;
            avgScore: number;
          }> = {};

          let bestVariant: string | null = null;
          let bestScore = -1;

          for (const name of variantNames) {
            const variantOutcomes = expOutcomes.filter((o) => o.variant === name);
            const assignmentCount = Array.from(expAssignments.values()).filter(
              (v) => v === name,
            ).length;
            const successCount = variantOutcomes.filter((o) => o.success).length;
            const scores = variantOutcomes
              .filter((o) => o.score != null)
              .map((o) => o.score!);
            const avgScore =
              scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
            const successRate =
              variantOutcomes.length > 0 ? successCount / variantOutcomes.length : 0;

            variantResults[name] = {
              assignments: assignmentCount,
              outcomes: variantOutcomes.length,
              successRate,
              avgScore,
            };

            // Winner selection: prefer success rate, then avg score
            const composite = successRate * 0.7 + avgScore * 0.3;
            if (composite > bestScore && variantOutcomes.length >= 5) {
              bestScore = composite;
              bestVariant = name;
            }
          }

          return {
            experimentId,
            variants: variantResults,
            winner: bestVariant,
            totalAssignments: expAssignments.size,
            totalOutcomes: expOutcomes.length,
          } satisfies ExperimentResults;
        }),

      listExperiments: (templateId) =>
        Ref.get(experimentsRef).pipe(
          Effect.map((m) => {
            const all = Array.from(m.values());
            return templateId ? all.filter((e) => e.templateId === templateId) : all;
          }),
        ),

      updateStatus: (experimentId, status) =>
        Ref.update(experimentsRef, (m) => {
          const n = new Map(m);
          const exp = n.get(experimentId);
          if (exp) {
            n.set(experimentId, { ...exp, status });
          }
          return n;
        }),
    };
  }),
);
