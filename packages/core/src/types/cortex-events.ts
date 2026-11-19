export type DebriefPayload = {
  /** `"abstained"`: the agent declined honestly (not counted as a failure). */
  readonly outcome: "success" | "partial" | "failed" | "abstained";
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
    /**
     * Spend of the background debrief synthesis call. It runs after the run's
     * result is built, so it is not in the result's `tokensUsed` / `llmCalls`.
     */
    readonly synthesisTokens?: {
      /** Prompt tokens; absent when the provider did not report a split. */
      readonly input?: number;
      /** Completion tokens; absent when the provider did not report a split. */
      readonly output?: number;
      /** Total tokens of the synthesis call(s). */
      readonly total: number;
      /**
       * Known USD spend of the synthesis call(s). A lower bound when
       * `costComplete` is `false` (0 when the debrief model has no price).
       */
      readonly cost: number;
      /**
       * `false` when the debrief model's price is unknown, so `cost` is not its
       * spend. Absent means priced. Same `{ usd, complete }` shape as
       * `CostSum` and `AgentCompleted.totalCostUsd` / `costComplete`.
       */
      readonly costComplete?: boolean;
      /** LLM calls the debrief made. */
      readonly calls: number;
    };
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
  /**
   * `true` on an assistant turn whose run failed: `content` is then a short
   * failure note (not an answer) and `error` holds the cause. Apps should
   * render it as a failed turn, not as a reply.
   */
  readonly failed?: boolean;
  /** Failure cause when `failed` is true. */
  readonly error?: string;
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

/**
 * The run's debrief is ready. Fires only on runs that produce a debrief (not
 * every run), so it is not the run's cost record: read the billed total,
 * debrief call included, from `RunCostFinalized`.
 */
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
