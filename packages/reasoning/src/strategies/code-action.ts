// File: src/strategies/code-action.ts
//
// CodeAgent strategy — LLM generates executable TypeScript code that composes
// available tools as async function calls; executes in a Worker-thread sandbox.
// Loop: plan (code gen) → execute (sandbox) → observe → reflect (verifier gate)
import { Effect, Option } from "effect";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError } from "../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { KernelMessage } from "../kernel/state/kernel-state.js";
import type { ReasoningConfig } from "../types/config.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import {
  makeStep,
  buildStrategyResult,
} from "../kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../kernel/utils/observation-helpers.js";
import { gatewayComplete } from "../kernel/llm-gateway.js";
import { emitToCompose } from "@reactive-agents/core";
import { noopVerifier } from "../kernel/capabilities/verify/noop-verifier.js";
import type { Verifier } from "../kernel/capabilities/verify/verifier.js";
import { generateToolBindings } from "./code-action/tool-binding.js";
import type { ToolSpec } from "./code-action/tool-binding.js";
import { buildPlanPrompt, extractCodeBlock } from "./code-action/code-action-plan.js";
import { runInSandbox } from "./code-action/sandbox.js";
import type { ToolCallRecord } from "./code-action/code-action-observe.js";
import { formatObservationMessage } from "./code-action/code-action-observe.js";
import { shouldTerminate } from "./code-action/code-action-reflect.js";
import type { VerifierVerdict } from "./code-action/code-action-reflect.js";
import { withEnvContext } from "../context/context-engine.js";
import { evaluateToolPolicy } from "../kernel/capabilities/act/tool-observe.js";

// ── CodeActionInput ───────────────────────────────────────────────────────────

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
  /** Declared TaskContract (spread from the reasoning-service params via
   *  `.withContract`) — its `forbidden` tools seed the deny-list. */
  readonly taskContract?: import("@reactive-agents/core").TaskContract;
  readonly metaTools?: KernelMetaToolsConfig;
  readonly initialMessages?: readonly KernelMessage[];
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

