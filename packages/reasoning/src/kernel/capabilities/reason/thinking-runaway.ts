/**
 * Think phase — thinking-runaway recovery (H3 baseline 2026-11-05, defect 3).
 * A `max_tokens` stop with no visible content and no tool call, only thinking,
 * is a runaway, not a truncated answer: escalating the budget (Stage 1) buys a
 * longer runaway. It gets one retry at the SAME budget with a recovery turn,
 * then an honest failure; each decision is a `thinking-runaway` trace signal.
 */
import { Effect } from "effect";
import { extractThinking } from "../../utils/stream-parser.js";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import { transitionState, type KernelState, type KernelMessage } from "../../../kernel/state/kernel-state.js";

/** Retries a runaway gets before the run fails (shares maxOutputTokensRecoveryCount). */
export const THINKING_RUNAWAY_RETRIES = 1;

/** The recovery turn appended before the single retry. */
export const THINKING_RUNAWAY_MESSAGE =
  "[Harness] Your reasoning used the whole output budget and produced no answer. Reply now with your next tool call or your final answer. Keep reasoning short.";

/** True when a `max_tokens` turn produced only thinking: no content, no tool call. */
export function isThinkingRunaway(content: string, providerThinking: string, toolCallCount: number): boolean {
  if (toolCallCount > 0) return false;
  const { thinking, content: visible } = extractThinking(content);
  return visible.trim().length === 0 && (thinking ?? providerThinking).trim().length > 0;
}

/**
 * True when this think call is the one runaway retry: the last conversation
 * message is the recovery turn {@link recoverThinkingRunaway} appended. The
 * retry request then sends `thinking: false` (CompletionRequest override) —
 * the same budget with thinking still on tends to run away again (Plan 9 #9).
 */
export function isThinkingRunawayRetry(state: KernelState): boolean {
  const last = state.messages[state.messages.length - 1];
  return last !== undefined && last.role === "user" && last.content === THINKING_RUNAWAY_MESSAGE;
}

/** Retry once at the existing budget with thinking off, then fail honestly. Never escalates the budget. */
export function recoverThinkingRunaway(state: KernelState, thinkingChars: number, outputTokens: number) {
  return Effect.gen(function* () {
    const attempt = (state.maxOutputTokensRecoveryCount ?? 0) + 1;
    const exhausted = attempt > THINKING_RUNAWAY_RETRIES;
    yield* emitHarnessSignalInjected({
      taskId: state.taskId,
      iteration: state.iteration,
      signalKind: exhausted ? "block" : "redirect",
      origin: "thinking-runaway",
      content: exhausted
        ? "thinking runaway repeated after a retry: run failed"
        : "thinking runaway: retry at the same output budget with a recovery turn and thinking off",
      metadata: { thinkingChars, outputTokens, attempt, exhausted, ...(exhausted ? {} : { retryThinking: false }) },
    });
    if (exhausted) {
      return transitionState(state, {
        status: "failed",
        error: "thinking runaway: the model spent its output budget reasoning and produced no answer",
      });
    }
    const recovery: KernelMessage = { role: "user", content: THINKING_RUNAWAY_MESSAGE };
    return transitionState(state, {
      messages: [...state.messages, recovery],
      maxOutputTokensRecoveryCount: attempt,
    });
  });
}
