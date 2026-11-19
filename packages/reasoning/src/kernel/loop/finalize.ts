// File: src/kernel/loop/finalize.ts
/**
 * Shared synthesis quality gate and tool-data harvest.
 *
 * Canonical home for the DATA → FORMAT synthesis pattern. Strategies that
 * complete a multi-pass trajectory and need a final output-formatting pass
 * route through here instead of reinventing the gate locally.
 *
 * Why this lives in kernel/loop/:
 *   - `collectToolData` reads from `KernelMessage[]` because the kernel
 *     conversation thread is the canonical source of truth for tool results.
 *   - `enforceQualityGate` re-validates synthesized output against the same
 *     format detector the rest of the kernel uses (`extractOutputFormat`),
 *     keeping format detection single-sourced.
 *
 * Pattern (extracted from reflexion fix `0af217c8`):
 *   1. `decideSynthesisInput` — pure decision: skip / synthesize from draft /
 *      synthesize from tool data. Synthesis fires when format is wrong OR
 *      completeness fails (placeholder detection).
 *   2. `enforceQualityGate` — Effect-returning wrapper: invoke synthesis only
 *      when needed, revalidate result, fall back to draft if synthesis fails.
 *
 * Spec: wiki/Architecture/Design-Specs/2026-05-24-strategy-composability-design.md
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { contentText } from "@reactive-agents/core";
import { extractOutputFormat } from "../capabilities/comprehend/task-intent.js";
import {
  validateOutputFormat,
  validateContentCompleteness,
  buildSynthesisPrompt,
} from "./output-synthesis.js";
import { detectScaffoldLeak } from "../capabilities/verify/scaffold-leak.js";
import { runTerminalSynthesis } from "./terminal-synthesis.js";
import { NO_TOKEN_SPEND, tokenSpendOf, type TokenSpend } from "../run-budget.js";
import { withEnvContext } from "../../context/context-engine.js";
import type { KernelMessage } from "../state/kernel-state.js";

export {
  validateOutputFormat,
  validateContentCompleteness,
  buildSynthesisPrompt,
  extractOutputFormat,
};

/**
 * Pure decision: should the output be synthesized, and from what source?
 *
 * Synthesis fires when EITHER the declared format is wrong OR semantic
 * completeness fails (e.g. format-valid markdown with unfilled placeholders
 * like "[Insert BTC Price Here]" — common reflexion failure mode).
 *
 * When tool data is available it feeds synthesis (DATA → FORMAT). When it's
 * not (pure reasoning task), synthesis falls back to the draft.
 */
export function decideSynthesisInput(
  output: string,
  taskDescription: string,
  toolData: string | undefined,
): { needsSynthesis: boolean; rawForSynthesis: string } {
  // Compression-marker echo is a structural failure regardless of format —
  // the model shipped framework internal scaffolding ([STORED: _tool_result_N],
  // "Type: Object(...)", "compressed preview", etc.) as the final answer
  // instead of synthesizing real content. This was the MCP probe M4 failure
  // mode on plan-execute: model echoed the github/search_repositories preview
  // verbatim. Force synthesis-from-tool-data when detected.
  const markerCheck = detectScaffoldLeak(output);
  if (markerCheck.leaked) {
    const rawForSynthesis = toolData && toolData.length > 0 ? toolData : output;
    return { needsSynthesis: true, rawForSynthesis };
  }

  const intent = extractOutputFormat(taskDescription);
  if (!intent.format) {
    return { needsSynthesis: false, rawForSynthesis: output };
  }
  const validation = validateOutputFormat(output, intent.format);
  const completeness = validateContentCompleteness(output, intent);
  if (validation.valid && completeness.complete) {
    return { needsSynthesis: false, rawForSynthesis: output };
  }
  const rawForSynthesis = toolData && toolData.length > 0 ? toolData : output;
  return { needsSynthesis: true, rawForSynthesis };
}

/**
 * Extract raw tool_result content from a kernel conversation thread.
 *
 * Reads from `KernelMessage[]` (not `ReasoningStep[]`) because the kernel
 * conversation thread is the canonical source of truth for tool execution
 * results. Errors are filtered out so synthesis never sees failure noise.
 * `exclude` drops results of the named tools (e.g. `META_TOOLS`: a `todo`
 * result carries call instructions like `todo({action:"done"})`, which a
 * tool-less synthesis call must never see; audit G4, 2026-11-18).
 */
export function collectToolData(messages: readonly KernelMessage[], exclude?: ReadonlySet<string>): string {
  const parts: string[] = [];
  for (const m of messages) {
    // contentText: a parts result must never stringify to "[object Object]".
    const text = m.role === "tool_result" && !m.isError && exclude?.has(m.toolName) !== true ? contentText(m.content) : "";
    if (m.role === "tool_result" && text) {
      parts.push(`[${m.toolName}] ${text}`);
    }
  }
  return parts.join("\n");
}

/**
 * Effect-returning synthesis quality gate.
 *
 * Decides via `decideSynthesisInput`, fires synthesis only when needed,
 * extracts thinking-safe content (recovers answers trapped inside `<think>`),
 * revalidates against the declared format, and falls back to the original
 * draft on any failure.
 *
 * Caller passes `toolData` when it has harvested real tool results from the
 * conversation thread (preferred). When omitted, synthesis runs against the
 * draft only — appropriate for strategies whose draft already concatenates
 * raw observations (e.g. plan-execute's `[EXEC` harvest).
 */
export function enforceQualityGate(input: {
  llm: LLMService["Type"];
  taskDescription: string;
  output: string;
  toolData?: string;
  /** P2 (2026-07-07): correlates this synthesis exchange to its run in traces
   * — without it the call files under the `llm-direct` placeholder. */
  traceContext?: { taskId?: string; iteration?: number };
  /**
   * Synthesize even when the draft passes the checks: the draft is not an
   * answer (reflexion's empty generate pass). Material: `toolData`, else the draft.
   */
  force?: boolean;
}): Effect.Effect<
  { output: string } & TokenSpend,
  never,
  never
> {
  const decision = input.force === true
    ? { needsSynthesis: true, rawForSynthesis: input.toolData && input.toolData.length > 0 ? input.toolData : input.output }
    : decideSynthesisInput(input.output, input.taskDescription, input.toolData);
  if (!decision.needsSynthesis) {
    return Effect.succeed({ output: input.output, ...NO_TOKEN_SPEND });
  }
  const intent = extractOutputFormat(input.taskDescription);
  // Default to "prose" when no explicit format detected — covers compression-echo
  // synthesis for free-form tasks (MCP probe M4: "summarize in one sentence").
  const synthesisFormat = intent.format ?? "prose";
  const synthesisPrompt = buildSynthesisPrompt(
    decision.rawForSynthesis,
    synthesisFormat,
    input.taskDescription,
  );

  // The deliverable render — the shared terminal synthesis call (generous
  // budget, thinking-safe, errors → empty draft fallback with zero spend).
  return runTerminalSynthesis(input.llm, {
    prompt: synthesisPrompt,
    systemPrompt: withEnvContext(undefined),
    ...(input.traceContext ? { traceContext: input.traceContext } : {}),
  }).pipe(
    Effect.map((synth) => {
      const candidate = synth.content.trim();
      const valid = candidate.length > 0 && validateOutputFormat(candidate, synthesisFormat).valid;
      return { output: valid ? candidate : input.output, ...tokenSpendOf(synth) };
    }),
  );
}
