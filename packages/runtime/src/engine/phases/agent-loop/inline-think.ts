/**
 * Inline-path THINK phase: single LLM call (or stream) with tool-call extraction,
 * episodic-memory logging, and event/metric publishing.
 *
 * This is the body of the `guardedPhase(ctx, "think", ...)` invocation inside
 * the inline-react loop (no-ReasoningService fallback). Extracted from
 * `execution-engine.ts:1957-2227` (W23 step 6a-0) to shrink the engine module
 * without changing behavior.
 *
 * Behavior preserved verbatim — error sites (`runtime/src/execution-engine.ts:NNNN`)
 * are intentionally retained for log/diagnostic compatibility with the 17 test
 * files that exercise the inline path.
 *
 * Returns `Effect.Effect<ExecutionContext, never, never>` (cast at boundary —
 * LLMService is provided by the runtime layer stack at the call site).
 */
import { Context, Effect, FiberRef, Stream as EStream } from "effect";
import { StreamingTextCallback, emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { formatTaskContextForChat } from "../../../chat.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import { MemoryServiceLogEpisodeTag } from "../../service-tags.js";
import type { ObsLike, EbLike } from "../../runtime-context.js";
import {
  asThinkContext,
  getResponseModel,
  getSelectedModelName,
} from "./think-context.js";

/**
 * Narrow interface shim for the ContextWindowManager service. The error
 * channel is intentionally `unknown` — see the doc-block at
 * `packages/core/src/errors/index.ts` ("Narrow `unknown` error channels —
 * when intentional"). The framework absorbs/translates errors at the
 * boundary; cross-package error-type coupling is deliberately avoided.
 *
 * Exported (not re-declared) so `execution-engine.ts` does not duplicate
 * the same Effect<X, unknown> declarations (WS-5 Phase 2 dedupe).
 */
export type ContextManagerLike = {
  buildContext: (options: {
    systemPrompt: string;
    messages: readonly unknown[];
    memoryContext?: string;
    maxTokens: number;
    reserveOutputTokens: number;
  }) => Effect.Effect<readonly unknown[], unknown>;
  truncate: (
    messages: readonly unknown[],
    targetTokens: number,
    strategy: string,
  ) => Effect.Effect<readonly unknown[], unknown>;
};

export interface InlineThinkDeps {
  readonly config: ReactiveAgentsConfig;
  readonly functionCallingTools: readonly any[];
  readonly availableToolNames: readonly string[];
  readonly contextManagerOpt:
    | { readonly _tag: "Some"; readonly value: ContextManagerLike }
    | { readonly _tag: "None" };
  readonly eb: EbLike | null;
  readonly obs: ObsLike | null;
  readonly isVerbose: boolean;
  /** Effective context window for this run: recommendedNumCtx for local models, maxContextTokens for cloud. */
  readonly effectiveContextTokens: number;
}

export const runInlineThink = (
  c: ExecutionContext,
  deps: InlineThinkDeps,
): Effect.Effect<ExecutionContext, never> => {
  const { config, functionCallingTools, availableToolNames, contextManagerOpt, eb, obs, isVerbose, effectiveContextTokens } = deps;
  return Effect.gen(function* () {
    const llm = yield* Context.GenericTag<{
      complete: (req: unknown) => Effect.Effect<{
        content: string;
        toolCalls?: unknown[];
        stopReason: string;
        usage?: {
          totalTokens?: number;
          estimatedCost?: number;
        };
      }>;
      stream: (req: unknown) => Effect.Effect<import("effect").Stream.Stream<{ type: string; text?: string; content?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedCost?: number }; stopReason?: string; toolCalls?: unknown[] }>>;
    }>("LLMService");

    const defaultPrompt =
      config.systemPrompt ??
      "You are a helpful AI assistant.";

    // Apply prompt.system harness transform (Wave B chokepoint)
    const _hPipeline = config.harnessPipeline;
    const effectivePrompt = _hPipeline
      ? (yield* Effect.promise(() =>
          _hPipeline.transform('prompt.system', defaultPrompt, {
            iteration: c.iteration,
            phase: 'think',
            state: {
              taskId: c.taskId,
              strategy: String(c.selectedStrategy ?? "reactive"),
              kernelType: "inline",
              steps: [],
              toolsUsed: new Set<string>(),
              iteration: c.iteration,
              tokens: c.tokensUsed,
              status: "running",
              output: null,
              error: null,
              meta: {},
            },
            strategy: String(c.selectedStrategy ?? "reactive"),
          })
        )) ?? defaultPrompt
      : defaultPrompt;

    // Match agent.chat() direct-LLM path: static taskContext must reach the model
    // even when ReasoningService is off (Cortex run-tab chat, streaming runStream, etc.).
    const taskCtxBlock = formatTaskContextForChat(
      config.taskContext as Record<string, string> | undefined,
    ).trim();
    const semanticMem = String(
      asThinkContext(c).memoryContext?.semanticContext ?? "",
    ).trim();
    const directLlmMemoryContext =
      taskCtxBlock && semanticMem
        ? `${taskCtxBlock}\n\n${semanticMem}`
        : taskCtxBlock || semanticMem || undefined;

    // Phase 1.1: Use buildContext() properly when available
    let messagesToSend: readonly unknown[];
    if (contextManagerOpt._tag === "Some") {
      messagesToSend = yield* contextManagerOpt.value
        .buildContext({
          systemPrompt: effectivePrompt,
          messages: c.messages,
          memoryContext: directLlmMemoryContext,
          maxTokens: 100_000,
          reserveOutputTokens: 4096,
        })
        .pipe(
          Effect.catchAll(() =>
            Effect.succeed(c.messages as unknown[]),
          ),
        );
    } else {
      // Fallback: simple system prompt prepend
      const systemPrompt = directLlmMemoryContext
        ? `${directLlmMemoryContext}\n\n${effectivePrompt}`
        : effectivePrompt;
      messagesToSend = [
        { role: "system", content: systemPrompt },
        ...c.messages,
      ];
    }

    // Convert function-calling tools to LLM ToolDefinition format
    const llmTools =
      functionCallingTools.length > 0
        ? functionCallingTools.map((t: any) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.input_schema,
          }))
        : undefined;

    const llmRequest = {
      messages: messagesToSend,
      model: c.selectedModel,
      ...(llmTools ? { tools: llmTools } : {}),
      taskId: c.taskId,
    } as Parameters<typeof llm.complete>[0] & { taskId: string };

    const reqId = `req-${Date.now()}`;
    if (eb) {
      yield* eb.publish({
        _tag: "LLMRequestStarted",
        taskId: c.taskId,
        requestId: reqId,
        model: String(c.selectedModel ?? "unknown"),
        provider: String(c.provider ?? "unknown"),
        contextSize: messagesToSend.length,
      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:emit-llm-request-started", tag: errorTag(err) })));
    }

    const llmCallStart = performance.now();
    const streamCb = yield* FiberRef.get(StreamingTextCallback);
    let response: { content: string; toolCalls?: unknown[]; stopReason: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedCost?: number } };
    if (streamCb) {
      // Streaming path: emit TextDelta events as tokens arrive
      const llmStream = yield* llm.stream(llmRequest);
      let content = "";
      let toolCalls: unknown[] | undefined;
      let stopReason = "end_turn";
      let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedCost?: number } | undefined;
      yield* EStream.runForEach(llmStream, (event: any) =>
        Effect.gen(function* () {
          if (event.type === "text_delta" && event.text) {
            content += event.text;
            yield* streamCb(event.text).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:stream-text-callback", tag: errorTag(err) })));
          } else if (event.type === "content_complete") {
            if (event.content) content = event.content;
            if (event.stopReason) stopReason = event.stopReason;
            if (event.toolCalls?.length) toolCalls = event.toolCalls;
          } else if (event.type === "usage") {
            usage = { inputTokens: event.usage?.inputTokens, outputTokens: event.usage?.outputTokens, totalTokens: event.usage?.totalTokens, estimatedCost: event.usage?.estimatedCost };
          }
        }),
      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:stream-runforeach", tag: errorTag(err) })));
      response = { content, stopReason, ...(toolCalls ? { toolCalls } : {}), ...(usage ? { usage } : {}) };
    } else {
      response = yield* llm.complete(llmRequest);
    }
    const llmDurationMs = performance.now() - llmCallStart;

    const fallbackTransitions = (response as { fallbackTransitions?: Array<{
      fromProvider: string;
      toProvider: string;
      reason: string;
      attemptNumber: number;
    }> }).fallbackTransitions;
    if (eb && fallbackTransitions && fallbackTransitions.length > 0) {
      for (const transition of fallbackTransitions) {
        yield* eb.publish({
          _tag: "ProviderFallbackActivated",
          taskId: c.taskId,
          fromProvider: transition.fromProvider,
          toProvider: transition.toProvider,
          reason: transition.reason,
          attemptNumber: transition.attemptNumber,
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:emit-provider-fallback", tag: errorTag(err) })));
      }
    }

    // Update selectedModel to the actual model used by the provider
    const actualModel = getResponseModel(response);
    if (actualModel) {
      c = { ...c, selectedModel: actualModel };
    }

    // Phase 0.2: Publish LLMRequestCompleted event
    if (eb) {
      yield* eb.publish({
        _tag: "LLMRequestCompleted",
        taskId: c.taskId,
        requestId: reqId,
        model: String(c.selectedModel ?? "unknown"),
        provider: String(c.provider ?? "unknown"),
        durationMs: llmDurationMs,
        tokensUsed: response.usage?.totalTokens ?? 0,
        estimatedCost: response.usage?.estimatedCost ?? 0,
      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:emit-llm-request-completed", tag: errorTag(err) })));

      if (effectiveContextTokens > 0) {
        // Use inputTokens (live context sent to model this call) when available;
        // fall back to accumulated tokensUsed for providers that only report totals (e.g. Ollama).
        const liveContextTokens =
          (response.usage?.inputTokens ?? 0) > 0
            ? response.usage!.inputTokens!
            : c.tokensUsed + (response.usage?.totalTokens ?? 0);
        const tokensAvailable = Math.max(0, effectiveContextTokens - liveContextTokens);
        const utilizationPct = Math.min(100, Math.max(0, (liveContextTokens / effectiveContextTokens) * 100));
        const level =
          utilizationPct >= 90 ? "critical" :
          utilizationPct >= 75 ? "high" :
          utilizationPct >= 45 ? "medium" : "low";
        yield* eb.publish({
          _tag: "ContextPressure",
          taskId: c.taskId,
          utilizationPct,
          tokensUsed: liveContextTokens,
          tokensAvailable,
          level,
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:emit-context-pressure", tag: errorTag(err) })));
      }
    }

    // Phase 0.5: Record LLM timing histogram
    if (obs) {
      yield* obs.recordHistogram(
        "llm.request.duration_ms",
        llmDurationMs,
        { model: String(c.selectedModel ?? "unknown") },
      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:record-llm-duration", tag: errorTag(err) })));
    }

    // Verbose: log LLM call details
    if (obs && isVerbose) {
      const modelName = String(getSelectedModelName(asThinkContext(c).selectedModel) ?? "unknown");
      const toks = response.usage?.totalTokens ?? 0;
      const stopReason = response.stopReason ?? "?";
      yield* obs.debug(
        `  ┄ [llm]    ${modelName} | ${toks.toLocaleString()} tok | ${stopReason} | ${(llmDurationMs / 1000).toFixed(1)}s`,
      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:log-verbose-llm", tag: errorTag(err) })));
      const ctxSize = messagesToSend.length;
      yield* obs.debug(
        `  ┄ [ctx]    ${ctxSize} msgs | ~${toks.toLocaleString()} tok used`,
      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:log-verbose-ctx", tag: errorTag(err) })));
    }

    // Phase 1.3: Log LLM interaction as episodic memory
    const memOpt = yield* Effect.serviceOption(
      MemoryServiceLogEpisodeTag,
    ).pipe(
      Effect.catchAll(() =>
        Effect.succeed({ _tag: "None" as const }),
      ),
    );
    if (memOpt._tag === "Some") {
      const now = new Date();
      yield* memOpt.value
        .logEpisode({
          id: crypto.randomUUID().replace(/-/g, ""),
          agentId: c.agentId,
          date: now.toISOString().slice(0, 10),
          content: `LLM response (${response.usage?.totalTokens ?? 0} tokens): ${response.content.slice(0, 200)}`,
          taskId: c.taskId,
          eventType: "decision-made",
          createdAt: now,
          metadata: {
            model: String(c.selectedModel ?? "unknown"),
            messageCount: messagesToSend.length,
            tokensUsed: response.usage?.totalTokens ?? 0,
            durationMs: llmDurationMs,
          },
        })
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-think.ts:log-llm-episode", tag: errorTag(err) })));
    }

    // When the response includes tool calls, store them as
    // tool_use content blocks so multi-turn providers (Ollama)
    // can properly associate the incoming tool results.
    const assistantContent =
      response.toolCalls && response.toolCalls.length > 0
        ? [
            ...(response.content
              ? [{ type: "text" as const, text: response.content }]
              : []),
            ...(response.toolCalls as Array<{ id: string; name: string; input: unknown }>).map(
              (tc) => ({
                type: "tool_use" as const,
                id: tc.id,
                name: tc.name,
                input: tc.input ?? {},
              }),
            ),
          ]
        : response.content;
    const updatedMessages = [
      ...c.messages,
      { role: "assistant", content: assistantContent },
    ];

    const done =
      response.stopReason === "end_turn" &&
      !response.toolCalls?.length;

    // Phase 1.4: Get current trace ID for hook context
    const traceId = obs
      ? yield* obs.getTraceContext().pipe(
          Effect.map((tc) => tc.traceId),
          Effect.catchAll(() => Effect.succeed(undefined as string | undefined)),
        )
      : undefined;

    return {
      ...c,
      messages: updatedMessages,
      tokensUsed:
        c.tokensUsed + (response.usage?.totalTokens ?? 0),
      cost: c.cost + (response.usage?.estimatedCost ?? 0),
      // Phase 1.4: Enrich context for hooks
      lastLLMRequest: llmRequest,
      lastLLMResponse: response,
      availableTools: [...availableToolNames],
      traceId,
      metadata: {
        ...c.metadata,
        lastResponse: response.content,
        pendingToolCalls: response.toolCalls ?? [],
        isComplete: done,
        llmCalls: ((c.metadata.llmCalls as number | undefined) ?? 0) + 1,
      },
    };
  }) as unknown as Effect.Effect<ExecutionContext, never>;
};
