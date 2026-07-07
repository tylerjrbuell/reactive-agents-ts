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
    const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();
    if (Option.isSome(toolServiceOpt)) {
      const toolSvc = toolServiceOpt.value;
      for (const schema of input.availableToolSchemas ?? []) {
        const toolName = schema.name;
        toolHandlers.set(toolName, async (args: unknown) => {
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

    while (!done) {
      iteration++;

      // ── Execute phase — run in Worker sandbox ─────────────────────────────
      const sandboxResult = yield* Effect.mapError(
        Effect.tryPromise({
          try: () => runInSandbox(generatedCode, toolHandlers),
          catch: (e) => e,
        }),
        (cause) =>
          new ExecutionError({
            strategy: "code-action",
            message: `code-action sandbox execution failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      );

      lastToolCalls = sandboxResult.toolCalls;
      lastResult = sandboxResult.finalResult;

      // FM-I (#195) — emit the canonical observation.tool-result Compose tag for
      // each tool the sandbox actually executed, so `.on()/.tap()` observers,
      // killswitches, and calibration see code-action tool calls like every other
      // strategy. A rejected sandbox throws before this point, so every recorded
      // call succeeded (healed:false — code-action has no healing pipeline).
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
        let callIdx = 0;
        for (const tc of sandboxResult.toolCalls) {
          const resultText =
            typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result) ?? "";
          const obsContent = `[${tc.name} result]\n${resultText}`;
          const obsStep = makeStep("observation", obsContent, {
            observationResult: makeObservationResult(tc.name, true, obsContent),
          });
          yield* emitToCompose(input.harnessPipeline, "observation.tool-result", obsStep, {
            iteration,
            phase: "act",
            state: stateLike,
            strategy: "code-action",
            toolName: tc.name,
            callId: `code-action-${iteration}-${callIdx++}`,
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
    }

    const resultString =
      typeof lastResult === "string"
        ? lastResult
        : JSON.stringify(lastResult) ?? "";

    return buildStrategyResult({
      strategy: "code-action",
      steps,
      output: resultString,
      status: "completed",
      start,
      totalTokens,
      totalCost,
      extraMetadata: {
        toolCallCount: lastToolCalls.length,
        iterations: iteration,
        codeLength: generatedCode.length,
      },
    });
  });

(executeCodeAction as unknown as Record<string, unknown>).strategyId =
  "code-action";
