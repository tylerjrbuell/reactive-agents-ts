/**
 * Model-written acknowledgement ports for routed channel sessions (`ack.source: "model"`).
 *
 * Two optional ports back the router's model-ack path:
 *  - narration: text the agent streams before its first tool call, forwarded to `turn.onProgress`;
 *  - acknowledge: one tiny tool-less completion, run beside the turn (not through the chat engine's
 *    per-session turn gate) and never recorded in session history.
 *
 * Sender text reaches the model as user-role content only; the system prompt is fixed here.
 */
import { Effect } from "effect";
import type { RoutedSession, RoutedTurn } from "@reactive-agents/channels";
import { makeChatComplete } from "./chat-capabilities.js";
import { makeSessionHistoryStore } from "./session-store.js";
import type { AgentStreamEvent } from "../stream-types.js";
import type { ReactiveAgentBuilder } from "../builder.js";
import type { ChannelAgentHandle } from "./channel-router-resolver.js";

/** Token budget for the acknowledgement completion: one short sentence. */
export const ACK_MAX_TOKENS = 80;

/**
 * Why a model ack came back unusable (the router then sends the canned text). The router owns
 * the `timeout` case (it bounds the port); the runtime can only see these.
 */
export type AckFallbackReason = "empty" | "thinking_only" | "error";

const ACK_SYSTEM_PROMPT =
  "You are replying in a chat. The user's message follows. Write ONE short sentence (under 20 words) " +
  "telling them you are starting on it. Do not answer the request, do not ask questions, no markdown.";

/** The result of a streamed routed turn. */
export interface StreamedTurn {
  readonly text: string;
  readonly tokens: number;
  readonly cost: number;
}

/**
 * Drain a full-density stream. Text written before the first tool call is forwarded once, when that
 * call starts (so a final answer is never mistaken for narration). A throwing `onProgress` is
 * swallowed: narration must never fail the turn. A stream that errors or ends without a completion
 * rejects.
 */
export const drainWithNarration = async (
  stream: AsyncIterable<AgentStreamEvent>,
  onProgress: (text: string) => void,
): Promise<StreamedTurn> => {
  let pre = "";
  let toolSeen = false;
  for await (const event of stream) {
    if (event._tag === "TextDelta" && !toolSeen) {
      pre += event.text;
    } else if (event._tag === "ToolCallStarted" && !toolSeen) {
      toolSeen = true;
      const narration = pre.trim();
      if (narration.length > 0) {
        try {
          onProgress(narration);
        } catch {
          // narration is best effort
        }
      }
    } else if (event._tag === "StreamError") {
      return Promise.reject(event.cause);
    } else if (event._tag === "StreamCompleted") {
      return { text: event.output, tokens: event.metadata.tokensUsed, cost: event.metadata.cost };
    }
  }
  return Promise.reject("stream ended without a completion");
};

/**
 * `RoutedSession["acknowledge"]` over a plain completion; fails soft to an empty string.
 * Extended thinking is switched off for the call: a thinking model otherwise spends the
 * router's few-second bound (and the token budget) reasoning before any visible text.
 * `onFallback` (optional) is told why an unusable result was returned.
 */
export const makeAcknowledge =
  (
    complete: NonNullable<ChannelAgentHandle["complete"]>,
    onFallback?: (reason: AckFallbackReason) => void,
  ): NonNullable<RoutedSession["acknowledge"]> =>
  (turn: RoutedTurn) =>
    Effect.tryPromise({
      try: () =>
        complete({
          systemPrompt: ACK_SYSTEM_PROMPT,
          messages: [{ role: "user", content: turn.text }],
          budgetTokens: ACK_MAX_TOKENS,
          thinking: false,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.map((r) => {
        const text = r.message.trim();
        if (text.length === 0) onFallback?.((r.thinking ?? "").trim().length > 0 ? "thinking_only" : "empty");
        return text;
      }),
      Effect.orElseSucceed(() => {
        onFallback?.("error");
        return "";
      }),
    );

/**
 * Adapt a built agent to a `ChannelAgentHandle`, adding the side-completion port
 * (`complete`) that `makeAcknowledge` needs. Use when wiring a custom channel resolver.
 */
export const toChannelHandle = (agent: Awaited<ReturnType<ReactiveAgentBuilder["build"]>>): ChannelAgentHandle => ({
  agentId: agent.agentId,
  dispose: () => agent.dispose(),
  session: (options) => agent.session(options),
  run: (text) => agent.run(text),
  complete: makeChatComplete(agent.runtime),
  clearSessionHistory: makeSessionHistoryStore(agent.runtime, agent.agentId).clear,
});
