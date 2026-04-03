/**
 * Launches local Reactive Agents from the Cortex UI (`POST /api/runs`).
 * Events flow through `CortexReporter` → ingest; run rows use the framework **task id** as `run_id`.
 * We pre-generate that task id, register `cortex_runs` before `run()`, and return **`{ agentId, runId }`**
 * so the UI can navigate immediately without polling for the first EventBus event.
 */
import { Effect, Context, Layer, Ref } from "effect";
import { generateTaskId } from "@reactive-agents/core";
import type { RunId } from "../types.js";
import { CortexError } from "../errors.js";
import { CortexIngestService } from "./ingest-service.js";
import { CortexStoreService } from "./store-service.js";
import { cortexLog, cortexLogRunnerExecution, formatErrorDetails } from "../cortex-log.js";
import type {
  CortexAgentToolEntry,
  CortexDynamicSubAgentsConfig,
  CortexSkillsConfig,
} from "./cortex-agent-config.js";
import { buildCortexAgent } from "./build-cortex-agent.js";

export interface LaunchParams {
  readonly prompt: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tools?: string[];
  /** Saved MCP server rows to connect with {@link ReactiveAgents.withMCP}. */
  readonly mcpServerIds?: string[];
  readonly agentTools?: CortexAgentToolEntry[];
  readonly dynamicSubAgents?: CortexDynamicSubAgentsConfig;
  readonly strategy?: string;
  readonly temperature?: number;
  readonly maxIterations?: number;
  readonly minIterations?: number;
  readonly systemPrompt?: string;
  readonly agentName?: string;
  readonly maxTokens?: number;
  readonly timeout?: number;
  readonly retryPolicy?: { enabled?: boolean; maxRetries: number; backoffMs?: number };
  readonly cacheTimeout?: number;
  readonly progressCheckpoint?: number;
  readonly fallbacks?: { enabled?: boolean; providers?: string[]; errorThreshold?: number };
  readonly metaTools?: { enabled?: boolean; brief?: boolean; find?: boolean; pulse?: boolean; recall?: boolean; harnessSkill?: boolean };
  readonly verificationStep?: string;
  readonly observabilityVerbosity?: "off" | "minimal" | "normal" | "verbose";
  /** Injected into reasoning via builder `withTaskContext`. */
  readonly taskContext?: Record<string, string>;
  /** When true, builder enables `withHealthCheck()`. */
  readonly healthCheck?: boolean;
  /** Living skills directories (framework `withSkills`). */
  readonly skills?: CortexSkillsConfig;
  /** When true, enables automatic strategy switching on loop detection. */
  readonly strategySwitching?: boolean;
  /** Memory tier selection. episodic or semantic presence → enhanced tier. */
  readonly memory?: { working?: boolean; episodic?: boolean; semantic?: boolean };
  /** Context synthesis mode passed to `.withReasoning({ synthesis })`. */
  readonly contextSynthesis?: "auto" | "template" | "llm" | "none";
  /** Guardrails config; wires `.withGuardrails()` when enabled. */
  readonly guardrails?: { enabled?: boolean; injectionThreshold?: number; piiThreshold?: number; toxicityThreshold?: number };
  /** Persona config; wires `.withPersona()` when enabled. */
  readonly persona?: { enabled?: boolean; role?: string; tone?: string; traits?: string; responseStyle?: string };
}

type ActiveEntry = {
  readonly agentId: string;
  readonly startedAt: number;
};

export class CortexRunnerService extends Context.Tag("CortexRunnerService")<
  CortexRunnerService,
  {
    readonly start: (params: LaunchParams) => Effect.Effect<
      { agentId: string; runId: string },
      CortexError
    >;
    readonly pause: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly stop: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly getActive: () => Effect.Effect<ReadonlyMap<string, ActiveEntry>, never>;
  }
>() {}

const defaultCortexHttpUrl = (): string =>
  process.env.CORTEX_URL?.replace(/^ws/, "http") ?? "http://127.0.0.1:4321";

