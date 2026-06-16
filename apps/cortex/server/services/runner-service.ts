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
import { durableApprovals } from "./durable-approvals.js";
import { CortexStoreService } from "./store-service.js";
import { cortexLog, cortexLogRunnerExecution, formatErrorDetails } from "../cortex-log.js";
import type {
  CortexAgentToolEntry,
  CortexDynamicSubAgentsConfig,
  CortexSkillsConfig,
} from "./cortex-agent-config.js";
import { buildCortexAgent } from "./build-cortex-agent.js";
import { resolveLaunchPayload } from "./resolve-template.js";
import type { VariableDef } from "./resolve-template.js";
import type { ReactiveAgent } from "@reactive-agents/runtime";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

export interface LaunchParams {
  readonly prompt: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tools?: string[];
  /** Merged with {@link tools} when building `allowedTools`. */
  readonly additionalToolNames?: string;
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
  readonly numCtx?: number;
  readonly timeout?: number;
  readonly retryPolicy?: { enabled?: boolean; maxRetries: number; backoffMs?: number };
  readonly cacheTimeout?: number;
  readonly progressCheckpoint?: number;
  readonly fallbacks?: { enabled?: boolean; providers?: string[]; errorThreshold?: number };
  readonly metaTools?: { enabled?: boolean; brief?: boolean; find?: boolean; pulse?: boolean; recall?: boolean; harnessSkill?: boolean };
  readonly verificationStep?: string;
  /** Framework verification package (`withVerification`). */
  readonly runtimeVerification?: boolean;
  /** Host shell-execute tool (`withTerminalTools` / `terminal: true`). */
  readonly terminalTools?: boolean;
  /** Passed to `ShellExecuteConfig.additionalCommands` when host shell is on. */
  readonly terminalShellAdditionalCommands?: string;
  /** Passed to `ShellExecuteConfig.allowedCommands` when non-empty (replaces defaults). */
  readonly terminalShellAllowedCommands?: string;
  readonly observabilityVerbosity?: "off" | "minimal" | "normal" | "verbose";
  /** Injected into reasoning via builder `withTaskContext`. */
  readonly taskContext?: Record<string, string>;
  /** When true, builder enables `withHealthCheck()`. */
  readonly healthCheck?: boolean;
  /** Living skills directories (framework `withSkills`). */
  readonly skills?: CortexSkillsConfig;
  /** Variable definitions for `{{token}}` substitution in this payload. */
  readonly variables?: VariableDef[];
  /** Caller-supplied values for `{{token}}` substitution. */
  readonly variableValues?: Record<string, string | number>;
  /** When true, enables automatic strategy switching on loop detection. */
  readonly strategySwitching?: boolean;
  /** Opt-in per-tool-call decision rationale in debrief (`ReasoningOptions.auditRationale`). */
  readonly auditRationale?: boolean;
  /** Memory tier selection. episodic or semantic presence → enhanced tier. */
  readonly memory?: { working?: boolean; episodic?: boolean; semantic?: boolean };
  /** Context synthesis mode passed to `.withReasoning({ synthesis })`. */
  readonly contextSynthesis?: "auto" | "template" | "llm" | "none";
  /** Guardrails config; wires `.withGuardrails()` when enabled. */
  readonly guardrails?: { enabled?: boolean; injectionThreshold?: number; piiThreshold?: number; toxicityThreshold?: number };
  /** Persona config; wires `.withPersona()` when enabled. */
  readonly persona?: { enabled?: boolean; role?: string; tone?: string; traits?: string; responseStyle?: string };
  /**
   * Run the full reasoning kernel (default true). `false` → lighter inline-think
   * path. Durable runs force it on. UI "Reasoning kernel" toggle.
   */
  readonly useReasoning?: boolean;
  /** Typed structured output — JSON Schema the answer is extracted into (`result.object`). */
  readonly outputSchema?: Record<string, unknown>;
  /** Parse-fail behaviour for {@link outputSchema}. */
  readonly outputSchemaOnParseFail?: "degrade" | "throw";
  /**
   * Durable execution (v0.12) — opt-in crash-resume + durable HITL.
   * `enabled` wires `.withDurableRuns(...)`; `approvalPolicy.tools` additionally
   * wires `.withApprovalPolicy(...)` so the run pauses (`awaiting-approval`) on
   * those tools and can be approved/denied from the desk.
   */
  readonly durableRuns?: {
    readonly enabled?: boolean;
    readonly checkpointEvery?: number;
    readonly dir?: string;
    readonly approvalPolicy?: { tools?: string[]; mode?: "detach" | "block" };
  };
}