export const executeCodeAction = (
  input: CodeActionInput,
): Effect.Effect<ReasoningResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    const start = Date.now();
    const steps: ReasoningStep[] = [];
    const llm = yield* LLMService;
    const toolServiceOpt = yield* Effect.serviceOption(ToolService);

    const maxIterations = input.config.strategies.reactive.maxIterations ?? 3;
    const verifier = input.verifier ?? noopVerifier;

    // ── Build tool specs for binding generation ─────────────────────────────
    const toolSpecs: ToolSpec[] = (input.availableToolSchemas ?? []).map((s) => {
      const properties: Record<string, { type: string; description?: string }> = {};
      const required: string[] = [];
      for (const p of s.parameters) {
        properties[p.name] = { type: p.type, description: p.description };
        if (p.required) required.push(p.name);
      }
      return {
        name: s.name,
        description: s.description,
        parameters: { type: "object" as const, properties, required },
      };
    });

    const bindings = generateToolBindings(toolSpecs);
    const { system, user } = buildPlanPrompt(input.taskDescription, bindings);

    // ── Build tool handler map — bridges Worker calls to ToolService ────────
    // P0-4 — the deny-list the safety gate enforces: explicit override, else the
    // declared TaskContract's forbidden tools (the production `.withContract` signal).
    const forbiddenToolList: readonly string[] =
      input.forbiddenTools ??
      (input.taskContract?.tools
        ?.filter((t) => t.kind === "forbidden")
        .map((t) => t.name) ??
        []);
    const toolPolicy = {
      ...(input.allowedTools !== undefined ? { allowedTools: input.allowedTools } : {}),
      forbiddenTools: forbiddenToolList,
    };
    const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();
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
          if (decision.blocked) {
            throw new Error(decision.message);
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

    steps.push(makeStep("thought", `[CODE-ACTION] Plan: generating code for "${input.taskDescription.slice(0, 80)}"`));

    // ── Plan phase — initial LLM code generation ────────────────────────────
    const planResponse = yield* Effect.mapError(
      gatewayComplete(llm, { purpose: "plan", budgetClass: "provider-default" }, {
        messages: [{ role: "user", content: user }],
        systemPrompt: withEnvContext(system),
        temperature: 0,
      }),
      (cause) =>
        new ExecutionError({
          strategy: "code-action",
          message: "code-action plan LLM call failed",
          cause,
        }),
    );

    let generatedCode = extractCodeBlock(planResponse.content);
    let totalTokens = planResponse.usage.totalTokens;
    let totalCost = planResponse.usage.estimatedCost ?? 0;

    steps.push(makeStep("action", `[CODE-ACTION] Generated code block (${generatedCode.length} chars)`));

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

    let llmCalls = 1; // the plan call above
    let lastSandboxError: string | null = null;

    while (!done) {
      iteration++;

      // ── Execute phase — run in Worker sandbox ─────────────────────────────
      // A sandbox failure (generated code doesn't parse, throws, times out) is
      // an OBSERVATION, not a strategy-fatal error: the retry loop below
      // already exists to regenerate code from feedback, and hard-failing here
      // threw away both the recovery chance AND the tokens already spent
      // (probe p7 2026-07-11: one syntax error ⇒ run failed with
      // tokensUsed:0 / llmCalls:0 beside a real plan call in the trace).
      const sandboxExit = yield* Effect.either(
        Effect.tryPromise({
          try: () => runInSandbox(generatedCode, toolHandlers),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        }),
      );

      if (sandboxExit._tag === "Left") {
        lastSandboxError = sandboxExit.left.message;
        steps.push(
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
        );
        lastVerdict = "FAIL";
        lastVerifySummary = `sandbox execution failed: ${lastSandboxError}`;
        if (iteration >= maxIterations) {
          done = true;
          steps.push(
            makeStep("thought", `[CODE-ACTION] Terminating: sandbox failed on final iteration ${iteration}`),
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
        const repairResponse = yield* Effect.mapError(
          gatewayComplete(llm, { purpose: "plan", budgetClass: "provider-default" }, {
            messages: [
              { role: "user", content: user },
              { role: "assistant", content: `\`\`\`typescript\n${generatedCode}\n\`\`\`` },
              { role: "user", content: repairUser },
            ],
            systemPrompt: withEnvContext(system),
            temperature: 0.1 * iteration,
          }),
          (cause) =>
            new ExecutionError({
              strategy: "code-action",
              message: "code-action repair LLM call failed",
              cause,
            }),
        );
        generatedCode = extractCodeBlock(repairResponse.content);
        totalTokens += repairResponse.usage.totalTokens;
        totalCost += repairResponse.usage.estimatedCost ?? 0;
        llmCalls += 1;
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
          const resultText =
            typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result) ?? "";
          const obsContent = `[${tc.name} result]\n${resultText}`;
          steps.push(
            makeStep("action", `[CODE-ACTION] ${tc.name}`, {
              toolCall: {
                id: callId,
                name: tc.name,
                arguments: (tc.args ?? {}) as Record<string, unknown>,
              },
            }),
          );
          const obsStep = makeStep("observation", obsContent, {
            toolCallId: callId,
            observationResult: makeObservationResult(tc.name, true, obsContent),
          });
          steps.push(obsStep);
          iterationLedger.push({ obsStep, tc, callId });
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
          steps,
          toolsUsed: new Set(sandboxResult.toolCalls.map((c) => c.name)),
          iteration,
          tokens: totalTokens,
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

      steps.push(
        makeStep(
          "observation",
          `[CODE-ACTION] Sandbox: ${sandboxResult.toolCalls.length} tool calls, result type=${typeof sandboxResult.finalResult}`,
        ),
      );

      // ── Observe phase — format result for verifier / next iteration ───────
      const observationText = formatObservationMessage(
        sandboxResult.toolCalls,
        sandboxResult.finalResult,
      );

      // ── Reflect phase — verifier gate ─────────────────────────────────────
      const verifyResult = verifier.verify({
        action: "code-execution",
        content: observationText,
        actionSuccess: true,
        task: input.taskDescription,
        priorSteps: steps,
      });

      const verdict: VerifierVerdict = verifyResult.verified ? "PASS" : "FAIL";
      lastVerdict = verdict;
      lastVerifySummary = verifyResult.summary;

      if (shouldTerminate({ verdict, iteration, maxIterations })) {
        done = true;
        steps.push(makeStep("thought", `[CODE-ACTION] Terminating: verdict=${verdict}, iteration=${iteration}`));
        break;
      }

      // ── Retry — regenerate code with verifier feedback ────────────────────
      steps.push(makeStep("thought", `[CODE-ACTION] Retrying (iteration ${iteration}): ${verifyResult.summary}`));

      const retryUser = [
        `Previous attempt failed verification. Reason: ${verifyResult.summary}`,
        `Previous code:\n\`\`\`typescript\n${generatedCode}\n\`\`\``,
        `Observation:\n${observationText}`,
        `\nTry again. Task: ${input.taskDescription}`,
      ].join("\n\n");

      const retryResponse = yield* Effect.mapError(
        gatewayComplete(llm, { purpose: "plan", budgetClass: "provider-default" }, {
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: `\`\`\`typescript\n${generatedCode}\n\`\`\`` },
            { role: "user", content: retryUser },
          ],
          systemPrompt: withEnvContext(system),
          temperature: 0.1 * iteration,
        }),
        (cause) =>
          new ExecutionError({
            strategy: "code-action",
            message: "code-action retry LLM call failed",
            cause,
          }),
      );

      generatedCode = extractCodeBlock(retryResponse.content);
      totalTokens += retryResponse.usage.totalTokens;
      totalCost += retryResponse.usage.estimatedCost ?? 0;
      llmCalls += 1;
    }

    const resultString =
      typeof lastResult === "string"
        ? lastResult
        : JSON.stringify(lastResult) ?? "";

    // B2: code-action runs no kernel and cannot abstain, but it still MUST
    // forward an honest closed terminatedBy — otherwise every code-action run
    // was mislabeled `end_turn` and goalAchieved never resolved. A PASS verdict
    // that produced a non-empty result IS a delivered answer (`final_answer`);
    // a FAIL-verdict / iteration-cap / empty-output termination is NOT — it maps
    // to `end_turn` (goalAchieved defers to the deliverable scan) rather than
    // fabricating `final_answer` on a give-up (the DEFECT-3 lie). This ties the
    // claim to the same evidence buildStrategyResult uses for `status`, so
    // success and goalAchieved never contradict.
    const producedOutput = resultString.trim().length > 0;
    const terminatedBy: "final_answer" | "end_turn" =
      lastVerdict === "PASS" && producedOutput ? "final_answer" : "end_turn";

    return buildStrategyResult({
      strategy: "code-action",
      steps,
      output: resultString,
      // #40: the verifier verdict is the deterministic completion evidence on
      // this kernel-less path — a FAIL-verdict termination (iteration cap
      // exhausted) ships the work honestly labeled `partial`, never
      // `completed`. PASS (incl. the default noopVerifier) is unchanged.
      status: lastVerdict === "PASS" ? "completed" : "partial",
      start,
      totalTokens,
      totalCost,
      // Surface the real failure cause when the run died on sandbox errors —
      // buildStrategyResult's M7 invariant will force `failed` on the empty
      // output, and this is the message the user sees instead of nothing.
      ...(lastSandboxError !== null
        ? { error: `code-action sandbox execution failed: ${lastSandboxError}` }
        : {}),
      extraMetadata: {
        terminatedBy,
        toolCallCount: lastToolCalls.length,
        iterations: iteration,
        llmCalls,
        codeLength: generatedCode.length,
        // H5/#40: name what stayed unmet — same channel reactive ships.
        ...(lastVerdict === "FAIL"
          ? {
              verificationWarning: `code-action terminated with a failing verifier verdict after ${iteration} iteration(s): ${lastVerifySummary}`,
            }
          : {}),
      },
    });
  });

(executeCodeAction as unknown as Record<string, unknown>).strategyId =
  "code-action";
