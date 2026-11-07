// File: src/strategies/code-action.ts
//
// CodeAgent strategy — LLM generates executable TypeScript code that composes
// available tools as async function calls; executes in a Worker-thread sandbox.
// Loop: plan (code gen) → execute (sandbox) → observe → reflect (verifier gate)
//
// Runs on the strategy run substrate (`runStrategy`): steps, spend (every
// model call via `run.call`), the one run ledger and the result mint are the
// substrate's; this body is code-action's control flow.
import { Effect, Option } from "effect";
import type { ReasoningStep } from "../types/index.js";
import { ExecutionError } from "../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { EventBus } from "@reactive-agents/core";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { EventBusInstance, KernelMessage } from "../kernel/state/kernel-state.js";
import type { ReasoningConfig } from "../types/config.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import { makeStep } from "../kernel/capabilities/sense/step-utils.js";
import type { JudgedReasoningResult } from "../kernel/capabilities/sense/finalize-result.js";
import { RunEnvelope } from "../kernel/envelope/run-envelope.js";
import { makeObservationResult } from "../kernel/utils/observation-helpers.js";
import { emitToCompose } from "@reactive-agents/core";
import { noopVerifier } from "../kernel/capabilities/verify/noop-verifier.js";
import type { Verifier } from "../kernel/capabilities/verify/verifier.js";
import { generateToolBindings } from "./code-action/tool-binding.js";
import type { ToolParamPropertySchema, ToolSpec } from "./code-action/tool-binding.js";
import { buildPlanPrompt, extractCodeBlock } from "./code-action/code-action-plan.js";
import { runInSandbox } from "./code-action/sandbox.js";
import type { ToolCallRecord } from "./code-action/code-action-observe.js";
import { formatObservationMessage } from "./code-action/code-action-observe.js";
import { shouldTerminate } from "./code-action/code-action-reflect.js";
import type { VerifierVerdict } from "./code-action/code-action-reflect.js";
import { withEnvContext } from "../context/context-engine.js";
import { evaluateToolPolicy, forbiddenToolsFromContract } from "../kernel/capabilities/act/tool-observe.js";
import { subAgentResultForDisplay, subAgentChildLedgerEntries, subAgentChildEnvelopes } from "@reactive-agents/tools";
import type { RunLedger } from "../kernel/ledger/run-ledger.js";
import { emitPhaseEnd, publishReasoningStep, resolveStrategyServices } from "../kernel/utils/service-utils.js";
import { openStrategyContract } from "../kernel/contract/strategy-contract.js";
import { extractGoalText } from "./planning/plan-text.js";
import { runStrategy } from "./substrate/strategy-run.js";
import { emitBudgetRefusal } from "../kernel/capabilities/decide/tool-call-budget.js";

/**
 * The child ledger(s) off a sub-agent tool result (Wave C.2), narrowed to a
 * RunLedger for this strategy's merge. Mirrors `inline-act.ts`'s
 * `childRunLedgerOf` — code-action is the 4th delegation path (root cause
 * #7, 2026-07-29 systems audit) that Wave C.2 never wired: it dispatches
 * tools from a sandbox-Worker closure, not the kernel act primitive, so it
 * needs its own copy of the same narrowing rather than sharing the kernel's.
 */
const childRunLedgerOf = (result: unknown): RunLedger | undefined => {
  const entries = subAgentChildLedgerEntries(result);
  return entries.length > 0 ? (entries as RunLedger) : undefined;
};

// ── CodeActionInput ───────────────────────────────────────────────────────────

