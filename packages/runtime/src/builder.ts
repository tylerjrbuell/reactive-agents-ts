import { Effect, Layer, Schema } from "effect";
import { createRuntime } from "./runtime.js";
import type { MCPServerConfig } from "./runtime.js";
import { ExecutionEngine } from "./execution-engine.js";
import type { LifecycleHook, ExecutionContext } from "./types.js";
import type { RuntimeErrors } from "./errors.js";
import type { ReasoningConfig, ContextProfile } from "@reactive-agents/reasoning";
import type { ToolDefinition } from "@reactive-agents/tools";
import type { RemoteAgentClient } from "@reactive-agents/tools";
import type { PromptTemplate } from "@reactive-agents/prompts";
import type { Task, TaskResult } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";
import { generateTaskId, AgentId } from "@reactive-agents/core";

// ─── Provider Types ──────────────────────────────────────────────────────────

export type ProviderName = "anthropic" | "openai" | "ollama" | "gemini" | "test";

// ─── Optional Parameter Types ─────────────────────────────────────────────────

/** Agent persona for steering behavior — structured alternative to raw system prompts. */
export interface AgentPersona {
  /** Display name of the agent (defaults to builder .withName() value) */
  readonly name?: string;
  /** What this agent does — injected as "Role:" section */
  readonly role?: string;
  /** Background context / expertise description */
  readonly background?: string;
  /** Explicit behavioral instructions */
  readonly instructions?: string;
  /** Tone/style guidance (e.g. "professional", "concise", "friendly") */
  readonly tone?: string;
}

/** Options for `.withReasoning()` — all fields optional, merged with defaults. */
export interface ReasoningOptions {
  /** Default strategy: "reactive" | "plan-execute-reflect" | "tree-of-thought" | "reflexion" | "adaptive" */
  readonly defaultStrategy?: ReasoningConfig["defaultStrategy"];
  /** Per-strategy overrides (partial). */
  readonly strategies?: Partial<ReasoningConfig["strategies"]>;
  /** Adaptive reasoning settings. */
  readonly adaptive?: Partial<ReasoningConfig["adaptive"]>;
}

/** Options for `.withTools()` — all fields optional. */
export interface ToolsOptions {
  /** Custom tool definitions to register after build. */
  readonly tools?: ReadonlyArray<{
    readonly definition: ToolDefinition;
    readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown>;
  }>;
}

/** Options for `.withPrompts()` — all fields optional. */
export interface PromptsOptions {
  /** Custom prompt templates to register after build. */
  readonly templates?: ReadonlyArray<PromptTemplate>;
}

/** Options for `.withObservability()` — configure observability verbosity and live streaming. */
export interface ObservabilityOptions {
  /** Verbosity level. Default: "normal" */
  readonly verbosity?: "minimal" | "normal" | "verbose" | "debug";
  /** Stream logs in real-time as the agent runs. Default: false */
  readonly live?: boolean;
  /** Path for JSONL file output. */
  readonly file?: string;
}

/** Options for `.withA2A()` — configure A2A server */
export interface A2AOptions {
  /** Port for A2A server (default: 3000) */
  readonly port?: number;
  /** Base path for A2A endpoints */
  readonly basePath?: string;
}

/** Options for `.withAgentTool()` — register agent as tool */
export interface AgentToolOptions {
  /** Name for this agent tool */
  readonly name: string;
  /** Agent configuration for local agent */
  readonly agent?: {
    readonly name: string;
    readonly description?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly tools?: readonly string[];
    readonly maxIterations?: number;
    readonly systemPrompt?: string;
    readonly persona?: AgentPersona;
  };
  /** URL for remote A2A agent */
  readonly remoteUrl?: string;
}

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

// ─── Persona Composition Helper ───────────────────────────────────────────────

/**
 * Compose an AgentPersona into a structured system prompt.
 * Only includes non-empty sections.
 */
function composePersonaToSystemPrompt(persona: AgentPersona, agentName: string): string {
  const sections: string[] = [];

  // Role (required-ish for personas, but we'll include if set)
  if (persona.role) {
    sections.push(`Role: ${persona.role}`);
  }

  // Background
  if (persona.background) {
    sections.push(`Background: ${persona.background}`);
  }

  // Instructions
  if (persona.instructions) {
    sections.push(`Instructions: ${persona.instructions}`);
  }

  // Tone
  if (persona.tone) {
    sections.push(`Tone: ${persona.tone}`);
  }

  return sections.join("\n\n");
}