/** Active desk run: keyed by framework task id (`runId`), same id passed to `agent.run(..., { taskId })`. */
type ActiveEntry = {
  readonly agentId: string;
  readonly runId: string;
  readonly agent: ReactiveAgent;
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
    readonly resume: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly stop: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly getActive: () => Effect.Effect<ReadonlyMap<string, ActiveEntry>, never>;
    // ── Durable HITL (Phase E) — operate on agents retained while a durable run
    // is paused awaiting approval (in-process, live-session). ──
    /** Pending durable approvals across all paused runs in this process. */
    readonly listPendingApprovals: () => Effect.Effect<
      readonly { runId: string; agentId: string; gateId: string; toolName: string; args: unknown }[],
      never
    >;
    /** Approve a paused run's pending tool call; the run continues durably. */
    readonly approveApproval: (runId: RunId, reason?: string) => Effect.Effect<void, CortexError>;
    /** Deny a paused run's pending tool call; the run is terminated. */
    readonly denyApproval: (runId: RunId, reason: string) => Effect.Effect<void, CortexError>;
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
      start: (rawParams) =>
        Effect.gen(function* () {
          const { value: params, unresolved } = resolveLaunchPayload(rawParams);
          if (unresolved.length > 0) {
            return yield* Effect.fail(
              new CortexError({
                message: `Unresolved template variable(s): ${unresolved.join(", ")}`,
              }),
            );
          }
          const providerRaw = params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test";

          const mcpConfigs =
            params.mcpServerIds && params.mcpServerIds.length > 0
              ? yield* store.getMcpServerConfigsByIds(params.mcpServerIds)
              : [];

          const agent = yield* Effect.tryPromise({
            try: () =>
              buildCortexAgent({
                ...(params.agentName ? { agentName: params.agentName } : {}),
                provider: providerRaw,
                ...(params.model ? { model: params.model } : {}),
                ...(params.temperature != null ? { temperature: params.temperature } : {}),
                ...(params.maxTokens != null ? { maxTokens: params.maxTokens } : {}),
                ...(typeof params.numCtx === "number" && params.numCtx > 0 ? { numCtx: params.numCtx } : {}),
                ...(params.strategy ? { strategy: params.strategy } : {}),
                ...(params.maxIterations != null ? { maxIterations: params.maxIterations } : {}),
                ...(params.minIterations != null ? { minIterations: params.minIterations } : {}),
                ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
                ...(params.taskContext ? { taskContext: params.taskContext } : {}),
                ...(params.healthCheck != null ? { healthCheck: params.healthCheck } : {}),
                ...(params.skills ? { skills: params.skills } : {}),
                mcpConfigs,
                ...(params.tools ? { tools: params.tools } : {}),
                ...(params.additionalToolNames?.trim()
                  ? { additionalToolNames: params.additionalToolNames.trim() }
                  : {}),
                ...(params.agentTools ? { agentTools: params.agentTools } : {}),
                ...(params.dynamicSubAgents ? { dynamicSubAgents: params.dynamicSubAgents } : {}),
                ...(params.metaTools ? { metaTools: params.metaTools } : {}),
                ...(params.timeout != null ? { timeout: params.timeout } : {}),
                ...(params.retryPolicy ? { retryPolicy: params.retryPolicy } : {}),
                ...(params.cacheTimeout != null ? { cacheTimeout: params.cacheTimeout } : {}),
                ...(params.progressCheckpoint != null ? { progressCheckpoint: params.progressCheckpoint } : {}),
                ...(params.fallbacks ? { fallbacks: params.fallbacks } : {}),
                ...(params.verificationStep ? { verificationStep: params.verificationStep } : {}),
                ...(params.runtimeVerification === true ? { runtimeVerification: true as const } : {}),
                ...(params.terminalTools === true ? { terminalTools: true as const } : {}),
                ...(params.terminalShellAdditionalCommands?.trim()
                  ? { terminalShellAdditionalCommands: params.terminalShellAdditionalCommands.trim() }
                  : {}),
                ...(params.terminalShellAllowedCommands?.trim()
                  ? { terminalShellAllowedCommands: params.terminalShellAllowedCommands.trim() }
                  : {}),
                ...(params.observabilityVerbosity ? { observabilityVerbosity: params.observabilityVerbosity } : {}),
                ...(params.strategySwitching != null ? { strategySwitching: params.strategySwitching } : {}),
                ...(params.auditRationale === true ? { auditRationale: true as const } : {}),
                ...(params.memory ? { memory: params.memory } : {}),
                ...(params.contextSynthesis ? { contextSynthesis: params.contextSynthesis } : {}),
                ...(params.guardrails ? { guardrails: params.guardrails } : {}),
                ...(params.persona ? { persona: params.persona } : {}),
                ...(params.useReasoning !== undefined ? { useReasoning: params.useReasoning } : {}),
                ...(params.outputSchema ? { outputSchema: params.outputSchema } : {}),
                ...(params.outputSchemaOnParseFail ? { outputSchemaOnParseFail: params.outputSchemaOnParseFail } : {}),
                ...(params.durableRuns?.enabled ? { durableRuns: params.durableRuns } : {}),
              }),
            catch: (e) => new CortexError({ message: `Failed to build agent: ${String(e)}`, cause: e }),
          });

          const agentId = agent.agentId;
          const runId = generateTaskId();
          const startedAt = Date.now();

          yield* store.ensureRunRow(agentId, runId, {
            ...(params.agentName?.trim() ? { displayName: params.agentName.trim() } : {}),
          });
          yield* Ref.update(activeRef, (m) =>
            new Map(m).set(runId, { agentId, runId, agent, startedAt }),
          );
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
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:198", tag: errorTag(err) }))),
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

          // Durable HITL: when a durable run pauses for approval, run() resolves
          // with status "awaiting-approval". Retain the agent so approveRun/denyRun
          // can drive it later; the `.finally` dispose is skipped while paused.
          let paused = false;

          void agent
            .run(params.prompt, { taskId: runId })
            .then((result) => {
              const r = result as { status?: string; pendingApproval?: { runId: string } };
              if (r.status === "awaiting-approval" && r.pendingApproval) {
                paused = true;
                // Retain the agent in the SHARED registry keyed by the DURABLE
                // runId (what listPendingApprovals surfaces + approve/deny use;
                // it differs from the cortex taskId — runDurable mints its own).
                const durableRunId = r.pendingApproval.runId;
                cortexLog("info", "runner", "durable run paused — awaiting approval", { agentId, runId, durableRunId });
                durableApprovals.register({ agentId, durableRunId, agent, startedAt });
              }
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
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:248", tag: errorTag(err) }))),
                );
              }
              // Typed structured output (v0.12): surface result.object / objectError
              // so the desk can render the extracted typed value. Emitted as a
              // synthetic event (the framework has no StructuredOutput event yet);
              // the live message carries the _tag string + payload verbatim.
              const ro = result as { object?: unknown; objectError?: string };
              if (ro.object !== undefined || ro.objectError !== undefined) {
                Effect.runFork(
                  ingest
                    .handleEvent(agentId, runId, {
                      v: 1,
                      agentId,
                      runId,
                      event: {
                        _tag: "StructuredOutputExtracted" as const,
                        taskId: runId,
                        agentId,
                        ...(ro.object !== undefined ? { object: ro.object } : {}),
                        ...(ro.objectError !== undefined ? { objectError: ro.objectError } : {}),
                      } as any,
                    })
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:structured-output", tag: errorTag(err) }))),
                );
              }
            })
            .catch((err) => {
              cortexLogRunnerExecution("agent.run rejected or threw", {
                agentId,
                runId,
                ...formatErrorDetails(err),
              });
              // Emit AgentCompleted with error so the UI transitions out of "loading"
              const errorMessage = err instanceof Error ? err.message : String(err);
              Effect.runFork(
                ingest
                  .handleEvent(agentId, runId, {
                    v: 1,
                    agentId,
                    runId,
                    event: {
                      _tag: "AgentCompleted" as const,
                      taskId: runId,
                      agentId,
                      success: false,
                      totalIterations: 0,
                      totalTokens: 0,
                      durationMs: Date.now() - startedAt,
                      error: errorMessage,
                    } as any,
                  })
                  .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:277", tag: errorTag(err) }))),
              );
            })
            .finally(() => {
              // Paused (awaiting-approval) durable runs keep their agent + event
              // subscription alive so approveRun/denyRun can resume the SAME
              // instance. Cleanup happens when the approval is resolved.
              if (paused) {
                void Effect.runPromise(
                  Ref.update(activeRef, (m) => {
                    const copy = new Map(m);
                    copy.delete(runId);
                    return copy;
                  }),
                );
                return;
              }
              try {
                unsubscribe();
              } catch {
                // ignore unsubscribe errors in fire-and-forget path
              }
              // Release the agent's resources — MCP transports and their docker
              // containers — now that the run is done. Without this the container
              // leaks and a later run with the same name hits
              // "container name already in use".
              void agent.dispose().catch((err) => {
                cortexLog("warn", "runner", "agent.dispose() failed on run finish", {
                  agentId,
                  runId,
                  ...formatErrorDetails(err),
                });
              });
              void Effect.runPromise(
                Ref.update(activeRef, (m) => {
                  const copy = new Map(m);
                  copy.delete(runId);
                  return copy;
                }),
              );
            });

          return { agentId, runId };
        }),

      pause: (runId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(activeRef);
          const entry = m.get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "pause: run not active (already finished?)", { runId });
            return;
          }
          yield* Effect.promise(() => entry.agent.pause()).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:306", tag: errorTag(err) })));
        }),

      resume: (runId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(activeRef);
          const entry = m.get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "resume: run not active", { runId });
            return;
          }
          yield* Effect.promise(() => entry.agent.resume()).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:317", tag: errorTag(err) })));
        }),

      stop: (runId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(activeRef);
          const entry = m.get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "stop: run not active", { runId });
            return;
          }
          yield* Effect.promise(() => entry.agent.stop("Cortex UI stop")).pipe(
            Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:329", tag: errorTag(err) })),
          );
        }),

      getActive: () => Ref.get(activeRef),

      // Reads the SHARED registry, so approvals from BOTH the runner and the
      // gateway (saved-agent) launch paths are surfaced + actionable.
      listPendingApprovals: () =>
        Effect.gen(function* () {
          const out: { runId: string; agentId: string; gateId: string; toolName: string; args: unknown }[] = [];
          for (const entry of durableApprovals.list()) {
            const pendings = yield* Effect.promise(() => entry.agent.listPendingApprovals()).pipe(
              Effect.catchAll(() => Effect.succeed([] as readonly unknown[])),
            );
            for (const p of pendings as readonly { runId?: string; gateId?: string; toolName?: string; args?: unknown }[]) {
              out.push({
                runId: p.runId ?? entry.durableRunId,
                agentId: entry.agentId,
                gateId: p.gateId ?? "",
                toolName: p.toolName ?? "",
                args: p.args ?? null,
              });
            }
          }
          return out;
        }),

      approveApproval: (runId, reason) =>
        Effect.gen(function* () {
          const entry = durableApprovals.get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "approve: run not pending approval", { runId });
            return;
          }
          const result = yield* Effect.tryPromise({
            try: () => entry.agent.approveRun(String(runId), reason ? { reason } : undefined),
            catch: (e) => new CortexError({ message: `approveRun failed: ${String(e)}`, cause: e }),
          });
          // Re-pause if it hit another gate; otherwise the run is done — clean up.
          if ((result as { status?: string }).status === "awaiting-approval") {
            cortexLog("info", "runner", "durable run re-paused after approval", { runId });
            return;
          }
          yield* Effect.promise(() => durableApprovals.finalize(String(runId)));
        }),

      denyApproval: (runId, reason) =>
        Effect.gen(function* () {
          const entry = durableApprovals.get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "deny: run not pending approval", { runId });
            return;
          }
          yield* Effect.tryPromise({
            try: () => entry.agent.denyRun(String(runId), reason),
            catch: (e) => new CortexError({ message: `denyRun failed: ${String(e)}`, cause: e }),
          });
          yield* Effect.promise(() => durableApprovals.finalize(String(runId)));
        }),
    };
  }),
);
