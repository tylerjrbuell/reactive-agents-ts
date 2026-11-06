/**
 * One Ollama `completeStructured()` attempt, read off the non-streaming chat
 * response: content, usage, stop reason and thinking size.
 *
 * Ollama has no `mapOllamaResponse`; the complete() path builds usage inline
 * from `prompt_eval_count` / `eval_count`. This mirrors that for the
 * structured path so the structured-usage sink (and its per-attempt report)
 * is populated for the local provider too.
 */
import { reportedStopReason } from '../params/stop-reason.js'
import type { StructuredAttemptResult } from '../structured-parse-retry.js'

/** The fields of an Ollama chat response a structured attempt reads. */
export type OllamaStructuredResponse = {
    readonly message?: { readonly content?: string; readonly thinking?: string }
    readonly prompt_eval_count?: number
    readonly eval_count?: number
    readonly done_reason?: string
}

/**
 * Shape an Ollama chat response into a structured attempt result.
 * `stopReason` comes from `done_reason` (`stop` -> `end_turn`, `length` ->
 * `max_tokens`, anything else passed through raw). `thinkingChars` is the
 * length of `message.thinking`, present only when the model thought.
 */
export function ollamaStructuredAttempt(
    response: OllamaStructuredResponse
): StructuredAttemptResult {
    const inputTokens = response.prompt_eval_count ?? 0
    const outputTokens = response.eval_count ?? 0
    const stopReason = reportedStopReason(response.done_reason, 'ollama')
    const thinking = response.message?.thinking
    return {
        content: response.message?.content ?? '',
        usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            estimatedCost: 0, // Local models are free
        },
        ...(stopReason !== undefined ? { stopReason } : {}),
        ...(typeof thinking === 'string' && thinking.length > 0
            ? { thinkingChars: thinking.length }
            : {}),
    }
}