// ─── ReactiveAgents Namespace ────────────────────────────────────────────────

export const ReactiveAgents = {
  /** Create a new builder. All configuration is optional except `.withModel()`. */
  create: (): ReactiveAgentBuilder => new ReactiveAgentBuilder(),
};

// ─── ReactiveAgentBuilder ────────────────────────────────────────────────────

export class ReactiveAgentBuilder {
  private _name: string = "agent";
  private _provider: ProviderName = "test";
  private _model?: string;
  private _memoryTier: "1" | "2" = "1";
  private _hooks: LifecycleHook[] = [];
  private _maxIterations: number = 10;
  private _enableGuardrails: boolean = false;
  private _enableVerification: boolean = false;
  private _enableCostTracking: boolean = false;
  private _enableAudit: boolean = false;
  private _enableReasoning: boolean = false;
  private _reasoningOptions?: ReasoningOptions;
  private _enableTools: boolean = false;
  private _toolsOptions?: ToolsOptions;
  private _enableIdentity: boolean = false;
  private _enableObservability: boolean = false;
  private _observabilityOptions?: ObservabilityOptions;
  private _enableInteraction: boolean = false;
  private _enablePrompts: boolean = false;
  private _promptsOptions?: PromptsOptions;
  private _enableOrchestration: boolean = false;
  private _testResponses?: Record<string, string>;
  private _extraLayers?: Layer.Layer<any, any>;
  private _mcpServers: MCPServerConfig[] = [];
  private _systemPrompt?: string;
  private _a2aOptions?: A2AOptions;
  private _agentTools: AgentToolOptions[] = [];
  private _contextProfile?: Partial<ContextProfile>;
  private _allowDynamicSubAgents: boolean = false;
  private _dynamicSubAgentOptions?: { maxIterations?: number };
  private _persona?: AgentPersona;

  // ─── Identity ───

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withPersona(persona: AgentPersona): this {
    this._persona = persona;
    return this;
  }

  // ─── System Prompt ───

  withSystemPrompt(prompt: string): this {
    this._systemPrompt = prompt;
    return this;
  }

  // ─── A2A ────────────────────────────────────────────────────────────────────

  /** Enable A2A server on the agent */
  withA2A(options?: A2AOptions): this {
    this._a2aOptions = options ?? { port: 3000 };
    return this;
  }

  // ─── Agent Tools ─────────────────────────────────────────────────────────────

  /** Register a local agent as a callable tool with real sub-agent delegation */
  withAgentTool(name: string, agent: {
    name: string;
    description?: string;
    provider?: string;
    model?: string;
    tools?: readonly string[];
    maxIterations?: number;
    systemPrompt?: string;
    persona?: AgentPersona;
  }): this {
    this._agentTools.push({ name, agent });
    return this;
  }

  /**
   * Allow this agent to dynamically spawn sub-agents at runtime via the
   * built-in `spawn-agent` tool. Sub-agents run in a clean context window
   * (no parent history) using the parent's provider and model by default.
   * Depth is capped at MAX_RECURSION_DEPTH (3); spawned sub-agents do NOT
   * inherit the spawn-agent tool unless explicitly given it.
   */
  withDynamicSubAgents(options?: { maxIterations?: number }): this {
    this._allowDynamicSubAgents = true;
    this._dynamicSubAgentOptions = options;
    return this;
  }

  /** Register a remote A2A agent as a callable tool */
  withRemoteAgent(name: string, remoteUrl: string): this {
    this._agentTools.push({ name, remoteUrl });
    return this;
  }

  // ─── Model & Provider ───

  withModel(model: string): this {
    this._model = model;
    return this;
  }

