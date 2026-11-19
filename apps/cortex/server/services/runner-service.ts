/**
 * Launches local Reactive Agents from the Cortex UI (`POST /api/runs`).
 * Events flow through `CortexReporter` → ingest; run rows use the framework **task id** as `run_id`.
 * We pre-generate that task id, register `cortex_runs` before `run()`, and return **`{ agentId, runId }`**
 * so the UI can navigate immediately without polling for the first EventBus event.
 */
import { Effect, Context, Layer, Ref } from "effect";
import { emitErrorSwallowed, errorTag, generateTaskId, type InteractionQuestion } from "@reactive-agents/core";
import type { TestTurn } from "@reactive-agents/llm-provider";
import type { RunId } from "../types.js";
import { CortexError } from "../errors.js";
import { CortexIngestService } from "./ingest-service.js";
import { waitsLive, durableApprovals, type PendingApprovalRow } from "./durable-approvals.js";
import { CortexStoreService } from "./store-service.js";
import { cortexLog, cortexLogRunnerExecution, formatErrorDetails } from "../cortex-log.js";
import type {
  CortexAgentToolEntry,
  CortexDynamicSubAgentsConfig,
  CortexShellOptions,
  CortexSkillsConfig,
} from "./cortex-agent-config.js";
import { buildCortexAgent, type BuildCortexAgentParams, type MCPServerConfig } from "./build-cortex-agent.js";
import type { CortexJudgmentConfig } from "./cortex-judgment.js";
import { resolveLaunchPayload, type VariableDef } from "./resolve-template.js";
import type { CortexApprovalPolicy } from "./approval-policy.js";
import type { ReactiveAgent, ResumeRunOptions } from "@reactive-agents/runtime";
import { runCostSettled } from "./run-cost-settled.js";
import type { CrashedRun } from "./crashed-runs.js";
import { decideApproval, interruptLiveRun, settledWithin, type InterruptOutcome } from "./run-interrupt.js";
import { structuredOutputExtractedEvent } from "./structured-output-event.js";
import { ingestRunFailure, makeDeskContinue, STOP_EVENT_TAGS, type StopControl } from "./desk-continue.js";

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
  readonly thinking?: boolean;
  readonly timeout?: number;
  readonly retryPolicy?: { enabled?: boolean; maxRetries: number; backoffMs?: number };
  readonly fallbacks?: { enabled?: boolean; providers?: string[]; errorThreshold?: number };
  readonly metaTools?: { enabled?: boolean; brief?: boolean; find?: boolean; pulse?: boolean; recall?: boolean; harnessSkill?: boolean; todo?: boolean; todoGuidance?: { reminder?: boolean; systemLine?: boolean } };
  readonly observability?: { checklist?: boolean };
  readonly verificationStep?: string;
  /** Framework verification package (`withVerification`). */
  readonly runtimeVerification?: boolean;
  /** Host shell-execute tool (`withTerminalTools` / `terminal: true`). */
  readonly terminalTools?: boolean;
  /** Passed to `ShellExecuteConfig.additionalCommands` when host shell is on. */
  readonly terminalShellAdditionalCommands?: string;
  /** Passed to `ShellExecuteConfig.allowedCommands` when non-empty (replaces defaults). */
  readonly terminalShellAllowedCommands?: string;
  /** Host-shell cwd / timeout / output cap / command groups / sandbox. */
  readonly terminalShellOptions?: CortexShellOptions;
  /** Agent working directory (`.withTools({ workspace })`), already checked by the route. */
  readonly workspace?: string;
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
  readonly guardrails?: BuildCortexAgentParams["guardrails"];
  /** Persona config; wires `.withPersona()` when enabled. */
  readonly persona?: { enabled?: boolean; role?: string; tone?: string; traits?: string; responseStyle?: string };
  /** Typed structured output — JSON Schema the answer is extracted into (`result.object`). */
  readonly outputSchema?: Record<string, unknown>;
  /** Parse-fail behaviour for {@link outputSchema}. */
  readonly outputSchemaOnParseFail?: "degrade" | "throw";
  readonly harness?: Record<string, unknown>;
  readonly documents?: ReadonlyArray<{ source: string; content?: string; format?: string; chunkStrategy?: string; maxChunkSize?: number }>;
  /** Cost/token budget caps — `.withBudget()`. */
  readonly budget?: { tokenLimit?: number; costLimit?: number };
  /** Numeric evidence-grounding — `.withGrounding()`. */
  readonly grounding?: { mode: "warn" | "block"; tolerance?: number };
  /** Fabrication guard override — `.withFabricationGuard()`. Always-on at "block" by default; pass to override. */
  readonly fabricationGuard?: "off" | "warn" | "block";
  /** Judgment backend — `.withJudgment()` (an overlay; see build-cortex-agent.ts). */
  readonly judgment?: CortexJudgmentConfig;
  /** Cost-aware model routing (`.withModelRouting()`). enabled=false → not applied. */
  readonly modelRouting?: {
    readonly enabled?: boolean;
    readonly minTier?: "haiku" | "sonnet" | "opus";
    readonly tierModels?: Partial<Record<"haiku" | "sonnet" | "opus", string>>;
  };
  /** Generic framework-config overrides from the type-introspected renderer — a
   * partial nested AgentConfig (manifest configField paths). Deep-merged under
   * the curated config; see cortex-to-agent-config.ts. */
  readonly rawConfig?: Record<string, unknown>;
  /** Durable execution (v0.12) — opt-in crash-resume: `enabled` wires `.withDurableRuns(...)`. */
  readonly durableRuns?: {
    readonly enabled?: boolean;
    readonly checkpointEvery?: number;
    readonly dir?: string;
  };
  /**
   * Approval gate (`AgentConfig.approvalPolicy`): tools and shell command rules
   * that need approval. Without durable runs a `detach` run waits live and is
   * listed through its running agent; with them it pauses (`awaiting-approval`) and is
   * approved or denied from the desk.
   */
  readonly approvalPolicy?: CortexApprovalPolicy;
  /**
   * Test-only: scripted `test`-provider turns (`.withTestScenario`). Not exposed
   * on any HTTP route schema — for driving the real `start()` path deterministically
   * from tests (e.g. the durable interaction-rail e2e), never from the desk UI.
   */
  readonly testScenario?: readonly TestTurn[];
}

