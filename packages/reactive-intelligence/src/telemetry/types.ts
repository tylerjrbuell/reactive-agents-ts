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
  readonly installId: string;
  readonly runId: string;
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
  readonly skillFragment?: SkillFragment;
};