  withProvider(
    provider: ProviderName,
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

  withReasoning(options?: ReasoningOptions): this {
    this._enableReasoning = true;
    if (options) this._reasoningOptions = options;
    return this;
  }

  withTools(options?: ToolsOptions): this {
    this._enableTools = true;
    if (options) this._toolsOptions = options;
    return this;
  }

  withIdentity(): this {
    this._enableIdentity = true;
    return this;
  }

  withObservability(options?: ObservabilityOptions): this {
    this._enableObservability = true;
    if (options) this._observabilityOptions = options;
    return this;
  }

  withInteraction(): this {
    this._enableInteraction = true;
    return this;
  }

  withPrompts(options?: PromptsOptions): this {
    this._enablePrompts = true;
    if (options) this._promptsOptions = options;
    return this;
  }

  withOrchestration(): this {
    this._enableOrchestration = true;
    return this;
  }

  /** Set model context profile overrides — controls compaction thresholds, verbosity, tool result sizes. */
  withContextProfile(profile: Partial<ContextProfile>): this {
    this._contextProfile = profile;
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
    // Validate provider API key exists at build time (fast fail)
    const keyMap: Record<string, string | undefined> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      gemini: "GOOGLE_API_KEY",
    };
    const requiredKey = keyMap[this._provider];
    if (requiredKey && !process.env[requiredKey]) {
      return Effect.fail(
        new Error(
          `Missing API key: ${requiredKey} is not set. Provider "${this._provider}" requires it.`,
        ),
      );
    }

    const agentId = `${this._name}-${Date.now()}`;

    // Compose persona into system prompt if provided
    let composedSystemPrompt = this._systemPrompt;
    if (this._persona) {
      const personaPrompt = composePersonaToSystemPrompt(this._persona, this._name);
      composedSystemPrompt = composedSystemPrompt
        ? `${personaPrompt}\n\n${composedSystemPrompt}`
        : personaPrompt;
    }

    const baseRuntime = createRuntime({
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
      observabilityOptions: this._observabilityOptions,
      enableInteraction: this._enableInteraction,
      enablePrompts: this._enablePrompts,
      enableOrchestration: this._enableOrchestration,
      testResponses: this._testResponses,
      extraLayers: this._extraLayers,
      systemPrompt: composedSystemPrompt,
      mcpServers: this._mcpServers.length > 0 ? this._mcpServers : undefined,
      reasoningOptions: this._reasoningOptions,
      enableA2A: !!this._a2aOptions,
      a2aPort: this._a2aOptions?.port,
      a2aBasePath: this._a2aOptions?.basePath,
      contextProfile: this._contextProfile,
    });

    const hooks = [...this._hooks];
    const mcpServers = [...this._mcpServers];
    const toolsOptions = this._toolsOptions;
    const promptsOptions = this._promptsOptions;
    const a2aOptions = this._a2aOptions;
    const agentTools = this._agentTools;
    const allowDynamicSubAgents = this._allowDynamicSubAgents;
    const dynamicSubAgentOptions = this._dynamicSubAgentOptions;
    const parentProvider = this._provider;
    const parentModel = this._model;

    return Effect.gen(function* () {
      const engine = yield* ExecutionEngine.pipe(Effect.provide(baseRuntime));

      for (const hook of hooks) {
        yield* engine.registerHook(hook);
      }

      // Connect MCP servers and/or register custom tools if configured
      if (mcpServers.length > 0 || (toolsOptions?.tools && toolsOptions.tools.length > 0)) {
        const { ToolService } = yield* Effect.promise(() =>
          import("@reactive-agents/tools"),
        );
        const toolService = yield* (ToolService as any).pipe(Effect.provide(baseRuntime));

        // Connect MCP servers
        for (const mcp of mcpServers) {
          yield* (toolService as any).connectMCPServer(mcp);
        }

        // Register custom tools
        if (toolsOptions?.tools) {
          for (const tool of toolsOptions.tools) {
            yield* (toolService as any).register(tool.definition, tool.handler);
          }
        }
      }

      // Register custom prompt templates if configured
      if (promptsOptions?.templates && promptsOptions.templates.length > 0) {
        const { PromptService } = yield* Effect.promise(() =>
          import("@reactive-agents/prompts"),
        );
        const promptService = yield* (PromptService as any).pipe(Effect.provide(baseRuntime));
        for (const template of promptsOptions.templates) {
          yield* (promptService as any).register(template);
        }
      }

      // ── Agent tools: bake registrations into the runtime layer ──────────────
      //
      // Root cause of the previous bug: tools registered via `Effect.provide(runtime)`
      // inside buildEffect() wrote into a ToolService instance from Scope 1 (the
      // build() call). Each run() creates Scope 2 with a fresh ToolService — so
      // the agent tools were invisible at execution time.
      //
      // Fix: Pre-build all (definition, handler) pairs as plain JS closures, then
      // compose a Layer.effectDiscard into the runtime. The effectDiscard runs the
      // registrations during layer evaluation, INSIDE each run() scope. Because
      // Layer.merge uses reference-identity memoization, the same ToolService
      // instance (from baseRuntime) receives the registrations AND serves the engine.
      let fullRuntime: Layer.Layer<any, any> = baseRuntime as Layer.Layer<any, any>;

      if (agentTools.length > 0 || allowDynamicSubAgents) {
        const toolsMod = yield* Effect.promise(() =>
          import("@reactive-agents/tools"),
        );

        const {
          createAgentTool,
          createRemoteAgentTool,
          executeRemoteAgentTool,
        } = toolsMod;

        // Collect (definition, handler) pairs — no registration yet.
        type RegEntry = {
          def: ToolDefinition;
          handler: (args: Record<string, unknown>) => Effect.Effect<unknown, Error>;
        };
        const registrations: RegEntry[] = [];

        for (const agentTool of agentTools) {
          if (agentTool.remoteUrl) {
            // Remote A2A agent tool
            const toolDef = createRemoteAgentTool(
              agentTool.name,
              `${agentTool.remoteUrl}/.well-known/agent.json`,
              agentTool.remoteUrl,
            );
            const remoteUrl = agentTool.remoteUrl;
            const remoteClient: RemoteAgentClient = {
              sendMessage: (params: { message: { role: string; content: string }; agentCardUrl: string }) =>
                Effect.tryPromise({
                  try: () =>
                    fetch(remoteUrl, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "message/send",
                        params: {
                          message: {
                            role: params.message.role,
                            parts: [{ kind: "text", text: params.message.content }],
                          },
                        },
                        id: crypto.randomUUID(),
                      }),
                    }).then((r) => r.json()).then((d: Record<string, unknown>) =>
                      d.result as { taskId: string },
                    ),
                  catch: (e) => new Error(String(e)),
                }),
              getTask: (params: { id: string }) =>
                Effect.tryPromise({
                  try: () =>
                    fetch(remoteUrl, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "tasks/get",
                        params: { id: params.id },
                        id: crypto.randomUUID(),
                      }),
                    }).then((r) => r.json()).then((d: Record<string, unknown>) =>
                      d.result as { status: string; result: unknown },
                    ),
                  catch: (e) => new Error(String(e)),
                }),
            };
            const handler = (args: Record<string, unknown>) =>
              Effect.tryPromise({
                try: () =>
                  executeRemoteAgentTool(
                    toolDef,
                    args,
                    remoteClient,
                    `${remoteUrl}/.well-known/agent.json`,
                  ),
                catch: (e) => new Error(String(e)),
              });
            registrations.push({ def: toolDef, handler });
          } else if (agentTool.agent) {
            // Local agent tool — real sub-agent delegation
            const agentConfig: import("@reactive-agents/core").AgentConfig = {
              name: agentTool.agent.name,
              description: agentTool.agent.description ?? `Agent: ${agentTool.agent.name}`,
              capabilities: [],
            };
            const toolDef = createAgentTool(agentTool.name, agentConfig);

            const subAgentExec = toolsMod.createSubAgentExecutor(
              {
                name: agentTool.agent!.name,
                description: agentTool.agent!.description,
                provider: agentTool.agent!.provider,
                model: agentTool.agent!.model,
                tools: agentTool.agent!.tools,
                maxIterations: agentTool.agent!.maxIterations,
                systemPrompt: agentTool.agent!.systemPrompt,
                persona: agentTool.agent!.persona,
              },
              async (opts) => {
                const _subLabel = agentTool.agent!.name;
                const _taskPreview = opts.task.length > 80 ? opts.task.slice(0, 80) + "…" : opts.task;
                process.stdout.write(`\n  \x1b[36m┌─ [sub-agent: ${_subLabel}]\x1b[0m → "${_taskPreview}"\n`);
                const _subStart = Date.now();

                // Compose persona with system prompt
                let composedSystemPrompt = opts.systemPrompt;
                if (opts.persona) {
                  const personaPrompt = composePersonaToSystemPrompt(opts.persona, opts.name);
                  composedSystemPrompt = composedSystemPrompt
                    ? `${personaPrompt}\n\n${composedSystemPrompt}`
                    : personaPrompt;
                }

                const subRuntime = createRuntime({
                  agentId: opts.agentId,
                  provider: (opts.provider ?? "test") as ProviderName,
                  model: opts.model,
                  maxIterations: opts.maxIterations,
                  systemPrompt: composedSystemPrompt,
                  enableReasoning: opts.enableReasoning,
                  enableTools: opts.enableTools,
                });
                const subEngine = await Effect.runPromise(
                  ExecutionEngine.pipe(Effect.provide(subRuntime)),
                );
                const taskObj: Task = {
                  id: generateTaskId(),
                  agentId: Schema.decodeSync(AgentId)(opts.agentId),
                  type: "query" as const,
                  input: { question: opts.task },
                  priority: "medium" as const,
                  status: "pending" as const,
                  metadata: { tags: [] },
                  createdAt: new Date(),
                };
                const result: TaskResult = await Effect.runPromise(
                  subEngine.execute(taskObj).pipe(
                    Effect.provide(subRuntime as unknown as Layer.Layer<never>),
                  ),
                );
                const _subElapsed = ((Date.now() - _subStart) / 1000).toFixed(1);
                const _subIcon = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
                process.stdout.write(`  \x1b[36m└─ [sub-agent: ${_subLabel}]\x1b[0m ${_subIcon} done | ${result.metadata.tokensUsed} tok | ${_subElapsed}s\n\n`);
                return {
                  output: String(result.output ?? ""),
                  success: result.success,
                  tokensUsed: result.metadata.tokensUsed,
                };
              },
              0,
            );

            const handler = (args: Record<string, unknown>) =>
              Effect.tryPromise({
                try: () => {
                  const task = typeof args.input === "string"
                    ? args.input
                    : typeof args.message === "string"
                      ? args.message
                      : JSON.stringify(args);
                  return subAgentExec(task);
                },
                catch: (e) => new Error(String(e)),
              });
            registrations.push({ def: toolDef, handler });
          }
        }

        // Register the built-in spawn-agent tool when dynamic sub-agents are enabled.
        // The handler captures parentProvider/parentModel so spawned agents inherit
        // the parent's LLM config without any extra wiring required.
        if (allowDynamicSubAgents) {
          const spawnToolDef = toolsMod.createSpawnAgentTool();
          const defaultMaxIter = dynamicSubAgentOptions?.maxIterations ?? 5;

          const spawnHandler = (args: Record<string, unknown>) =>
            Effect.tryPromise({
              try: () => {
                const task =
                  typeof args.task === "string"
                    ? args.task
                    : JSON.stringify(args.task ?? "");
                const subName =
                  typeof args.name === "string" ? args.name : "dynamic-agent";
                const subModel =
                  typeof args.model === "string" ? args.model : undefined;
                const subMaxIter =
                  typeof args.maxIterations === "number"
                    ? args.maxIterations
                    : defaultMaxIter;

                // Extract optional persona parameters
                const subPersona = {
                  role: typeof args.role === "string" ? args.role : undefined,
                  instructions: typeof args.instructions === "string" ? args.instructions : undefined,
                  tone: typeof args.tone === "string" ? args.tone : undefined,
                };

                const executor = toolsMod.createSubAgentExecutor(
                  {
                    name: subName,
                    provider: parentProvider,
                    model: subModel ?? parentModel,
                    maxIterations: subMaxIter,
                    persona: (subPersona.role || subPersona.instructions || subPersona.tone) ? subPersona : undefined,
                  },
                  async (opts) => {
                    const _taskPreview = opts.task.length > 80 ? opts.task.slice(0, 80) + "…" : opts.task;
                    process.stdout.write(`\n  \x1b[36m┌─ [sub-agent: ${subName}]\x1b[0m → "${_taskPreview}"\n`);
                    const _subStart = Date.now();

                    // Compose persona with system prompt
                    let composedSystemPrompt = opts.systemPrompt;
                    if (opts.persona) {
                      const personaPrompt = composePersonaToSystemPrompt(opts.persona as AgentPersona, opts.name);
                      composedSystemPrompt = composedSystemPrompt
                        ? `${personaPrompt}\n\n${composedSystemPrompt}`
                        : personaPrompt;
                    }

                    const subRuntime = createRuntime({
                      agentId: opts.agentId,
                      provider: (opts.provider ?? "test") as ProviderName,
                      model: opts.model,
                      maxIterations: opts.maxIterations,
                      systemPrompt: composedSystemPrompt,
                      enableReasoning: opts.enableReasoning,
                      enableTools: opts.enableTools,
                    });
                    const subEngine = await Effect.runPromise(
                      ExecutionEngine.pipe(Effect.provide(subRuntime)),
                    );
                    const taskObj: Task = {
                      id: generateTaskId(),
                      agentId: Schema.decodeSync(AgentId)(opts.agentId),
                      type: "query" as const,
                      input: { question: opts.task },
                      priority: "medium" as const,
                      status: "pending" as const,
                      metadata: { tags: [] },
                      createdAt: new Date(),
                    };
                    const result: TaskResult = await Effect.runPromise(
                      subEngine.execute(taskObj).pipe(
                        Effect.provide(subRuntime as unknown as Layer.Layer<never>),
                      ),
                    );
                    const _subElapsed = ((Date.now() - _subStart) / 1000).toFixed(1);
                    const _subIcon = result.success ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
                    process.stdout.write(`  \x1b[36m└─ [sub-agent: ${subName}]\x1b[0m ${_subIcon} done | ${result.metadata.tokensUsed} tok | ${_subElapsed}s\n\n`);
                    return {
                      output: String(result.output ?? ""),
                      success: result.success,
                      tokensUsed: result.metadata.tokensUsed,
                    };
                  },
                  0,
                );

                return executor(task);
              },
              catch: (e) => new Error(String(e)),
            });

          registrations.push({ def: spawnToolDef, handler: spawnHandler });
        }

        // Build an init effect that registers all agent tools into the ToolService
        // found in the execution environment. No Effect.provide() here — the
        // ToolService comes from the layer environment at evaluation time.
        const agentToolInitEffect = Effect.gen(function* () {
          const ts = yield* (toolsMod.ToolService as unknown as import("effect").Context.Tag<any, any>);
          for (const { def, handler } of registrations) {
            yield* (ts as any).register(def, handler);
          }
        });

        // Layer.effectDiscard wraps the init as a side-effect layer (no service output).
        // Layer.provide(baseRuntime) satisfies the ToolService requirement.
        // Layer.merge combines baseRuntime + initLayer: Effect memoizes baseRuntime by
        // reference so both the engine and the init effect share the same ToolService.
        const agentToolInitLayer = Layer.effectDiscard(
          agentToolInitEffect as Effect.Effect<unknown, never, never>,
        ).pipe(
          Layer.provide(baseRuntime as unknown as Layer.Layer<any>),
        );

        fullRuntime = Layer.merge(
          baseRuntime as unknown as Layer.Layer<any>,
          agentToolInitLayer,
        );
      }

      // The runtime layer provides all required services dynamically; cast to
      // Layer<never> so the facade can provide it without leaking the union type.
      return new ReactiveAgent(engine, agentId, fullRuntime as unknown as Layer.Layer<never>);
    }) as Effect.Effect<ReactiveAgent, Error>;
  }
}

