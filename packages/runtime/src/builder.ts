import { Effect, Layer } from "effect";
import { createRuntime } from "./runtime.js";
import type { MCPServerConfig } from "./runtime.js";
import { ExecutionEngine } from "./execution-engine.js";
import type { LifecycleHook } from "./types.js";

// ─── Result Types ────────────────────────────────────────────────────────────

export interface AgentResultMetadata {
  readonly duration: number;
  readonly cost: number;
  readonly tokensUsed: number;
  readonly strategyUsed?: string;
  readonly stepsCount: number;
}

export interface AgentResult {
  readonly output: string;
  readonly success: boolean;
  readonly taskId: string;
  readonly agentId: string;
  readonly metadata: AgentResultMetadata;
}

// ─── ReactiveAgents Namespace ────────────────────────────────────────────────

export const ReactiveAgents = {
  /** Create a new builder. All configuration is optional except `.withModel()`. */
  create: (): ReactiveAgentBuilder => new ReactiveAgentBuilder(),
};

// ─── ReactiveAgentBuilder ────────────────────────────────────────────────────

export class ReactiveAgentBuilder {
  private _name: string = "agent";
  private _provider: "anthropic" | "openai" | "ollama" | "gemini" | "test" = "test";
  private _model?: string;
  private _memoryTier: "1" | "2" = "1";
  private _hooks: LifecycleHook[] = [];
  private _maxIterations: number = 10;
  private _enableGuardrails: boolean = false;
  private _enableVerification: boolean = false;
  private _enableCostTracking: boolean = false;
  private _enableAudit: boolean = false;
  private _enableReasoning: boolean = false;
  private _enableTools: boolean = false;
  private _enableIdentity: boolean = false;
  private _enableObservability: boolean = false;
  private _enableInteraction: boolean = false;
  private _enablePrompts: boolean = false;
  private _enableOrchestration: boolean = false;
  private _testResponses?: Record<string, string>;
  private _extraLayers?: Layer.Layer<any, any>;
  private _mcpServers: MCPServerConfig[] = [];

  // ─── Identity ───

  withName(name: string): this {
    this._name = name;
    return this;
  }

  // ─── Model & Provider ───

  withModel(model: string): this {
    this._model = model;
    return this;
  }

  withProvider(
    provider: "anthropic" | "openai" | "ollama" | "gemini" | "test",
  ): this {
    this._provider = provider;
    return this;
  }

  // ─── Memory ───

  withMemory(tier: "1" | "2"): this {
    this._memoryTier = tier;
    return this;
  }

  // ─── Execution ───

  withMaxIterations(n: number): this {
    this._maxIterations = n;
    return this;
  }

  // ─── Lifecycle Hooks ───

  withHook(hook: LifecycleHook): this {
    this._hooks.push(hook);
    return this;
  }

  // ─── Optional Features ───

  withGuardrails(): this {
    this._enableGuardrails = true;
    return this;
  }

  withVerification(): this {
    this._enableVerification = true;
    return this;
  }

  withCostTracking(): this {
    this._enableCostTracking = true;
    return this;
  }

  withAudit(): this {
    this._enableAudit = true;
    return this;
  }

  withReasoning(): this {
    this._enableReasoning = true;
    return this;
  }

  withTools(): this {
    this._enableTools = true;
    return this;
  }

  withIdentity(): this {
    this._enableIdentity = true;
    return this;
  }

  withObservability(): this {
    this._enableObservability = true;
    return this;
  }

  withInteraction(): this {
    this._enableInteraction = true;
    return this;
  }

  withPrompts(): this {
    this._enablePrompts = true;
    return this;
  }

  withOrchestration(): this {
    this._enableOrchestration = true;
    return this;
  }

  // ─── MCP Servers ───

  withMCP(config: MCPServerConfig | MCPServerConfig[]): this {
    const configs = Array.isArray(config) ? config : [config];
    this._mcpServers.push(...configs);
    this._enableTools = true;
    return this;
  }

  // ─── Testing ───

  withTestResponses(responses: Record<string, string>): this {
    this._testResponses = responses;
    return this;
  }

  // ─── Extra Layers ───

  withLayers(layers: Layer.Layer<any, any>): this {
    this._extraLayers = layers;
    return this;
  }

  // ─── Build ───