/**
 * The `buildCortexAgent` params for a desk run (Lab / `POST /api/runs`). Pure, so the
 * three build paths (runner, chat, gateway) can be compared on one fixture
 * (`build-path-parity.test.ts`). `provider` and `mcpConfigs` are resolved by the caller.
 */
export function launchParamsToBuildParams(
  params: LaunchParams,
  provider: string,
  mcpConfigs: readonly MCPServerConfig[],
): BuildCortexAgentParams {
  return {
    ...(params.agentName ? { agentName: params.agentName } : {}),
    provider,
    ...(params.model ? { model: params.model } : {}),
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.maxTokens != null ? { maxTokens: params.maxTokens } : {}),
    ...(typeof params.numCtx === "number" && params.numCtx > 0 ? { numCtx: params.numCtx } : {}),
    ...(typeof params.thinking === "boolean" ? { thinking: params.thinking } : {}),
    ...(params.strategy ? { strategy: params.strategy } : {}),
    ...(params.maxIterations != null ? { maxIterations: params.maxIterations } : {}),
    ...(params.minIterations != null ? { minIterations: params.minIterations } : {}),
    ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
    ...(params.taskContext ? { taskContext: params.taskContext } : {}),
    ...(params.healthCheck != null ? { healthCheck: params.healthCheck } : {}),
    ...(params.skills ? { skills: params.skills } : {}),
    mcpConfigs: [...mcpConfigs],
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.additionalToolNames?.trim()
      ? { additionalToolNames: params.additionalToolNames.trim() }
      : {}),
    ...(params.agentTools ? { agentTools: params.agentTools } : {}),
    ...(params.dynamicSubAgents ? { dynamicSubAgents: params.dynamicSubAgents } : {}),
    ...(params.metaTools ? { metaTools: params.metaTools } : {}),
    ...(params.observability ? { observability: params.observability } : {}),
    ...(params.timeout != null ? { timeout: params.timeout } : {}),
    ...(params.retryPolicy ? { retryPolicy: params.retryPolicy } : {}),
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
    ...(params.outputSchema ? { outputSchema: params.outputSchema } : {}),
    ...(params.outputSchemaOnParseFail ? { outputSchemaOnParseFail: params.outputSchemaOnParseFail } : {}),
    ...(params.budget ? { budget: params.budget } : {}),
    ...(params.grounding ? { grounding: params.grounding } : {}),
    ...(params.fabricationGuard ? { fabricationGuard: params.fabricationGuard } : {}),
    ...(params.judgment ? { judgment: params.judgment } : {}),
    ...(params.modelRouting?.enabled ? { modelRouting: params.modelRouting } : {}),
    ...(params.harness ? { harness: params.harness } : {}),
    ...(params.documents && params.documents.length > 0 ? { documents: [...params.documents] } : {}),
    ...(params.rawConfig && Object.keys(params.rawConfig).length > 0 ? { rawConfig: params.rawConfig } : {}),
    ...(params.durableRuns?.enabled ? { durableRuns: params.durableRuns } : {}),
    ...(params.approvalPolicy ? { approvalPolicy: params.approvalPolicy } : {}),
    ...(params.workspace ? { workspace: params.workspace } : {}),
    ...(params.terminalShellOptions ? { terminalShellOptions: params.terminalShellOptions } : {}),
    ...(params.testScenario && params.testScenario.length > 0
      ? { testScenario: [...params.testScenario] }
      : {}),
  };
}