export const CortexRunnerServiceLive = Layer.effect(
  CortexRunnerService,
  Effect.gen(function* () {
    // Services captured here during Layer composition — NOT inside method bodies.
    // Effect-TS Layer context is only available during build time; method closures
    // must reference captured values, not yield from the service context.
    const store = yield* CortexStoreService;
    const ingest = yield* CortexIngestService;
    const activeRef = yield* Ref.make(new Map<string, ActiveEntry>());

    return {
      start: (params) =>
        Effect.gen(function* () {
          const providerRaw = params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test";

          const mcpConfigs =
            params.mcpServerIds && params.mcpServerIds.length > 0
              ? yield* store.getMcpServerConfigsByIds(params.mcpServerIds)
              : [];

          const agent = yield* Effect.tryPromise({
            try: () =>
              buildCortexAgent({
                agentName: params.agentName,
                provider: providerRaw,
                model: params.model,
                temperature: params.temperature,
                maxTokens: params.maxTokens,
                strategy: params.strategy,
                maxIterations: params.maxIterations,
                minIterations: params.minIterations,
                systemPrompt: params.systemPrompt,
                taskContext: params.taskContext,
                healthCheck: params.healthCheck,
                skills: params.skills,
                mcpConfigs,
                tools: params.tools,
                agentTools: params.agentTools,
                dynamicSubAgents: params.dynamicSubAgents,
                metaTools: params.metaTools,
                timeout: params.timeout,
                retryPolicy: params.retryPolicy,
                cacheTimeout: params.cacheTimeout,
                progressCheckpoint: params.progressCheckpoint,
                fallbacks: params.fallbacks,
                verificationStep: params.verificationStep,
                observabilityVerbosity: params.observabilityVerbosity,
                strategySwitching: params.strategySwitching,
                memory: params.memory,
                contextSynthesis: params.contextSynthesis,
                guardrails: params.guardrails,
                persona: params.persona,
              }),
            catch: (e) => new CortexError({ message: `Failed to build agent: ${String(e)}`, cause: e }),
          });

          const agentId = agent.agentId;
          const runId = generateTaskId();
          const startedAt = Date.now();

          yield* store.ensureRunRow(agentId, runId);
          yield* Ref.update(activeRef, (m) => new Map(m).set(agentId, { agentId, startedAt }));
          let forwardedEvents = 0;

          const unsubscribe = yield* Effect.tryPromise({
            try: () =>
              agent.subscribe((event) => {
                forwardedEvents += 1;
                if (forwardedEvents === 1 || forwardedEvents % 25 === 0) {
                  cortexLog("debug", "runner", "forwarding agent event to ingest", {
                    agentId,
                    runId,
                    n: forwardedEvents,
                    tag: event._tag,
                  });
                }
                Effect.runFork(
                  ingest
                    .handleEvent(agentId, runId, {
                      v: 1,
                      agentId,
                      runId,
                      event,
                    })
                    .pipe(Effect.catchAll(() => Effect.void)),
                );
              }),
            catch: (e) =>
              new CortexError({
                message: `Failed to subscribe runner to agent events: ${String(e)}`,
                cause: e,
              }),
          });

          const cortexHttp = defaultCortexHttpUrl();
          cortexLog("info", "runner", "starting agent.run (events piped directly to ingest)", {
            agentId,
            runId,
            provider: providerRaw,
            cortexUrl: cortexHttp,
            tools: params.tools?.length ? params.tools : [],
            observabilityVerbosity: params.observabilityVerbosity ?? "off",
            promptChars: params.prompt.length,
          });
          cortexLog("debug", "runner", "runner launch params", {
            agentId,
            runId,
            params,
          });

          void agent
            .run(params.prompt, { taskId: runId })
            .then((result) => {
              // The framework's DebriefCompleted event is not yet wired in the
              // execution engine. Emit it here from AgentResult.debrief so the
              // Debrief tab shows for agents launched from Cortex.
              const debrief = (result as any).debrief;
              if (debrief && typeof debrief === "object") {
                cortexLog("info", "runner", "emitting DebriefCompleted from agent result", {
                  agentId, runId,
                });
                Effect.runFork(
                  ingest
                    .handleEvent(agentId, runId, {
                      v: 1,
                      agentId,
                      runId,
                      event: {
                        _tag: "DebriefCompleted" as const,
                        taskId: runId,
                        agentId,
                        debrief,
                      } as any,
                    })
                    .pipe(Effect.catchAll(() => Effect.void)),
                );
              }
            })
            .catch((err) => {
              cortexLogRunnerExecution("agent.run rejected or threw", {
                agentId,
                runId,
                ...formatErrorDetails(err),
              });
            })
            .finally(() => {
              try {
                unsubscribe();
              } catch {
                // ignore unsubscribe errors in fire-and-forget path
              }
              void Effect.runPromise(
                Ref.update(activeRef, (m) => {
                  const copy = new Map(m);
                  copy.delete(agentId);
                  return copy;
                }),
              );
            });

          return { agentId, runId };
        }),

      pause: (runId) =>
        Effect.log(`Pause requested for run ${runId} (not yet wired to execution engine)`),

      stop: (runId) =>
        Effect.gen(function* () {
          yield* Ref.update(activeRef, (m) => {
            const copy = new Map(m);
            copy.delete(String(runId));
            return copy;
          });
          yield* Effect.log(`Stop recorded for ${runId} (abort/dispose wiring is limited in this MVP)`);
        }),

      getActive: () => Ref.get(activeRef),
    };
  }),
);