// No skillsContext — code-action makes direct model calls (`run.call`), not kernel passes.
export interface CodeActionInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly allToolSchemas?: readonly ToolSchema[];
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  readonly contextProfile?: Partial<ContextProfile>;
  readonly providerName?: string;
  readonly systemPrompt?: string;
  readonly taskId?: string;
  readonly resultCompression?: ResultCompressionConfig;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly requiredTools?: readonly string[];
  /** P0-4 — tool-policy enforced on every sandbox-bridged tool call via the
   *  shared `evaluateToolPolicy` gate (the same decision act.ts + the canonical
   *  primitive delegate to). `forbiddenTools` defaults to the declared
   *  `taskContract` deny-list. Closes the code-action bypass: the Worker
   *  handlers previously called `toolSvc.execute()` with no policy check. */
  readonly allowedTools?: readonly string[];
  readonly forbiddenTools?: readonly string[];
  // Cascade Task 5: `taskContract` (and the HITL rails) are NOT declared here
  // any more — they ride the RunEnvelope. See `envelope.policy.taskContract`.
  readonly metaTools?: KernelMetaToolsConfig;
  readonly initialMessages?: readonly KernelMessage[];
  /** Commanded LLM sampling temperature — wins over each pass default (GH #246).
   *  Threaded from the runtime command-first merge via ReasoningService params. */
  readonly temperature?: number;
  /** Override verifier — defaults to noopVerifier (code-action is its own judge) */
  readonly verifier?: Verifier;
  /**
   * Compose harness pipeline — drives `.on/.tap/.before/.after` + all tags.
   * FM-I (#195): code-action runs tools inside the sandbox Worker (not the kernel
   * act phase), so without this thread its tool calls were invisible to observers.
   */
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
}

// ── executeCodeAction ─────────────────────────────────────────────────────────

/**
 * Run the code-action strategy: generate TypeScript that composes the tools,
 * run it in the Worker sandbox, verify, and regenerate on failure. Refuses
 * (typed ExecutionError) when an approval policy gates any tool.
 */
