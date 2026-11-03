/**
 * Shared `ChatEngine` host capabilities for `ReactiveAgent`.
 *
 * The agent builds three ChatEngines (agent-scoped default, legacy
 * history/sessionId compat, and `session()`); the `complete` and `publishTurn`
 * capabilities were copy-pasted across all three. They live here once so the
 * three sites cannot drift.
 */
import { Effect, Option, type ManagedRuntime } from 'effect'
import { ToolService } from '@reactive-agents/tools'
import type { EnvironmentSnapshotInput } from '../chat/environment-snapshot.js'
import { EventBus, emitErrorSwallowed, errorTag, type RunOrigin, type RunPosture } from '@reactive-agents/core'
import { originCarry, planPosture } from '../chat/todo-seed.js'
import { LLMService } from '@reactive-agents/llm-provider'
import { gatewayComplete } from '@reactive-agents/reasoning'
import type { ChatEngineCapabilities, ChatEngineOptions } from '../chat/engine.js'
import type { ChatMessage, SessionOptions } from '../chat.js'
import type { AgentResult } from '../builder/types.js'

/** The services the chat capabilities run against (contravariant: any richer runtime fits). */
type ChatRuntime = ManagedRuntime.ManagedRuntime<LLMService | EventBus, never>

/** Plain conversational completion (no tools) through the LLM gateway. */
export const makeChatComplete =
    (runtime: ChatRuntime): ChatEngineCapabilities['complete'] =>
    async (params) => {
        const response = await runtime.runPromise(
            Effect.gen(function* () {
                const llm = yield* LLMService
                return yield* gatewayComplete(
                    llm,
                    { purpose: 'synthesize', budgetTokens: params.budgetTokens ?? 4096 },
                    {
                        messages: params.messages,
                        systemPrompt: params.systemPrompt,
                        temperature: 0.7,
                    },
                ).pipe(Effect.mapError((e) => Error(String(e))))
            }),
        )
        return {
            message: response.content,
            tokens: response.usage?.totalTokens,
            cost: response.usage?.estimatedCost,
        }
    }

/**
 * Publish a `ChatTurn` event on the agent's EventBus. With `swallowSite`, a
 * publish failure is recorded as a swallowed error (the turn already
 * succeeded); without it the failure propagates (legacy compat behavior).
 */
export const makeChatPublishTurn =
    (runtime: ChatRuntime, swallowSite?: string): NonNullable<ChatEngineCapabilities['publishTurn']> =>
    async (turn) => {
        const publish = EventBus.pipe(Effect.flatMap((bus) => bus.publish(turn)))
        await runtime.runPromise(
            swallowSite === undefined
                ? publish
                : publish.pipe(
                      Effect.catchAll((err) =>
                          emitErrorSwallowed({ site: swallowSite, tag: errorTag(err) }),
                      ),
                  ),
        )
    }

/** Publish an `EnvironmentChanged` event on the agent's EventBus (failure swallowed: the turn must not fail). */
export const makeChatPublishEnvironment =
    (runtime: ChatRuntime, swallowSite: string): NonNullable<ChatEngineCapabilities['publishEnvironment']> =>
    async (event) => {
        await runtime.runPromise(
            EventBus.pipe(
                Effect.flatMap((bus) => bus.publish(event)),
                Effect.catchAll((err) => emitErrorSwallowed({ site: swallowSite, tag: errorTag(err) })),
            ),
        )
    }

/**
 * Names of the tools actually registered on the agent's `ToolService`, read
 * synchronously (the registry is Ref-backed). `[]` when the agent has no tools
 * layer or the read cannot complete synchronously — never throws.
 */
export const registeredToolNames = (runtime: ChatRuntime): string[] => {
    try {
        return runtime.runSync(
            Effect.serviceOption(ToolService).pipe(
                Effect.flatMap((o) =>
                    Option.isSome(o)
                        ? o.value.listTools().pipe(Effect.map((ts) => ts.map((t) => t.name)))
                        : Effect.succeed<string[]>([]),
                ),
            ),
        )
    } catch {
        return []
    }
}

/** Fill `toolNames` from the runtime's real tool registry when the host omitted it. */
const withRuntimeTools = (runtime: ChatRuntime, input: EnvironmentSnapshotInput): EnvironmentSnapshotInput =>
    input.toolNames !== undefined ? input : { ...input, toolNames: registeredToolNames(runtime) }

/**
 * Environment ports for `session()`. A host supplying `environment` without its
 * own `publishEnvironment` gets the EventBus publisher, so trace bridges see it.
 * A host that omits `toolNames` gets the agent's real registered tool set.
 */
export const sessionEnvironmentPorts = (
    runtime: ChatRuntime,
    options: SessionOptions | undefined,
): Pick<ChatEngineCapabilities, 'environment' | 'publishEnvironment'> => ({
    ...(options?.environment ? { environment: () => withRuntimeTools(runtime, options.environment!()) } : {}),
    ...(options?.environment
        ? { publishEnvironment: options.publishEnvironment ?? makeChatPublishEnvironment(runtime, 'runtime/src/reactive-agent.ts:session-environment') }
        : {}),
})

/**
 * Engine options for the environment: the `environmentUpdates` opt-out and the
 * `initialEnvironment` seed (absent unless the host set them). A seed without
 * `toolNames` is filled with the current registry so it cannot fabricate a
 * "tools added" diff.
 */
export const sessionEnvironmentOption = (
    runtime: ChatRuntime,
    options: SessionOptions | undefined,
): Pick<ChatEngineOptions, 'environmentUpdates' | 'initialEnvironment'> => ({
    ...(options?.environmentUpdates !== undefined ? { environmentUpdates: options.environmentUpdates } : {}),
    ...(options?.initialEnvironment ? { initialEnvironment: withRuntimeTools(runtime, options.initialEnvironment) } : {}),
})

/** `runTask` adapter for `session()`: forwards history, iteration cap and the environment notice to `run()`. */
export const makeSessionRunTask =
    (
        run: (
            input: string,
            o: { history?: ChatMessage[]; maxIterations?: number; environmentUpdate?: string; posture?: RunPosture; origin?: RunOrigin },
        ) => Promise<AgentResult>,
    ): NonNullable<ChatEngineCapabilities['runTask']> =>
    (input, opts) =>
        run(input, {
            ...(opts?.history ? { history: [...opts.history] } : {}),
            ...(opts?.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
            ...(opts?.environmentUpdate ? { environmentUpdate: opts.environmentUpdate } : {}),
            ...planPosture(opts?.posture),
            ...originCarry(opts?.origin),
        })
