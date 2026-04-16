export type SkillFragment = {
  readonly promptTemplateId: string;
  readonly systemPromptTokens: number;
  readonly contextStrategy: {
    readonly compressionEnabled: boolean;
    readonly maxIterations: number;
    readonly temperature: number;
    readonly toolFilteringMode: "adaptive" | "static" | "none";
    readonly requiredToolsCount: number;
  };
  readonly memoryConfig: {
    readonly tier: string;
    readonly semanticLines: number;
    readonly episodicLines: number;
    readonly consolidationEnabled: boolean;
  };
  readonly reasoningConfig: {
    readonly strategy: string;
    readonly strategySwitchingEnabled: boolean;
    readonly adaptiveEnabled: boolean;
  };
  readonly convergenceIteration: number | null;
  readonly finalComposite: number;
  readonly meanComposite: number;
};

export type RunReport = {
  readonly id: string;
  readonly installId: string;
  readonly modelId: string;
  readonly modelTier: "frontier" | "local" | "unknown";
  readonly provider: string;
  readonly taskCategory: string;
  readonly toolCount: number;
  readonly toolsUsed: readonly string[];
  readonly strategyUsed: string;
  readonly strategySwitched: boolean;
  readonly entropyTrace: readonly {
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
      readonly shape: string;
      readonly momentum: number;
    };
    readonly confidence: "high" | "medium" | "low";
  }[];
  readonly terminatedBy: string;
  readonly outcome: "success" | "partial" | "failure";
  readonly totalIterations: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly skillFragment?: SkillFragment | null;
  readonly clientVersion: string;
  // Telemetry-safe enrichment (Living Intelligence System)
  readonly trajectoryFingerprint?: string;
  readonly abstractToolPattern?: readonly ("search" | "write" | "read" | "compute" | "communicate" | "unknown")[];
  readonly iterationsToFirstConvergence?: number | null;
  readonly tokenEfficiencyRatio?: number;
  readonly thoughtToActionRatio?: number;
  readonly contextPressurePeak?: number;
  readonly skillsActiveCount?: number;
  readonly skillEffectivenessScores?: readonly number[];
  readonly learnedSkillsContribution?: boolean;
  readonly taskComplexity?: "trivial" | "moderate" | "complex" | "expert";
  readonly failurePattern?: "loop-detected" | "context-overflow" | "tool-cascade-failure" | "strategy-exhausted" | "guardrail-halt" | "timeout" | "unknown";
  // ── Adaptive harness signals (2026-04-15) ──
  readonly toolCallDialectObserved?: "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";
  readonly classifierFalsePositives?: readonly string[];
  readonly classifierFalseNegatives?: readonly string[];
  readonly subagentInvocations?: readonly {
    readonly delegated: boolean;
    readonly succeeded: boolean;
  }[];
  readonly toolArgValidityRate?: number;
  /** Turns in which the model emitted ≥2 tool calls in a single response. */
  readonly parallelTurnCount?: number;
  // ── Enhanced entropy features ──
  readonly entropyVariance?: number;
  readonly entropyOscillationCount?: number;
  readonly finalCompositeEntropy?: number | null;
  readonly entropyAreaUnderCurve?: number;
};