  async build(): Promise<ReactiveAgent> {
    return Effect.runPromise(this.buildEffect());
  }

  buildEffect(): Effect.Effect<ReactiveAgent, Error> {
    const agentId = `${this._name}-${Date.now()}`;

    const runtime = createRuntime({
      agentId,
      provider: this._provider,
      model: this._model,
      memoryTier: this._memoryTier,
      maxIterations: this._maxIterations,
      enableGuardrails: this._enableGuardrails,
      enableVerification: this._enableVerification,
      enableCostTracking: this._enableCostTracking,
      enableAudit: this._enableAudit,
      enableReasoning: this._enableReasoning,
      enableTools: this._enableTools,
      enableIdentity: this._enableIdentity,
      enableObservability: this._enableObservability,
      enableInteraction: this._enableInteraction,
      enablePrompts: this._enablePrompts,
      enableOrchestration: this._enableOrchestration,
      testResponses: this._testResponses,
      extraLayers: this._extraLayers,
      mcpServers: this._mcpServers.length > 0 ? this._mcpServers : undefined,
    });

    const hooks = [...this._hooks];
    const mcpServers = [...this._mcpServers];

    return Effect.gen(function* () {
      const engine = yield* ExecutionEngine.pipe(Effect.provide(runtime));

      for (const hook of hooks) {
        yield* engine.registerHook(hook);
      }

      // Connect MCP servers if configured
      if (mcpServers.length > 0) {
        const { ToolService } = yield* Effect.promise(() =>
          import("@reactive-agents/tools"),
        );
        const toolService = yield* (ToolService as any).pipe(Effect.provide(runtime));
        for (const mcp of mcpServers) {
          yield* (toolService as any).connectMCPServer(mcp);
        }
      }

      return new ReactiveAgent(engine, agentId, runtime);
    }) as Effect.Effect<ReactiveAgent, Error>;
  }
}

// ─── ReactiveAgent Facade ────────────────────────────────────────────────────

export class ReactiveAgent {
  constructor(
    private readonly engine: {
      execute: (task: any) => Effect.Effect<any, any>;
      cancel: (taskId: string) => Effect.Effect<void, any>;
      getContext: (taskId: string) => Effect.Effect<any, never>;
    },
    readonly agentId: string,
    private readonly runtime: Layer.Layer<any, any>,
  ) {}

  /**
   * Run a task and return the result (Simple API).
   */
  async run(input: string): Promise<AgentResult> {
    return Effect.runPromise(this.runEffect(input));
  }

  /**
   * Run a task and return the result (Advanced API — Effect).
   */
  runEffect(input: string): Effect.Effect<AgentResult, Error> {
    const taskId = `task-${Date.now()}`;
    const agentId = this.agentId;
    const engine = this.engine;
    const runtime = this.runtime;

    const task = {
      id: taskId,
      agentId,
      type: "query" as const,
      input: { question: input },
      priority: "medium" as const,
      status: "pending" as const,
      metadata: { tags: [] },
      createdAt: new Date(),
    };

    return engine.execute(task).pipe(
      Effect.map((result: any) => ({
        output: String(result.output ?? ""),
        success: Boolean(result.success),
        taskId: String(result.taskId),
        agentId: String(result.agentId),
        metadata: result.metadata as AgentResultMetadata,
      })),
      Effect.mapError(
        (e: any) => {
          const err = new Error(e.message ?? String(e));
          if (e.cause) err.cause = e.cause;
          return err;
        },
      ),
      Effect.provide(runtime as unknown as Layer.Layer<never>),
    ) as Effect.Effect<AgentResult, Error>;
  }

  /** Cancel a running task by ID. */
  async cancel(taskId: string): Promise<void> {
    return Effect.runPromise(
      this.engine.cancel(taskId).pipe(
        Effect.mapError((e: any) => new Error(e.message ?? String(e))),
        Effect.provide(this.runtime as unknown as Layer.Layer<never>),
      ) as Effect.Effect<void>,
    );
  }

  /** Inspect context of a running task (null if not running). */
  async getContext(taskId: string): Promise<unknown> {
    return Effect.runPromise(
      this.engine.getContext(taskId).pipe(
        Effect.provide(this.runtime as unknown as Layer.Layer<never>),
      ) as Effect.Effect<unknown>,
    );
  }
}
