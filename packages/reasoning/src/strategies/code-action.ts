// File: src/strategies/code-action.ts
//
// Phase D: CodeAgentStrategy — generates executable TypeScript code that
// composes available tools and runs the result in a Worker sandbox.
//
// Current state: skeleton stub (returns ExecutionError). Full implementation
// in subsequent tasks (code-gen LLM call, Worker sandbox, output extraction).
import { Effect } from "effect";
import type { ReasoningResult } from "../types/index.js";
import { ExecutionError } from "../errors/errors.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { KernelMessage } from "../kernel/state/kernel-state.js";
import type { ReasoningConfig } from "../types/config.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";

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
}

// ── executeCodeAction ─────────────────────────────────────────────────────────

/**
 * Code-action strategy — stub implementation.
 *
 * Planned behavior:
 * 1. Ask LLM to generate TypeScript code that uses the available tool bindings.
 * 2. Run generated code in a Worker sandbox with tool stubs wired to real tools.
 * 3. Capture output and return as a ReasoningResult.
 *
 * Currently returns ExecutionError("not yet implemented") as a placeholder.
 */
export const executeCodeAction = (
  _input: CodeActionInput,
): Effect.Effect<ReasoningResult, ExecutionError, LLMService> =>
  Effect.gen(function* () {
    return yield* Effect.fail(
      new ExecutionError({
        message: "code-action strategy: not yet implemented",
        cause: undefined,
      }),
    );
  });

(executeCodeAction as unknown as Record<string, unknown>).strategyId =
  "code-action";