export const executeCodeAction = (
  input: CodeActionInput,
): Effect.Effect<JudgedReasoningResult, ExecutionError, LLMService | RunEnvelope> =>
  Effect.gen(function* () {
    // Cascade Task 5: cross-cutting policy comes off the ONE run-wide carrier.
    const envelope = yield* RunEnvelope;

    // Durable HITL (Phase D): code-action composes tool calls inside generated
    // TypeScript run by a Worker sandbox — there is no per-call kernel act
    // phase and its calls never flow through the canonical tool-observe
    // primitive, so NEITHER the detach pause NOR the block-mode approval gate
    // can fire. Refuse LOUDLY rather than execute a `requiresApproval` tool with
    // no human decision — for BOTH modes (2026-07-23: block was previously
    // unchecked here, but block is now an enforcing gate everywhere else, so
    // silently executing past it on this one path would reopen the hole). Unlike
    // blueprint, code-action is never chosen by adaptive routing, so this is
    // only reached by an explicit `defaultStrategy: "code-action"` — the caller
    // can pick a gate-capable strategy.
    const approvalPolicy = envelope.rails.approvalPolicy;
    const gatesSomeTool =
      approvalPolicy !== undefined &&
      ((approvalPolicy.tools?.size ?? 0) > 0 || approvalPolicy.requireFor !== undefined);
    if (gatesSomeTool) {
      return yield* Effect.fail(
        new ExecutionError({
          strategy: "code-action",
          message:
            `code-action cannot honor .withApprovalPolicy({ mode: "${approvalPolicy!.mode}" }): its tool calls run inside the sandbox worker, past the approval gate. Use the reactive, reflexion, plan-execute-reflect or tree-of-thought strategy for gated tools.`,
        }),
      );
    }

    // The substrate owns the trajectory: steps, spend (plan / repair / retry
    // calls via `run.call`; the sandbox is 0-LLM), the one run ledger and the
    // result mint. code-action runs no kernel: its sandbox/verify loop is a
    // coarse phase loop with no per-iteration repair hook (spec §3.4).
    return yield* runStrategy(
      {
        strategy: "code-action",
        taskId: input.taskId ?? "code-action",
        requiredTools: input.requiredTools ?? [],
        repairCapabilities: { perIteration: false },
        logSite: "reasoning/src/strategies/code-action.ts:emitLog",
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      },
      (run) => Effect.gen(function* () {
    const start = run.start;
    const toolServiceOpt = yield* Effect.serviceOption(ToolService);
    // Wave C.2 slice 3b-ii — the bus the run ledger announces its growth on.
    // Narrowed to the kernel's structural EventBusInstance (its `publish` takes
    // `unknown`, not `AgentEvent`) — same narrowing `resolveStrategyServices`
    // applies (service-utils.ts).
    const ebOpt = (yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed(Option.none())), // substrate-ok: service lookup, no run.pass inside
    )) as unknown as Option.Option<EventBusInstance>;

    // D9: the run contract, compiled once by the shared strategy primitive; finalize judges delivery against it.
    const runContract = yield* openStrategyContract({ task: extractGoalText(input.taskDescription), taskId: input.taskId ?? "code-action",
      requiredTools: input.requiredTools ?? [], toolSchemas: input.availableToolSchemas, toolService: (yield* resolveStrategyServices).toolService });

    const maxIterations = input.config.strategies.reactive.maxIterations ?? 3;
    const verifier = input.verifier ?? noopVerifier;
    const emitLog = run.emitLog;
    const appendStep = (step: ReasoningStep, kernelPass: string): Effect.Effect<void, never> => {
      run.record(step);
      return publishReasoningStep(ebOpt, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "code-action",
        strategy: "code-action",
        step: run.steps().length,
        totalSteps: run.steps().length,
        ...(step.type === "thought" ? { thought: step.content } : {}),
        ...(step.type === "action" ? { action: step.content } : {}),
        ...(step.type === "observation" ? { observation: step.content } : {}),
        kernelPass,
      });
    };

    // ── Build tool specs for binding generation ─────────────────────────────
    const toolSpecs: ToolSpec[] = (input.availableToolSchemas ?? []).map((s) => {
      const properties: Record<string, ToolParamPropertySchema> = {};
      const required: string[] = [];
      for (const p of s.parameters) {
        // Whole parameter, no field picks: `enum` reaches the bindings.
        properties[p.name] = p;
        if (p.required) required.push(p.name);
      }
      return {
        name: s.name,
        description: s.description,
        ...(s.returnType !== undefined ? { returnType: s.returnType } : {}),
        parameters: { type: "object" as const, properties, required },
      };
    });

    const bindings = generateToolBindings(toolSpecs);
    const { system, user } = buildPlanPrompt(input.taskDescription, bindings);

    // ── Build tool handler map — bridges Worker calls to ToolService ────────
    // P0-4 — the deny-list the safety gate enforces: explicit override, else the
    // declared TaskContract's forbidden tools (the production `.withContract` signal).
    // `forbiddenToolsFromContract` is the ONE shared derivation (Cascade Task 7)
    // — `executeToolAndObserve` itself now falls back to the same helper when a
    // caller passes no policy at all, so this explicit pre-derivation here stays
    // correct but is no longer the only line of defense.
    const forbiddenToolList: readonly string[] =
      input.forbiddenTools ?? forbiddenToolsFromContract(envelope.policy.taskContract);
    const toolPolicy = {
      ...(input.allowedTools !== undefined ? { allowedTools: input.allowedTools } : {}),
      forbiddenTools: forbiddenToolList,
    };
    const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();
    // Budget refusals made inside the sandbox; announced (guard-fired) once it returns.
    const budgetRefusals: { toolName: string; reason: string }[] = [];
    if (Option.isSome(toolServiceOpt)) {
      const toolSvc = toolServiceOpt.value;
      for (const schema of input.availableToolSchemas ?? []) {
        const toolName = schema.name;
        toolHandlers.set(toolName, async (args: unknown) => {
          // P0-4 safety gate — code-action executes tools inside the sandbox
          // Worker (not the kernel act phase), so this closure is its ONLY
          // dispatch choke point. A blocked tool surfaces to the generated code
          // as a thrown error carrying the same policy message the kernel path
          // emits, and is recorded as a failed tool call — never executed.
          const decision = evaluateToolPolicy(toolName, toolPolicy);
          // maxCallsPerTool: reserved after the policy gate, so a blocked call spends
          // no budget. A refused call throws into the generated code like a block.
          const refusal = decision.blocked ? decision.message : run.toolCallBudget.reserve(toolName);
          if (refusal !== undefined) {
            if (!decision.blocked) budgetRefusals.push({ toolName, reason: refusal });
            throw new Error(refusal);
          }
          const output = await Effect.runPromise(
            toolSvc.execute({
              toolName,
              arguments: args as Record<string, unknown>,
              agentId: input.agentId ?? "code-action-agent",
              sessionId: input.sessionId ?? "code-action-session",
            }),
          );
          return output.result;
        });
      }
    }

    yield* emitLog({ _tag: "phase_started", phase: "code-action:plan", timestamp: new Date() });
    yield* appendStep(
      makeStep("thought", `[CODE-ACTION] Plan: generating code for "${input.taskDescription.slice(0, 80)}"`),
      "code-action:plan",
    );

    // ── Plan phase — initial LLM code generation ────────────────────────────
    const planResponse = yield* run.call({ purpose: "plan", budgetClass: "provider-default" }, {
        messages: [{ role: "user", content: user }],
        systemPrompt: withEnvContext(system),
        // GH #246: commanded temperature wins; unset keeps the 0 default.
        temperature: input.temperature ?? 0,
      }, { message: "code-action plan LLM call failed" });

    let generatedCode = extractCodeBlock(planResponse.content);

    yield* appendStep(
      makeStep("action", `[CODE-ACTION] Generated code block (${generatedCode.length} chars)`),
      "code-action:plan",
    );
    yield* emitPhaseEnd({ emitLog, phase: "code-action:plan", startedAt: start, totalTokens: run.spend().tokens });
    yield* emitLog({
      _tag: "log",
      level: "info",
      message: `Code-action plan ready: ${generatedCode.length} chars, ${toolHandlers.size} callable tool(s)`,
      source: "framework",
      timestamp: new Date(),
    });

    let lastToolCalls: ToolCallRecord[] = [];
    let lastResult: unknown = undefined;
    let done = false;
    let iteration = 0;
    // #40 rule 5 — code-action runs NO sub-kernel (sandbox Worker + verifier
    // gate), so its completion envelope derives from this path's own
    // DETERMINISTIC evidence: the final verifier verdict. Terminating on the
    // iteration cap with a FAILING verdict is a partial, not a completion —
    // before #40 this strategy hardcoded status:"completed" even then. The
    // default noopVerifier always passes, so default behavior is unchanged;
    // no kernel markers are fabricated.
    let lastVerdict: VerifierVerdict = "PASS";
    let lastVerifySummary = "";

    let lastSandboxError: string | null = null;

    while (!done) {
      iteration++;
      const executeStartedAt = Date.now();
      yield* emitLog({
        _tag: "phase_started",
        phase: `code-action:execute:${iteration}`,
        timestamp: new Date(),
      });

      // ── Execute phase — run in Worker sandbox ─────────────────────────────
      // A sandbox failure (generated code doesn't parse, throws, times out) is
      // an OBSERVATION, not a strategy-fatal error: the retry loop below
      // already exists to regenerate code from feedback, and hard-failing here
      // threw away both the recovery chance AND the tokens already spent
      // (probe p7 2026-07-11: one syntax error ⇒ run failed with
      // tokensUsed:0 / llmCalls:0 beside a real plan call in the trace).
      const sandboxExit = yield* Effect.either(runInSandbox(generatedCode, toolHandlers)); // substrate-ok: sandbox run is 0-LLM, no run.pass inside
      yield* Effect.forEach(
        budgetRefusals.splice(0),
        (r) => emitBudgetRefusal({ taskId: input.taskId ?? "code-action", iteration, toolName: r.toolName, reason: r.reason }),
        { discard: true },
      );

      if (sandboxExit._tag === "Left") {
        lastSandboxError = sandboxExit.left.message;
        yield* appendStep(
          makeStep(
            "observation",
            `[CODE-ACTION] Sandbox execution failed: ${lastSandboxError}`,
            {
              observationResult: makeObservationResult(
                "code-execute",
                false,
                lastSandboxError,
              ),
            },
          ),
          `code-action:execute:${iteration}`,
        );
        yield* emitPhaseEnd({
          emitLog,
          phase: `code-action:execute:${iteration}`,
          startedAt: executeStartedAt,
          status: "success",
        });
        yield* emitLog({
          _tag: "warning",
          message: `Code-action execution failed on iteration ${iteration}: ${lastSandboxError}`,
          context: "code-action",
          timestamp: new Date(),
        });
        lastVerdict = "FAIL";
        lastVerifySummary = `sandbox execution failed: ${lastSandboxError}`;
        if (iteration >= maxIterations) {
          done = true;
          yield* appendStep(
            makeStep("thought", `[CODE-ACTION] Terminating: sandbox failed on final iteration ${iteration}`),
            `code-action:execute:${iteration}`,
          );
          break;
        }
        // Regenerate with the real failure as feedback (same shape as the
        // verifier-feedback retry below).
        const repairUser = [
          `The previous code FAILED to execute. Error: ${lastSandboxError}`,
          `Previous code:\n\`\`\`typescript\n${generatedCode}\n\`\`\``,
          `\nFix the code and try again. Task: ${input.taskDescription}`,
        ].join("\n\n");
        const repairResponse = yield* run.call({ purpose: "plan", budgetClass: "provider-default" }, {
            messages: [
              { role: "user", content: user },
              { role: "assistant", content: `\`\`\`typescript\n${generatedCode}\n\`\`\`` },
              { role: "user", content: repairUser },
            ],
            systemPrompt: withEnvContext(system),
            // GH #246: commanded temperature wins verbatim over the 0.1*iteration
            // retry-diversity ramp; unset keeps the ramp exactly.
            temperature: input.temperature ?? 0.1 * iteration,
          }, { message: "code-action repair LLM call failed" });
        generatedCode = extractCodeBlock(repairResponse.content);
        yield* appendStep(
          makeStep("action", `[CODE-ACTION] Regenerated code block (${generatedCode.length} chars)`),
          `code-action:plan:${iteration + 1}`,
        );
        yield* emitLog({
          _tag: "log",
          level: "info",
          message: `Code-action repair plan ready: ${generatedCode.length} chars`,
          source: "framework",
          timestamp: new Date(),
        });
        continue;
      }

      const sandboxResult = sandboxExit.right;
      lastSandboxError = null;

      lastToolCalls = sandboxResult.toolCalls;
      lastResult = sandboxResult.finalResult;

      // Canonical ledger pairs — the SAME action/observation shape the kernel
      // act phase writes. The sandbox executed real tools with name+args+result
      // in hand; without these steps, isArtifactProduced's toolCallId-linkage
      // scan starves and a file the sandbox wrote reports `produced:false` on
      // the receipt (probe p7 2026-07-11 — 4th site of the same disease).
      // A rejected sandbox is handled above, so every recorded call succeeded.
      const iterationLedger: { obsStep: ReasoningStep; tc: ToolCallRecord; callId: string }[] = [];
      {
        let callIdx = 0;
        for (const tc of sandboxResult.toolCalls) {
          const callId = `code-action-${iteration}-${callIdx++}`;
          // Root cause #7 (2026-07-29 systems audit): strip a spawn-agent
          // result's carried childRunLedger before it hits model-visible
          // text — code-action was the one delegation path Wave C.2 never
          // wired through the merge/strip pattern the other 3 paths use.
          const resultText =
            typeof tc.result === "string"
              ? tc.result
              : JSON.stringify(subAgentResultForDisplay(tc.result)) ?? "";
          const obsContent = `[${tc.name} result]\n${resultText}`;
          const subAgentLedger = childRunLedgerOf(tc.result);
          // Wave 5.3 review fix: the sandbox dispatch path stamps child
          // envelopes like every other delegation route (same extractor the
          // kernel primitive uses) so the terminal join sees them.
          const childEnvelopes = subAgentChildEnvelopes(tc.result);
          yield* appendStep(
            makeStep("action", `[CODE-ACTION] ${tc.name}`, {
              toolCall: {
                id: callId,
                name: tc.name,
                arguments: (tc.args ?? {}) as Record<string, unknown>,
              },
            }),
            `code-action:execute:${iteration}`,
          );
          const obsStep = makeStep("observation", obsContent, {
            toolCallId: callId,
            observationResult: makeObservationResult(tc.name, true, obsContent, {
              ...(childEnvelopes.length > 0 ? { childEnvelopes: [...childEnvelopes] } : {}),
            }),
            ...(subAgentLedger ? { subAgentLedger } : {}),
          } as ReasoningStep["metadata"]);
          yield* appendStep(obsStep, `code-action:execute:${iteration}`);
          iterationLedger.push({ obsStep, tc, callId });
          yield* emitLog({
            _tag: "tool_call",
            tool: tc.name,
            iteration,
            timestamp: new Date(),
          });
          yield* emitLog({
            _tag: "tool_result",
            tool: tc.name,
            duration: tc.durationMs ?? 0,
            status: "success",
            timestamp: new Date(),
          });
        }
      }

      // FM-I (#195) — emit the canonical observation.tool-result Compose tag for
      // each tool the sandbox actually executed, so `.on()/.tap()` observers,
      // killswitches, and calibration see code-action tool calls like every other
      // strategy (healed:false — code-action has no healing pipeline).
      if (input.harnessPipeline) {
        const stateLike = {
          taskId: input.taskId ?? "code-action",
          strategy: "code-action",
          kernelType: "code-action",
          steps: run.steps(),
          toolsUsed: new Set(sandboxResult.toolCalls.map((c) => c.name)),
          iteration,
          tokens: run.spend().tokens,
          status: "running",
          output: null,
          error: null,
          meta: {},
        };
        for (const { obsStep, tc, callId } of iterationLedger) {
          yield* emitToCompose(input.harnessPipeline, "observation.tool-result", obsStep, {
            iteration,
            phase: "act",
            state: stateLike,
            strategy: "code-action",
            toolName: tc.name,
            callId,
            healed: false,
            durationMs: 0,
          });
        }
      }

      yield* appendStep(
        makeStep(
          "observation",
          `[CODE-ACTION] Sandbox: ${sandboxResult.toolCalls.length} tool calls, result type=${typeof sandboxResult.finalResult}`,
        ),
        `code-action:execute:${iteration}`,
      );
      yield* emitPhaseEnd({
        emitLog,
        phase: `code-action:execute:${iteration}`,
        startedAt: executeStartedAt,
        totalTokens: run.spend().tokens,
      });

      // ── Observe phase — format result for verifier / next iteration ───────
      const observationText = formatObservationMessage(
        sandboxResult.toolCalls,
        sandboxResult.finalResult,
      );

      // ── Reflect phase — verifier gate ─────────────────────────────────────
      const verifyStartedAt = Date.now();
      yield* emitLog({ _tag: "phase_started", phase: `code-action:verify:${iteration}`, timestamp: new Date() });
      const verifyResult = verifier.verify({
        action: "code-execution",
        content: observationText,
        actionSuccess: true,
        task: input.taskDescription,
        priorSteps: run.steps(),
      });

      const verdict: VerifierVerdict = verifyResult.verified ? "PASS" : "FAIL";
      lastVerdict = verdict;
      lastVerifySummary = verifyResult.summary;
      yield* emitLog({
        _tag: "log",
        level: verdict === "PASS" ? "info" : "warn",
        message: `Code-action verification ${verdict}: ${verifyResult.summary}`,
        source: "framework",
        timestamp: new Date(),
      });
      yield* emitPhaseEnd({
        emitLog,
        phase: `code-action:verify:${iteration}`,
        startedAt: verifyStartedAt,
        status: "success",
      });

      if (shouldTerminate({ verdict, iteration, maxIterations })) {
        done = true;
        yield* appendStep(
          makeStep("thought", `[CODE-ACTION] Terminating: verdict=${verdict}, iteration=${iteration}`),
          `code-action:verify:${iteration}`,
        );
        break;
      }

      // W5.5 strategy-tier honesty: the required-tools post-check is enforced
      // at the terminal mint (the substrate hands it requiredTools + the run
      // ledger), not here. An in-loop gate would need kernel tool-
      // call observations that this sandbox loop never produces — checking
      // would misfire on every grounded run. The mint's groundedOnRequired
      // verdict + 5.1 coverage cap are the minimum, with zero new machinery.

      // ── Retry — regenerate code with verifier feedback ────────────────────
      yield* appendStep(
        makeStep("thought", `[CODE-ACTION] Retrying (iteration ${iteration}): ${verifyResult.summary}`),
        `code-action:verify:${iteration}`,
      );
      yield* emitLog({
        _tag: "warning",
        message: `Code-action retry scheduled after iteration ${iteration}: ${verifyResult.summary}`,
        context: "code-action",
        timestamp: new Date(),
      });

      const retryUser = [
        `Previous attempt failed verification. Reason: ${verifyResult.summary}`,
        `Previous code:\n\`\`\`typescript\n${generatedCode}\n\`\`\``,
        `Observation:\n${observationText}`,
        `\nTry again. Task: ${input.taskDescription}`,
      ].join("\n\n");

      const retryResponse = yield* run.call({ purpose: "plan", budgetClass: "provider-default" }, {
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: `\`\`\`typescript\n${generatedCode}\n\`\`\`` },
            { role: "user", content: retryUser },
          ],
          systemPrompt: withEnvContext(system),
          // GH #246: commanded temperature wins verbatim over the 0.1*iteration
          // retry-diversity ramp; unset keeps the ramp exactly.
          temperature: input.temperature ?? 0.1 * iteration,
        }, { message: "code-action retry LLM call failed" });

      generatedCode = extractCodeBlock(retryResponse.content);
      yield* appendStep(
        makeStep("action", `[CODE-ACTION] Regenerated code block (${generatedCode.length} chars)`),
        `code-action:plan:${iteration + 1}`,
      );
      yield* emitLog({
        _tag: "log",
        level: "info",
        message: `Code-action retry plan ready: ${generatedCode.length} chars`,
        source: "framework",
        timestamp: new Date(),
      });
    }

    const resultString =
      typeof lastResult === "string"
        ? lastResult
        : JSON.stringify(lastResult) ?? "";

    // B2: code-action runs no kernel and cannot abstain. A PASS verdict that
    // produced a non-empty result IS a delivered answer; a FAIL-verdict /
    // iteration-cap / empty-output termination is NOT. The status carries that
    // evidence, and the substrate ties the claim to it (`final_answer` iff
    // completed, else `end_turn`) — never `final_answer` on a give-up (the
    // DEFECT-3 lie), so success and goalAchieved never contradict.
    const producedOutput = resultString.trim().length > 0;

    // code-action runs no kernel: the sandbox's action/observation pairs it
    // recorded reach the run ledger through the substrate (one ledger source).
    return {
      _tag: "Result" as const,
      output: resultString,
      // #40: the verifier verdict is the deterministic completion evidence on
      // this kernel-less path. PASS (incl. the default noopVerifier) with a
      // result is `completed`; anything else ships honestly as `partial`.
      status: lastVerdict === "PASS" && producedOutput ? ("completed" as const) : ("partial" as const),
      delivery: { runContract },
      // Surface the real failure cause when the run died on sandbox errors —
      // the mint's M7 invariant will force `failed` on the empty
      // output, and this is the message the user sees instead of nothing.
      ...(lastSandboxError !== null
        ? { error: `code-action sandbox execution failed: ${lastSandboxError}` }
        : {}),
      // H5/#40: name what stayed unmet — the substrate caps at partial and
      // appends this to the run's verification warning (no budget, harness or
      // abstention markers: the output is model-authored).
      ...(lastVerdict === "FAIL"
        ? {
            outcome: {
              _tag: "Unverified" as const,
              warning: `code-action terminated with a failing verifier verdict after ${iteration} iteration(s): ${lastVerifySummary}`,
            },
          }
        : {}),
      extraMetadata: {
        toolCallCount: lastToolCalls.length,
        iterations: iteration,
        codeLength: generatedCode.length,
      },
    };
      }),
    );
  });

(executeCodeAction as unknown as Record<string, unknown>).strategyId =
  "code-action";