// ─── ReactiveAgent Facade ────────────────────────────────────────────────────

// NOTE: The engine/runtime use broad types because the runtime Layer is dynamically
// composed from optional features (reasoning, tools, guardrails, etc.), making
// precise typing impractical without phantom types. The public API (run/cancel/getContext)
// returns properly typed results via explicit type annotations.
export class ReactiveAgent {
  constructor(
    private readonly engine: {
      execute: (task: Task) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;
      cancel: (taskId: string) => Effect.Effect<void, RuntimeErrors>;
      getContext: (taskId: string) => Effect.Effect<ExecutionContext | null, never>;
    },
    readonly agentId: string,
    private readonly runtime: Layer.Layer<never>,
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
    const engine = this.engine;
    const runtime = this.runtime;

    const task: Task = {
      id: generateTaskId(),
      agentId: Schema.decodeSync(AgentId)(this.agentId),
      type: "query" as const,
      input: { question: input },
      priority: "medium" as const,
      status: "pending" as const,
      metadata: { tags: [] },
      createdAt: new Date(),
    };

    return engine.execute(task).pipe(
      Effect.map((result: TaskResult) => ({
        output: String(result.output ?? ""),
        success: result.success,
        taskId: String(result.taskId),
        agentId: String(result.agentId),
        metadata: result.metadata as AgentResultMetadata,
      })),
      Effect.mapError(
        (e: RuntimeErrors | TaskError) => {
          const err = new Error("message" in e ? e.message : String(e));
          return err;
        },
      ),
      Effect.provide(runtime),
    ) as Effect.Effect<AgentResult, Error>;
  }

  /** Cancel a running task by ID. */
  async cancel(taskId: string): Promise<void> {
    return Effect.runPromise(
      this.engine.cancel(taskId).pipe(
        Effect.mapError((e: RuntimeErrors) => new Error("message" in e ? e.message : String(e))),
        Effect.provide(this.runtime),
      ) as Effect.Effect<void>,
    );
  }

  /** Inspect context of a running task (null if not running). */
  async getContext(taskId: string): Promise<ExecutionContext | null> {
    return Effect.runPromise(
      this.engine.getContext(taskId).pipe(
        Effect.provide(this.runtime),
      ) as Effect.Effect<ExecutionContext | null>,
    );
  }
}