/** Active desk run: keyed by framework task id (`runId`), same id passed to `agent.run(..., { taskId })`. */
export type ActiveEntry = {
  readonly agentId: string;
  readonly runId: string;
  readonly agent: ReactiveAgent;
  readonly startedAt: number;
  /** Event-forwarding unsubscribe; set once the subscription is established so
   * terminate() can tear it down without the run's own `.finally` closure. */
  readonly unsubscribe?: () => void;
  /** Resolves once `agent.run()` has settled (its `.finally` ran). */
  readonly settled?: Promise<void>;
  /** What the user asked for (Stop or Terminate) and whether the run already reported it. */
  readonly control?: StopControl;
  /** Ingest the user's stop as the run's terminal event, unless the run already published one. */
  readonly endAsStopped?: () => Effect.Effect<void>;
};

/** Timing knobs for the desk Stop / Terminate paths (tests shorten them). */
export interface CortexRunnerOptions {
  /**
   * How long Stop waits for the run to stop gracefully before ending it like
   * Terminate. `agent.stop()` is honoured only at the next execution-engine
   * phase boundary, and the reasoning loop is one phase, so a run inside a
   * long model call or many iterations would otherwise keep going (observed:
   * no effect in 60s). Default 5s.
   */
  readonly stopGraceMs?: number;
  /** How long Terminate waits for `agent.run()` to settle before disposing the agent anyway. Default 5s. */
  readonly settleTimeoutMs?: number;
}

