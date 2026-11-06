// File: src/kernel/loop/terminal-synthesis.ts
/**
 * The ONE terminal synthesis call — the LLM pass that renders a run's
 * deliverable (Plan 9 Phase 2, one completion authority).
 *
 * Six terminal sites used to hand-roll the identical call: the strategy
 * quality gate (`finalize.ts` `enforceQualityGate`), the budget-band forced
 * synthesis (`runner-helpers/pace-terminal.ts`), the §9 output quality gate,
 * the §9.0 grounding (D1) and scaffold-leak (D2) repairs, and the exit-gate
 * handoff synthesis. Each one: `purpose: "synthesize"` on the generous budget
 * (H3: the deliverable render is the one place spend is always justified),
 * temperature 0.2, provider errors swallowed to an empty answer, and the
 * answer read through `extractThinkingSafeContent` so a `<think>` preamble
 * never leaks into the user-facing output.
 *
 * Callers keep their own prompt and their own empty / revalidation semantics;
 * only the call lives here. `seam-terminal-pipeline.test.ts` pins that no other
 * kernel/strategy source issues a generous synthesis call directly.
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { gatewayComplete } from "../llm-gateway.js";
import { extractThinkingSafeContent } from "../utils/stream-parser.js";

/** The rendered answer (thinking-safe, NOT trimmed) plus the call's spend. */
export interface TerminalSynthesis {
  readonly content: string;
  readonly tokens: number;
  readonly cost: number;
}

/** Inputs of one terminal synthesis call. */
export interface TerminalSynthesisRequest {
  /** The full synthesis prompt, sent as the single user message. */
  readonly prompt: string;
  /** Optional system prompt (only the strategy quality gate sends one). */
  readonly systemPrompt?: string;
  /** Correlates the exchange to its run in traces. */
  readonly traceContext?: { readonly taskId?: string; readonly iteration?: number };
}

/**
 * Run one terminal synthesis. Never fails: a provider error yields an empty
 * `content` with zero spend, so every caller falls back to its own floor.
 */
export function runTerminalSynthesis(
  llm: LLMService["Type"],
  request: TerminalSynthesisRequest,
): Effect.Effect<TerminalSynthesis, never, never> {
  return gatewayComplete(
    llm,
    { purpose: "synthesize", budgetClass: "generous" },
    {
      messages: [{ role: "user", content: request.prompt }],
      ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
      temperature: 0.2,
      ...(request.traceContext !== undefined ? { traceContext: request.traceContext } : {}),
    },
  ).pipe(
    Effect.map((response) => ({
      content: extractThinkingSafeContent(response).content,
      tokens: response.usage?.totalTokens ?? 0,
      cost: response.usage?.estimatedCost ?? 0,
    })),
    Effect.catchAll(() => Effect.succeed({ content: "", tokens: 0, cost: 0 })),
  );
}
