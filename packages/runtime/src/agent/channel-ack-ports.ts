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
 * The widened result of `RoutedSession["acknowledge"]` (text plus why it is unusable). Derived
 * from the channels port type: the channels package does not re-export `AckPortResult`.
 */
type AckPortResult = Effect.Effect.Success<ReturnType<NonNullable<RoutedSession["acknowledge"]>>>;
type AckPortObject = Exclude<AckPortResult, string>;

/** Why a model ack came back unusable (the router then sends the canned text). The router owns `timeout`. */
export type AckFallbackReason = Exclude<NonNullable<AckPortObject["fallbackReason"]>, "timeout">;

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
  onProgress: ((text: string) => void) | undefined,
): Promise<StreamedTurn> => {
  let pre = "";
  let toolSeen = false;
  for await (const event of stream) {
    if (event._tag === "TextDelta" && !toolSeen) {
      pre += event.text;
    } else if (event._tag === "ToolCallStarted" && !toolSeen) {
      toolSeen = true;
      const narration = pre.trim();
      if (narration.length > 0 && onProgress) {
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
 * `RoutedSession["acknowledge"]` over a plain completion. Returns `{ text }` on success; an
 * unusable result is `{ text: "", fallbackReason }` (`thinking_only`, `empty`, `error`) so the
 * router can report why it sent the canned text. Extended thinking is switched off for the call:
 * a thinking model otherwise spends the router's few-second bound (and the token budget) reasoning
 * before any visible text.
 */
export const makeAcknowledge =
  (complete: NonNullable<ChannelAgentHandle["complete"]>): NonNullable<RoutedSession["acknowledge"]> =>
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
      Effect.map((r): AckPortObject => {
        const text = r.message.trim();
        if (text.length > 0) return { text };
        const reason: AckFallbackReason = (r.thinking ?? "").trim().length > 0 ? "thinking_only" : "empty";
        return { text: "", fallbackReason: reason };
      }),
      Effect.orElseSucceed((): AckPortObject => ({ text: "", fallbackReason: "error" })),
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