export class CortexRunnerService extends Context.Tag("CortexRunnerService")<
  CortexRunnerService,
  {
    readonly start: (params: LaunchParams) => Effect.Effect<
      { agentId: string; runId: string },
      CortexError
    >;
    /**
     * Resume a desk run a crash left mid-run (`findCrashedRuns`): rebuild its agent
     * from the stored launch config under the same agent id and call the
     * framework's `agent.resumeRun(durableRunId, { ...opts, newRun: true })` (`opts`: loop-stop `{ note?, extraIterations? }`).
     * The continuation is a NEW linked Cortex run (`desk-continue.ts`): resolves to its id once it has started; the parent row is untouched.
     */
    readonly resumeCrashed: (crashed: CrashedRun, opts?: ResumeRunOptions) => Effect.Effect<{ agentId: string; runId: string }, CortexError>;
    /** Pause a run: a durable run ends at its next step with a saved place to continue from (`persisted`); other runs pause in process (`not-live`). */
    readonly pause: (runId: RunId) => Effect.Effect<InterruptOutcome, CortexError>;
    readonly resume: (runId: RunId) => Effect.Effect<void, CortexError>;
    /** Stop a run; same outcome words as `pause`. */
    readonly stop: (runId: RunId) => Effect.Effect<InterruptOutcome, CortexError>;
    /** Immediately abort an in-flight run (interrupts the agent fiber) and tear
     * down its resources now, rather than waiting for a phase boundary. */
    readonly terminate: (runId: RunId) => Effect.Effect<void, CortexError>;
    readonly getActive: () => Effect.Effect<ReadonlyMap<string, ActiveEntry>, never>;
    // ── Durable HITL (Phase E) — operate on agents retained while a durable run
    // is paused awaiting approval (in-process, live-session). ──
    /** Pending durable approvals across all paused runs in this process. */
    readonly listPendingApprovals: () => Effect.Effect<readonly PendingApprovalRow[], never>;
    /** Approve a paused run's pending tool call; the run continues durably. `gateId` targets one request (parallel sub-agents share the run id). */
    readonly approveApproval: (runId: RunId, reason?: string, gateId?: string) => Effect.Effect<void, CortexError>;
    /** Deny a paused run's pending tool call; the run is terminated. `gateId` targets one request. */
    readonly denyApproval: (runId: RunId, reason: string, gateId?: string) => Effect.Effect<void, CortexError>;
    // ── Durable interaction rail (Agentic-UI) — `request_user_input` pauses,
    // clone of the approval rail above. ──
    /** Pending durable `request_user_input` pauses across all paused runs in this process. */
    readonly listPendingInteractions: () => Effect.Effect<
      readonly {
        runId: string;
        interactionId: string;
        kind: string;
        prompt: string;
        schema: unknown;
        /** Typed questions of a structured ask; absent for a legacy `kind` + `schema` one. Answer with an id-keyed map. */
        questions?: readonly InteractionQuestion[];
        task: string;
        updatedAt: number;
        /** Set on a live question (no durable runs): the agent asking and, for a chat, its session. */
        agentId?: string;
        chatSessionId?: string;
      }[],
      never
    >;
    /** Record a human's response to a paused interaction; the run resumes durably. */
    readonly respondToInteraction: (
      runId: RunId,
      interactionId: string,
      value: unknown,
    ) => Effect.Effect<{ success: boolean; output: string }, CortexError>;
  }
>() {}

/** This server's URL for the launch log (events go straight to ingest, not over HTTP). */
const defaultCortexHttpUrl = (): string =>
  process.env.CORTEX_URL?.replace(/^ws/, "http") ?? `http://127.0.0.1:${process.env.CORTEX_PORT ?? "4321"}`;

