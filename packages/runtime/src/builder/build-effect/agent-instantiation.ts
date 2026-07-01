/**
 * ReactiveAgent instantiation block for buildEffect (W26-B step 4).
 *
 * Wraps the fully-composed runtime layer in a ManagedRuntime so all facade
 * calls share the same scope + service instances, then constructs the public
 * ReactiveAgent with the 19-arg constructor.
 *
 * Extracted from builder.ts:2258-2317.
 */
import { Layer, ManagedRuntime, type Effect, type Stream as EStream } from "effect";
import { ReactiveAgent } from "../../reactive-agent.js";
import type { ExecutionContext } from "../../types.js";
import type { StreamDensity, AgentStreamEvent } from "../../stream-types.js";
import type { ChannelsConfig } from "@reactive-agents/channels";
import type { RuntimeErrors } from "../../errors.js";
import type {
  Task,
  TaskResult,
  TaskError,
  RunControllerLike,
} from "@reactive-agents/core";
import type { GatewayOptions, ModelRoutingOptions, OutputSchemaOptions } from "../types.js";
import type { ParentExecutionContextSnapshot } from "./parent-context.js";
import type { SchemaContract } from "@reactive-agents/reasoning";

type EngineLike = {
  execute: (task: Task) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;
  executeStream: (
    task: Task,
    options?: { density?: StreamDensity; runController?: RunControllerLike },
  ) => Effect.Effect<EStream.Stream<AgentStreamEvent, Error>>;
  cancel: (taskId: string) => Effect.Effect<void, RuntimeErrors>;
  getContext: (taskId: string) => Effect.Effect<ExecutionContext | null, never>;
};

export interface AgentInstantiationDeps {
  readonly engine: EngineLike;
  readonly fullRuntime: Layer.Layer<unknown, unknown, unknown>;
  readonly agentId: string;
  readonly mcpServerNames: readonly string[];
  readonly gatewayOptions?: GatewayOptions;
  readonly streamDensity?: StreamDensity;
  readonly hasParentCallbacks: boolean;
  readonly parentCtxRef: { current: ParentExecutionContextSnapshot | null };
  readonly errorHandler?: (
    error: RuntimeErrors | Error,
    context: {
      taskId: string;
      phase: string;
      iteration: number;
      lastStep?: string;
    },
  ) => void;
  readonly sessionPersist: boolean;
  readonly sessionMaxAgeDays?: number;
  readonly ragStore?: import("@reactive-agents/tools").RagMemoryStore;
  readonly channelsConfig?: ChannelsConfig;
  readonly capabilities: {
    minIterations?: number;
    taskContext?: Record<string, string>;
    progressCheckpoint?: { every: number; autoResume?: boolean };
    verificationStep?: { mode: "reflect"; prompt?: string };
    outputValidator?: (output: string) => { valid: boolean; feedback?: string };
    outputValidatorOptions?: { maxRetries?: number };
    customTermination?: (state: { output: string }) => boolean;
    modelRouting?: ModelRoutingOptions;
  };
  /**
   * Durable resume context (Phase C). Present only when `.withDurableRuns()`
   * was called: the resolved checkpoint `dir` and the agent-identity
   * `configHash` (via `durableConfigHash`), so `agent.resume(runId)` can open
   * the RunStore and guard against a config drift.
   */
  readonly durableResume?: { readonly dir: string; readonly configHash: string };
  /** Opt-in typed structured output config from `.withOutputSchema()`. Absent = off. */
  readonly outputSchemaConfig?: { readonly contract: SchemaContract<unknown>; readonly options: OutputSchemaOptions };
  /**
   * Whether the agent has at least one tool registered (`.withTools()` or `.withDocuments()` called).
   * Forwarded to `ReactiveAgent` so the structured-output router can prefer the grounded path
   * when tools are present (tool results need structured assembly, not prose extraction).
   */
  readonly enableTools: boolean;
  /**
   * Plain-object runtime config snapshot (thinking, thinkingOptions, provider, etc.)
   * Exposed on `ReactiveAgent.config` for tests + diagnostics.
   */
  readonly runtimeConfig?: Record<string, unknown>;
}

/**
 * Construct the ManagedRuntime + ReactiveAgent.
 *
 * The `Layer<any, never, never>` cast collapses three boundary facts the
 * `unknown` triple hides:
 *   • RIn = never — every dynamically-merged sub-layer in createRuntime has
 *     had its requirements satisfied internally (see runtime.ts), so the
 *     composed layer has no unprovided deps.
 *   • E   = never — layer construction is total at this point; init failures
 *     throw, not flow through E.
 *   • ROut = any — the materialised service union is opaque (15+ conditional
 *     optional services). ReactiveAgent stores it as `ManagedRuntime<any, never>`
 *     and resolves services on-demand at the `runPromise` boundary.
 * This single cast replaces the 6× `Layer<any, any>` casts that previously
 * papered over the same boundary mismatch.
 */
export const instantiateAgent = (deps: AgentInstantiationDeps): ReactiveAgent => {
  const managedRuntime = ManagedRuntime.make(
    deps.fullRuntime as unknown as Layer.Layer<any, never, never>,
  );

  const taskDescriptionSetter = deps.hasParentCallbacks
    ? (desc: string) => {
        if (deps.parentCtxRef.current) {
          deps.parentCtxRef.current.taskDescription = desc;
        } else {
          deps.parentCtxRef.current = { toolResults: [], taskDescription: desc };
        }
      }
    : undefined;

  return new ReactiveAgent(
    deps.engine,
    deps.agentId,
    managedRuntime,
    deps.mcpServerNames,
    !!deps.gatewayOptions,
    deps.gatewayOptions?.heartbeat?.intervalMs,
    !!deps.gatewayOptions?.heartbeat?.instruction,
    deps.gatewayOptions?.persistMemoryAcrossRuns === true,
    deps.streamDensity,
    taskDescriptionSetter,
    deps.errorHandler,
    deps.sessionPersist,
    deps.sessionMaxAgeDays,
    deps.ragStore,
    deps.channelsConfig,
    deps.capabilities,
    deps.durableResume,
    deps.outputSchemaConfig,
    deps.enableTools,
    deps.runtimeConfig ?? {},
  );
};
