export type DebriefPayload = {
  readonly outcome: "success" | "partial" | "failed";
  readonly summary: string;
  readonly keyFindings: ReadonlyArray<string>;
  readonly errorsEncountered: ReadonlyArray<string>;
  readonly lessonsLearned: ReadonlyArray<string>;
  readonly confidence: "high" | "medium" | "low";
  readonly caveats?: string;
  readonly toolsUsed: ReadonlyArray<{
    readonly name: string;
    readonly calls: number;
    readonly successRate: number;
  }>;
  readonly metrics: {
    readonly tokens: number;
    readonly duration: number;
    readonly iterations: number;
    readonly cost: number;
  };
  readonly markdown: string;
};

export type MemorySnapshot = {
  readonly _tag: "MemorySnapshot";
  readonly taskId: string;
  readonly iteration: number;
  readonly working: ReadonlyArray<{ readonly key: string; readonly preview: string }>;
  readonly episodicCount: number;
  readonly semanticCount: number;
  readonly skillsActive: ReadonlyArray<string>;
};

export type ContextPressure = {
  readonly _tag: "ContextPressure";
  readonly taskId: string;
  readonly utilizationPct: number;
  readonly tokensUsed: number;
  readonly tokensAvailable: number;
  readonly level: "low" | "medium" | "high" | "critical";
};

export type ChatTurnEvent = {
  readonly _tag: "ChatTurn";
  readonly taskId: string;
  readonly sessionId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly routedVia: "direct-llm" | "react-loop";
  readonly tokensUsed?: number;
};

export type AgentHealthReport = {
  readonly _tag: "AgentHealthReport";
  readonly agentId: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly checks: ReadonlyArray<{
    readonly name: string;
    readonly status: string;
    readonly message?: string;
  }>;
  readonly uptimeMs: number;
};

export type ProviderFallbackActivated = {
  readonly _tag: "ProviderFallbackActivated";
  readonly taskId: string;
  readonly fromProvider: string;
  readonly toProvider: string;
  readonly reason: string;
  readonly attemptNumber: number;
};

export type DebriefCompleted = {
  readonly _tag: "DebriefCompleted";
  readonly taskId: string;
  readonly agentId: string;
  readonly debrief: DebriefPayload;
};

export type AgentConnected = {
  readonly _tag: "AgentConnected";
  readonly agentId: string;
  readonly runId: string;
  readonly cortexUrl: string;
};

export type AgentDisconnected = {
  readonly _tag: "AgentDisconnected";
  readonly agentId: string;
  readonly runId: string;
  readonly reason: string;
};
