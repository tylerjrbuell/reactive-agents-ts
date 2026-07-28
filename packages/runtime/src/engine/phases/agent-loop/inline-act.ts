/**
 * Inline-path ACT phase: parallel tool execution for the no-ReasoningService
 * agent loop. Iterates over `pendingCalls`, executes each via ToolService,
 * publishes ToolCallStarted/Completed events, logs invocations, and returns
 * the updated context with toolResults appended.
 *
 * Body of the `guardedPhase(ctx, "act", ...)` invocation inside the inline
 * agent loop. Extracted from `execution-engine.ts:1986-2143` (W23 step 6a-1a)
 * to shrink the engine module without changing behavior.
 *
 * Behavior preserved verbatim — error sites (`runtime/src/execution-engine.ts:NNNN`)
 * are intentionally retained for log/diagnostic compatibility with the inline-path
 * test files.
 */
import { Context, Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { ToolService } from "@reactive-agents/tools";
import { BehavioralContractService } from "@reactive-agents/guardrails";
import { makeStep, makeObservationResult, getRecoveryHint, growRunLedger, deriveArtifactEntries, evaluateToolPolicy, forbiddenToolsFromContract, META_TOOLS, type ReasoningStep, type RunLedger } from "@reactive-agents/reasoning";
import { subAgentResultForDisplay, subAgentChildLedgerEntries, resolveProduces } from "@reactive-agents/tools";
import { BehavioralContractViolationError } from "../../../errors.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike, EbLike } from "../../runtime-context.js";

type ProgressLoggerLike = {
  logToolExecution: (
    toolName: string,
    status: "success" | "error",
    durationMs: number,
    errorMessage?: string,
  ) => Effect.Effect<void, never>;
};

export interface InlineActDeps {
  readonly config: ReactiveAgentsConfig;
  readonly pendingCalls: readonly unknown[];
  readonly eb: EbLike | null;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
  readonly progressLogger: ProgressLoggerLike;
  /**
   * Tool names the model can actually call (the EXPOSED schema, not the
   * registry) — gates getRecoveryHint so it never names an absent tool.
   */
  readonly exposedToolNames?: ReadonlySet<string>;
}

/**
 * The child ledger(s) off a sub-agent tool result (Wave C.2), narrowed to a
 * RunLedger for the parent's merge. The executor already stamped every entry
 * `sub-agent:<name>`; `subAgentChildLedgerEntries` handles both the single
 * `spawn-agent` result and the batch `spawn-agents` wrapper (so parallel
 * children all cross). Undefined for a non-delegation tool.
 */
const childRunLedgerOf = (result: unknown): RunLedger | undefined => {
  const entries = subAgentChildLedgerEntries(result);
  return entries.length > 0 ? (entries as RunLedger) : undefined;
};

export const runInlineAct = (
  c: ExecutionContext,
  deps: InlineActDeps,
): Effect.Effect<ExecutionContext, BehavioralContractViolationError> => {
  const { config, pendingCalls, eb, obs, isNormal, progressLogger } = deps;
  return Effect.gen(function* () {
    const toolServiceOpt = yield* Effect.serviceOption(ToolService);

    const toolResults: unknown[] = yield* Effect.all(
      pendingCalls.map((call: any) =>
        Effect.gen(function* () {
          const callId = call.id ?? "unknown";
          const toolName =
            call.name ?? call.function?.name ?? "unknown";

          // ── Behavioral contract: check tool call ──
          if (config.enableBehavioralContracts) {
            const bcOpt = yield* Effect.serviceOption(BehavioralContractService)
              .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
            if (bcOpt._tag === "Some") {
              const violation = yield* bcOpt.value
                .checkToolCall(toolName, c.toolResults.length)
                .pipe(Effect.catchAll(() => Effect.succeed(null)));
              if (violation?.severity === "block") {
                return yield* Effect.fail(new BehavioralContractViolationError({
                  message: violation.message, taskId: c.taskId,
                  rule: violation.rule, violation: violation.message,
                }));
              }
            }
          }
          const rawArgs =
            call.input ??
            call.arguments ??
            call.function?.arguments ??
            {};
          const args: Record<string, unknown> =
            typeof rawArgs === "string"
              ? (() => {
                  try {
                    return JSON.parse(rawArgs);
                  } catch {
                    return { input: rawArgs };
                  }
                })()
              : (rawArgs as Record<string, unknown>);
          // Log tool invocation before execution (direct-LLM path)
          if (obs && isNormal) {
            const isAgentDelegateTool =
              toolName === "spawn-agent" ||
              toolName.startsWith("agent-");
            if (isAgentDelegateTool) {
              const taskArg = typeof args.task === "string"
                ? args.task.slice(0, 80)
                : typeof args.input === "string"
                  ? args.input.slice(0, 80)
                  : "";
              const nameSuffix = typeof args.name === "string" ? ` [${args.name}]` : "";
              yield* obs.info(
                `  ◉ [act]        ↓ ${toolName}${nameSuffix}: "${taskArg}"`,
              ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-act.ts:log-agent-delegate", tag: errorTag(err) })));
            } else {
              const argPreview = Object.entries(args)
                .slice(0, 2)
                .map(([k, v]) => `${k}: ${String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 40)}`)
                .join(", ");
              yield* obs.info(
                `  ◉ [act]        → ${toolName}(${argPreview})`,
              ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-act.ts:log-tool-invocation", tag: errorTag(err) })));
            }
          }

          const startMs = Date.now();

          // ── F9 (2026-07-28): THE DEFAULT PATH HAD NO TOOL GATE. ───────────
          // This loop called `toolService.execute()` directly, bypassing
          // `executeToolAndObserve` — the canonical primitive where B1 (P0-4)
          // put `evaluateToolPolicy`. So the inline path, which is the DEFAULT
          // path (`_enableReasoning` is false), inherited NO policy and NO
          // surface check and would run any tool the model named.
          //
          // Measured: configured `builtins: ["file-write"]`, scripted a
          // `file-read` call against a sandbox file containing a marker.
          //   inline  → EXECUTED, marker LEAKED into the result
          //   kernel  → blocked correctly
          // `withTools({builtins})` prunes the VISIBLE SCHEMA; it does not
          // restrict the ToolService registry, so an unexposed builtin is
          // still resolvable by name. On the kernel path the surface gate is
          // what stops it. Inline had nothing.
          //
          // `exposedToolNames` was already threaded to this function and used
          // only to phrase a recovery hint — declared, threaded, never
          // enforced. It is the correct gate and is now the gate.
          //
          // Fail-OPEN when the set is absent (some callers do not populate it):
          // this must not silently break paths that never had a surface, and
          // the policy check below still applies. META_TOOLS bypass mirrors
          // `evaluateToolPolicy`'s own first rule so the two cannot drift.
          const exposed = deps.exposedToolNames;
          const offSurface =
            exposed !== undefined && exposed.size > 0 && !exposed.has(toolName) && !META_TOOLS.has(toolName);
          const policyDecision = evaluateToolPolicy(toolName, {
            ...(config.allowedTools ? { allowedTools: config.allowedTools } : {}),
            forbiddenTools: forbiddenToolsFromContract(config.taskContract),
          });
          if (offSurface || policyDecision.blocked) {
            const message = offSurface
              ? `[Tool "${toolName}" was not exposed to this agent — blocked.]`
              : (policyDecision as { message: string }).message;
            const durationMs = Date.now() - startMs;
            if (eb) {
              yield* eb.publish({
                _tag: "ToolCallCompleted",
                taskId: c.taskId,
                toolName,
                callId,
                durationMs,
                success: false,
                args,
                error: message,
              }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-act.ts:emit-tool-call-blocked", tag: errorTag(err) })));
            }
            return {
              toolCallId: callId,
              toolName,
              result: message,
              durationMs,
              success: false,
              args,
            };
          }

          // Phase 0.2: Publish ToolCallStarted
          if (eb) {
            const rationale = (call as { rationale?: import("@reactive-agents/core").Rationale }).rationale;
            yield* eb.publish({
              _tag: "ToolCallStarted",
              taskId: c.taskId,
              toolName,
              callId,
              ...(rationale ? { rationale } : {}),
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-act.ts:emit-tool-call-started", tag: errorTag(err) })));
          }

          if (toolServiceOpt._tag === "None") {
            const durationMs = Date.now() - startMs;
            if (eb) {
              yield* eb.publish({
                _tag: "ToolCallCompleted",
                taskId: c.taskId,
                toolName,
                callId,
                durationMs,
                success: false,
                args,
                error: "ToolService not available during recording (no .withTools() configured)",
              }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-act.ts:emit-tool-call-completed-no-service", tag: errorTag(err) })));
            }
            return {
              toolCallId: callId,
              toolName,
              result: `[ToolService not available — add .withTools() to agent builder]`,
              durationMs,
              success: false,
              args,
            };
          }

          const toolResult = yield* toolServiceOpt.value
            .execute({
              toolName,
              arguments: args,
              agentId: c.agentId,
              sessionId: c.sessionId,
            })
            .pipe(
              Effect.map((r) => ({
                toolCallId: callId,
                toolName,
                result: r.result,
                durationMs: Date.now() - startMs,
                success: true,
                args,
              })),
              Effect.catchAll((e) => {
                // Recovery hint on the error observation — the tool_result
                // channel is one of only three channels that reach the model;
                // a bare errno wastes it (2026-07-11 probe p4: hint-less
                // ENOENT → fabricated exchange rate). Exposure-gated so an
                // absent tool is never named.
                const msg = e instanceof Error ? e.message : String(e);
                const hint = getRecoveryHint(toolName, msg, deps.exposedToolNames);
                return Effect.succeed({
                  toolCallId: callId,
                  toolName,
                  result: `[Tool error: ${msg}${hint}]`,
                  durationMs: Date.now() - startMs,
                  success: false,
                  args,
                });
              }),
            );

          // Log tool execution for progress visibility
          yield* progressLogger.logToolExecution(
            toolName,
            toolResult.success ? "success" : "error",
            toolResult.durationMs,
            toolResult.success ? undefined : (toolResult.result as string),
          ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-act.ts:log-tool-execution", tag: errorTag(err) })));

          // Phase 0.2: Publish ToolCallCompleted (with args + result for replay)
          if (eb) {
            yield* eb.publish({
              _tag: "ToolCallCompleted",
              taskId: c.taskId,
              toolName,
              callId,
              durationMs: toolResult.durationMs,
              success: toolResult.success,
              args,
              ...(toolResult.success ? { result: toolResult.result } : { error: String(toolResult.result) }),
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-act.ts:emit-tool-call-completed", tag: errorTag(err) })));
          }

          return toolResult;
        }),
      ),
      { concurrency: 3 },
    );

    // Canonical ledger pairs — the SAME action/observation shape the kernel
    // act phase writes (metadata.toolCall {id,name,arguments} ←→ toolCallId +
    // observationResult). Without these the inline loop executed tools while
    // `metadata.reasoningSteps` stayed empty, so isArtifactProduced's linkage
    // scan starved and every default-path receipt reported a written
    // deliverable as `produced:false` (2026-07-11 probe fleet, p1/p2/p4/p5/p10).
    const ledgerSteps: ReasoningStep[] = toolResults.flatMap((tr) => {
      const r = tr as {
        toolCallId?: unknown;
        toolName?: unknown;
        result?: unknown;
        success?: unknown;
        args?: Record<string, unknown>;
      };
      if (typeof r.toolName !== "string" || typeof r.toolCallId !== "string") return [];
      // Serialize the display-trimmed result — the child's ledger crosses on
      // `r.result` for the merge below, but must never bloat the model-visible
      // observation content.
      const resultText =
        typeof r.result === "string"
          ? r.result
          : JSON.stringify(subAgentResultForDisplay(r.result)) ?? "";
      // Wave C.2 — a spawn-agent result carries the child's stamped ledger.
      // Riding it on the observation step's metadata lets the SAME projection
      // (`projectStepsToLedger` below) that mints this call's tool pair also
      // merge the child's tool calls / artifacts under `sub-agent:<name>` — so a
      // delegated run on the inline path stops leaving no trace in its parent.
      const subAgentLedger = childRunLedgerOf(r.result);
      return [
        makeStep("action", `[ACT] ${r.toolName}`, {
          toolCall: { id: r.toolCallId, name: r.toolName, arguments: r.args ?? {} },
        }),
        makeStep("observation", resultText.slice(0, 2000), {
          toolCallId: r.toolCallId,
          observationResult: makeObservationResult(
            r.toolName,
            r.success === true,
            resultText.slice(0, 2000),
          ),
          ...(subAgentLedger ? { subAgentLedger } : {}),
        } as ReasoningStep["metadata"]),
      ];
    });

    // Wave C.2 — grow the run-scoped ledger from these steps. The inline agent
    // loop previously built canonical action/observation STEPS but no LEDGER, so
    // `TaskResult.metadata.runLedger` was empty for every default-path run and
    // the receipt fell back to step-scanning. Projecting here (the same pure
    // mapping the kernel's transitionState uses) makes the inline path a
    // first-class ledger writer, and carries the sub-agent merge attached above.
    // Wave C.2 slice 3b — grow the ledger through the ANNOUNCED seam, so this
    // path's facts reach the stream as well as the result object. Before the
    // seam the inline loop (the default path, and the one delegation runs on)
    // grew a ledger that nothing published: trace-side consumers (analyze,
    // debrief, cohort) read serialized JSONL and cannot reach the object view,
    // so they were structurally blind to every default-path run.
    //
    // No double-publish: the engine picks kernel XOR inline per run
    // (`execution-engine.ts` — `if (reasoningOpt._tag === "Some" && !cacheHit)`
    // … `else if (!cacheHit)`), so exactly one ledger factory is live.
    //
    // `artifact` entries are NOT step-derived — they are minted from a tool's
    // DECLARED `produces:"file"` contract, which the generic step→entry mapping
    // cannot know. That derivation lived ONLY in the kernel's act.ts, so the
    // inline path — the DEFAULT path, and the one delegation runs on — grew a
    // ledger with tool-invocation/tool-result facts but no artifact facts at
    // all. The ledger was incomplete on the path most runs take, which matters
    // because the post-condition spine's success authority now reads artifact
    // entries: a ledger-preferred reader is only sound if the ledger is
    // path-complete. Derived here and handed to the SAME announced seam, so the
    // published delta stays the whole growth.
    const priorLedger = c.metadata.runLedger as RunLedger | undefined;
    const artifactEntries = deriveArtifactEntries(ledgerSteps, resolveProduces, c.iteration);
    const runLedger = yield* growRunLedger(
      priorLedger,
      ledgerSteps,
      c.iteration,
      {
        taskId: c.taskId,
        agentId: c.agentId,
        ...(eb
          ? {
              publish: (event) =>
                eb.publish(event).pipe(
                  Effect.catchAll((err) =>
                    emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-act.ts:emit-ledger-entry-appended", tag: errorTag(err) }),
                  ),
                ),
            }
          : {}),
      },
      artifactEntries,
    );

    return {
      ...c,
      toolResults: [...c.toolResults, ...toolResults],
      metadata: {
        ...c.metadata,
        reasoningSteps: [
          ...((c.metadata.reasoningSteps as ReasoningStep[] | undefined) ?? []),
          ...ledgerSteps,
        ],
        ...(runLedger.length > 0 ? { runLedger } : {}),
      },
    };
  }) as unknown as Effect.Effect<ExecutionContext, BehavioralContractViolationError>;
};