/** Build the runner layer with custom Stop / Terminate timing (`CortexRunnerServiceLive` uses the defaults). */
export const makeCortexRunnerServiceLive = (options: CortexRunnerOptions = {}) => {
  const stopGraceMs = options.stopGraceMs ?? 5_000;
  const settleTimeoutMs = options.settleTimeoutMs ?? 5_000;
  return Layer.effect(
  CortexRunnerService,
  Effect.gen(function* () {
    // Services captured here during Layer composition — NOT inside method bodies.
    // Effect-TS Layer context is only available during build time; method closures
    // must reference captured values, not yield from the service context.
    const store = yield* CortexStoreService;
    const ingest = yield* CortexIngestService;
    const activeRef = yield* Ref.make(new Map<string, ActiveEntry>());

    // Shared teardown reused by normal completion (.finally) + terminate().
    // Atomically claims the run from activeRef so exactly ONE caller runs the
    // dispose — terminate() and the run's own `.finally` both fire on abort, and
    // this prevents a double dispose / double unsubscribe.
    const finalizeRun = (
      runId: string,
      unsubscribe?: () => void,
      agent?: ReactiveAgent,
    ) =>
      Effect.gen(function* () {
        const claimed = yield* Ref.modify(activeRef, (m) => {
          if (!m.has(runId)) return [false, m] as const;
          const copy = new Map(m);
          copy.delete(runId);
          return [true, copy] as const;
        });
        if (!claimed) return;
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // fire-and-forget: unsubscribe errors must not block teardown
          }
        }
        if (agent) {
          // Release MCP transports + their docker containers so a later run with
          // the same name does not hit "container name already in use".
          yield* Effect.tryPromise({ try: () => agent.dispose(), catch: (e) => e }).pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:finalizeRun", tag: errorTag(err) }),
            ),
          );
        }
      });

    // Terminate (and a Stop past its grace window): interrupt the agent fiber,
    // which aborts an in-flight model call, then let `run()` settle before
    // disposing. Disposing first made the run's own exit fail with
    // "ManagedRuntime disposed" (its AgentTerminated never published) and the
    // run read `failed`. A run that will not settle is ended as stopped by
    // Cortex and disposed anyway.
    const endRun = (entry: ActiveEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.promise(() => entry.agent.terminate("Cortex UI terminate")).pipe(
          Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:terminate", tag: errorTag(err) })),
        );
        const settledInTime = yield* settledWithin(entry.settled, settleTimeoutMs);
        if (!settledInTime) {
          cortexLog("warn", "runner", "terminate: run did not settle; disposing it", { runId: entry.runId, settleTimeoutMs });
          if (entry.endAsStopped) yield* entry.endAsStopped();
        }
        // finalizeRun's atomic claim makes this a no-op when the run's own
        // `.finally` already tore it down.
        yield* finalizeRun(entry.runId, entry.unsubscribe, entry.agent);
      });

    // Pipe the agent's bus into ingest under the Cortex run id (desk start and crashed-run resume).
    const forwardToIngest = (agent: ReactiveAgent, agentId: string, runId: string, control: StopControl) => {
      let forwardedEvents = 0;
      return Effect.tryPromise({
        try: () =>
          agent.subscribe((event) => {
            forwardedEvents += 1;
            if (STOP_EVENT_TAGS.has(event._tag)) control.sawStopEvent = true;
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
    };

    // A run that rejected: ingest a failed AgentCompleted so the UI leaves "loading".
    const ingestFailure = (agentId: string, runId: string, startedAt: number, err: unknown) =>
      ingestRunFailure(ingest, agentId, runId, startedAt, err);

    // Continue of an interrupted desk run (loop stop, user stop, crash): a new linked run, `desk-continue.ts`.
    const resumeCrashed = makeDeskContinue({
      store,
      ingest,
      activeRef,
      finalizeRun,
      // Same launch config and the same agent id: the framework then opens the
      // same durable store and the config hash matches the checkpoint's.
      buildAgent: ({ agentId, launch }) =>
        Effect.gen(function* () {
          const providerRaw = launch.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test";
          const mcpConfigs =
            launch.mcpServerIds && launch.mcpServerIds.length > 0
              ? yield* store.getMcpServerConfigsByIds(launch.mcpServerIds)
              : [];
          return yield* Effect.tryPromise({
            try: () => buildCortexAgent({ ...launchParamsToBuildParams(launch, providerRaw, mcpConfigs), agentId }),
            catch: (e) => new CortexError({ message: `Failed to build agent: ${String(e)}`, cause: e }),
          });
        }),
    });

    return {
      resumeCrashed,

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

          const buildParams = launchParamsToBuildParams(params, providerRaw, mcpConfigs);
          const agent = yield* Effect.tryPromise({
            try: () => buildCortexAgent(buildParams),
            catch: (e) => new CortexError({ message: `Failed to build agent: ${String(e)}`, cause: e }),
          });

          const agentId = agent.agentId;
          const runId = generateTaskId();
          const startedAt = Date.now();

          yield* store.ensureRunRow(agentId, runId, {
            ...(params.agentName?.trim() ? { displayName: params.agentName.trim() } : {}),
            // Snapshot the resolved launch config so the run can be repeated
            // (Rerun) or opened prefilled (Edit & Rerun). Secrets never reach
            // here — the `{{secret.*}}` namespace is left unresolved by design.
            launchParamsJson: JSON.stringify(params),
          });
          const control: StopControl = { sawStopEvent: false };
          const unsubscribe = yield* forwardToIngest(agent, agentId, runId, control);

          // The user's Stop / Terminate is the run's ending: when the run did not
          // publish its own stop event (a terminate that interrupts a model call,
          // or a stop that never reached a phase boundary), Cortex ingests one so
          // the run reads `stopped`, never `failed` (the failed AgentCompleted
          // that may follow keeps it stopped; `updateRunStats`).
          const endAsStopped = (): Effect.Effect<void> =>
            Effect.suspend(() => {
              if (!control.requested || control.sawStopEvent) return Effect.void;
              control.sawStopEvent = true;
              const event = {
                _tag: control.requested === "stop" ? ("AgentStopped" as const) : ("AgentTerminated" as const),
                agentId,
                taskId: runId,
                reason: control.requested === "stop" ? "Stopped from Cortex" : "Terminated from Cortex",
              };
              return ingest
                .handleEvent(agentId, runId, { v: 1, agentId, runId, event })
                .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:endAsStopped", tag: errorTag(err) })));
            });

          let markSettled: () => void = () => {};
          const settled = new Promise<void>((resolve) => {
            markSettled = resolve;
          });

          // Register as active now that the event subscription exists, so
          // terminate()/finalizeRun can tear the subscription down too.
          yield* Ref.update(activeRef, (m) =>
            new Map(m).set(runId, { agentId, runId, agent, startedAt, unsubscribe, settled, control, endAsStopped }),
          );

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

          // Durable HITL: a run paused for approval resolves "awaiting-approval"; the agent is kept for
          // approveRun/denyRun (no dispose). Teardown waits for RunCostFinalized (`run-cost-settled.ts`).
          let paused = false;
          let costSettled: Promise<void> = Promise.resolve();
          // A `detach` gate without durable runs waits live while this run runs:
          // list and answer its waits through the shared registry until it ends.
          const unwatchLive = waitsLive(buildParams) ? durableApprovals.watchLive({ agentId, agent }) : undefined;

          void agent
            .run(params.prompt, { taskId: runId })
            .then((result) => {
              costSettled = runCostSettled(result);
              const r = result as {
                status?: string;
                pendingApproval?: { runId: string };
                pendingInteraction?: { runId: string };
              };
              // Stopped from Cortex and did not finish anyway: the stop is the ending.
              if (result.success !== true) Effect.runFork(endAsStopped());
              if (r.status === "awaiting-approval" && r.pendingApproval) {
                paused = true;
                // Retain the agent in the SHARED registry keyed by the DURABLE
                // runId (what listPendingApprovals surfaces + approve/deny use;
                // it differs from the cortex taskId — runDurable mints its own).
                const durableRunId = r.pendingApproval.runId;
                cortexLog("info", "runner", "durable run paused — awaiting approval", { agentId, runId, durableRunId });
                durableApprovals.register({ agentId, durableRunId, agent, startedAt });
                void durableApprovals.supersedeForAgent(agentId, durableRunId).then((dropped) => {
                  if (dropped.length > 0) {
                    cortexLog("info", "runner", "superseded earlier paused runs of the same agent", { agentId, dropped });
                  }
                });
              } else if (r.status === "awaiting-interaction" && r.pendingInteraction) {
                paused = true;
                // Same SHARED registry, keyed by the DURABLE runId — the
                // interaction rail (listPendingInteractions/respondToInteraction)
                // reuses the exact agent-handle mechanism the approval rail uses.
                const durableRunId = r.pendingInteraction.runId;
                cortexLog("info", "runner", "durable run paused — awaiting interaction", { agentId, runId, durableRunId });
                durableApprovals.register({ agentId, durableRunId, agent, startedAt });
              }
              // No DebriefCompleted from `result.debrief` here: the framework
              // publishes it on the agent's bus (runtime `debrief-synthesis.ts`)
              // and `forwardToIngest` already stores it; a second copy doubled
              // every desk run's debrief (pinned in runner-service.test.ts).
              // Typed structured output (v0.12): surface result.object / objectError
              // so the desk can render the extracted typed value. Emitted as a
              // synthetic event (the framework has no StructuredOutput event yet);
              // the live message carries the _tag string + payload verbatim.
              const ro = result as { object?: unknown; objectError?: string; objectReport?: unknown };
              if (ro.object !== undefined || ro.objectError !== undefined) {
                Effect.runFork(
                  ingest
                    .handleEvent(agentId, runId, {
                      v: 1,
                      agentId,
                      runId,
                      event: structuredOutputExtractedEvent(runId, agentId, ro),
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
              // Emit AgentCompleted with error so the UI transitions out of "loading".
              // A run the user stopped records the stop first, so it reads `stopped`.
              Effect.runFork(endAsStopped().pipe(Effect.zipRight(ingestFailure(agentId, runId, startedAt, err))));
            })
            .finally(() => {
              unwatchLive?.();
              markSettled();
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
              // Shared teardown: unsubscribe + dispose + drop from active. Idempotent
              // with a concurrent terminate() on the same run (atomic claim).
              void costSettled.then(() => Effect.runPromise(finalizeRun(runId, unsubscribe, agent)));
            });

          return { agentId, runId };
        }),

      pause: (runId) =>
        Effect.gen(function* () {
          const entry = (yield* Ref.get(activeRef)).get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "pause: run not active (already finished?)", { runId });
            return "not-live" as const;
          }
          // A durable run ends at its next iteration boundary with a saved place to continue from (`pauseRun`).
          if (entry.agent.activeRunIds().length > 0) {
            if (entry.control) entry.control.requested ??= "stop";
            const out = yield* Effect.promise(() => interruptLiveRun(entry.agent, "pause", stopGraceMs));
            if (out !== "not-live") return out;
          }
          yield* Effect.promise(() => entry.agent.pause()).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:306", tag: errorTag(err) })));
          return "not-live" as const;
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
          const entry = (yield* Ref.get(activeRef)).get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "stop: run not active", { runId });
            return "not-live" as const;
          }
          if (entry.control) entry.control.requested ??= "stop";
          // A durable run ends at its next iteration boundary with a saved place to continue from (`stopRun`);
          // one past the grace window is ended like Terminate (the framework still keeps it continuable).
          if (entry.agent.activeRunIds().length > 0) {
            const out = yield* Effect.promise(() => interruptLiveRun(entry.agent, "stop", stopGraceMs));
            if (out === "pending") yield* endRun(entry);
            if (out !== "not-live") return out;
          }
          yield* Effect.promise(() => entry.agent.stop("Cortex UI stop")).pipe(
            Effect.catchAll((err) => emitErrorSwallowed({ site: "cortex/server/services/runner-service.ts:329", tag: errorTag(err) })),
          );
          // Graceful first; a run still going after the grace window is ended
          // like Terminate (see CortexRunnerOptions.stopGraceMs). Forked so the
          // HTTP Stop returns at once.
          yield* Effect.forkDaemon(
            settledWithin(entry.settled, stopGraceMs).pipe(
              Effect.flatMap((done) => {
                if (done) return Effect.void;
                cortexLog("info", "runner", "stop: no phase boundary within the grace window; terminating", { runId, stopGraceMs });
                return endRun(entry);
              }),
            ),
          );
          return "not-live" as const;
        }),

      terminate: (runId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(activeRef);
          const entry = m.get(String(runId));
          if (!entry) {
            cortexLog("debug", "runner", "terminate: run not active", { runId });
            return;
          }
          if (entry.control) entry.control.requested ??= "terminate";
          yield* endRun(entry);
        }),

      getActive: () => Ref.get(activeRef),

      // Reads the SHARED registry, so approvals from the runner, the gateway
      // (saved-agent) and chat sessions are all surfaced + actionable.
      listPendingApprovals: () => Effect.promise(() => durableApprovals.listPending()),

      // `decide` resumes agent-owned runs (re-pause keeps them registered) and
      // delegates chat-owned ones so the reply lands in the chat thread.
      approveApproval: (runId, reason, gateId) => decideApproval(runId, "approved", reason, gateId),

      denyApproval: (runId, reason, gateId) => decideApproval(runId, "denied", reason, gateId),

      // Reads the SHARED registry, same mechanism as listPendingApprovals —
      // both approval + interaction pauses register their agent handle there.
      listPendingInteractions: () =>
        Effect.gen(function* () {
          const out: {
            runId: string;
            interactionId: string;
            kind: string;
            prompt: string;
            schema: unknown;
            questions?: readonly InteractionQuestion[];
            task: string;
            updatedAt: number;
            agentId?: string;
            chatSessionId?: string;
          }[] = [];
          for (const entry of durableApprovals.list()) {
            // Chat-owned entries pause on approval gates only (no interaction rail in chat yet).
            const agent = entry.agent;
            if (!agent) continue;
            const pendings = yield* Effect.promise(() => agent.listPendingInteractions()).pipe(
              Effect.catchAll(() => Effect.succeed([] as readonly unknown[])),
            );
            for (const p of pendings as readonly {
              runId?: string;
              interactionId?: string;
              kind?: string;
              prompt?: string;
              schema?: unknown;
              questions?: readonly InteractionQuestion[];
              task?: string;
              updatedAt?: number;
            }[]) {
              out.push({
                runId: p.runId ?? entry.durableRunId,
                interactionId: p.interactionId ?? "",
                kind: p.kind ?? "",
                prompt: p.prompt ?? "",
                schema: p.schema ?? null,
                ...(p.questions !== undefined ? { questions: p.questions } : {}),
                task: p.task ?? "",
                updatedAt: p.updatedAt ?? entry.startedAt,
              });
            }
          }
          // Questions agents are waiting on live (no durable runs): desk runs and chats.
          const live = yield* Effect.promise(() => durableApprovals.listLiveInteractions());
          for (const r of live) {
            if (out.some((o) => o.runId === r.runId && o.interactionId === r.interactionId)) continue;
            out.push({
              runId: r.runId,
              interactionId: r.interactionId,
              kind: r.kind,
              prompt: r.prompt,
              schema: r.schema,
              ...(r.questions !== undefined ? { questions: r.questions } : {}),
              task: "",
              updatedAt: Date.now(),
              ...(r.chatSessionId !== undefined ? { chatSessionId: r.chatSessionId } : {}),
              agentId: r.agentId,
            });
          }
          return out;
        }),

      respondToInteraction: (runId, interactionId, value) =>
        Effect.gen(function* () {
          const agent = durableApprovals.get(String(runId))?.agent;
          if (!agent) {
            // A live question (no durable runs): the waiting run takes the answer and goes on.
            const live = yield* Effect.promise(() => durableApprovals.answerLiveInteraction(String(runId), interactionId, value));
            if (live.ok) return { success: true, output: "" };
            cortexLog("debug", "runner", "respondToInteraction: run not pending interaction", { runId });
            return { success: false, output: "" };
          }
          const result = yield* Effect.tryPromise({
            try: () => agent.respondToInteraction(String(runId), interactionId, value),
            catch: (e) => new CortexError({ message: `respondToInteraction failed: ${String(e)}`, cause: e }),
          });
          // Re-pause if it hit another gate/interaction; otherwise the run is
          // done — clean up (mirrors approveApproval's re-pause handling).
          if (result.status === "awaiting-approval" || result.status === "awaiting-interaction") {
            cortexLog("info", "runner", "durable run re-paused after interaction response", { runId });
            return { success: result.success, output: result.output };
          }
          yield* Effect.promise(() => durableApprovals.finalize(String(runId)));
          return { success: result.success, output: result.output };
        }),
    };
  }),
  );
};

/** The desk runner with the default Stop / Terminate timing. */
export const CortexRunnerServiceLive = makeCortexRunnerServiceLive();
