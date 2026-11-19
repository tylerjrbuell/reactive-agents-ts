/**
 * Gemini thought signatures for function calls.
 *
 * Gemini 3-family models attach an opaque `thoughtSignature` to the first
 * `functionCall` part of each model step and require it back on that part when
 * the call is replayed. The check covers the "current turn": every content
 * after the last user message that carries text. A request whose history ends
 * in function responses with no user text after them (for example a reflexion
 * improve pass seeded with the prior pass's tool calls) is rejected with
 * `400 Function call is missing a thought_signature in functionCall parts`.
 * A request with a user text message after the calls is not checked, which is
 * why the reactive loop (it appends requirement and guidance messages) never
 * hit the 400.
 *
 * Reasoning code rebuilds assistant tool calls from `{ id, name, arguments }`
 * only, so the signature cannot ride on the message. The provider keeps it
 * here, keyed by the tool-call id it generated, and puts it back when it
 * converts history to Gemini contents. When the id is unknown (history from
 * another provider, another process, or a synthesized turn) the first call of
 * the model content gets Google's documented placeholder signature, which
 * skips validation. Live-checked 2026-11-19: gemini-flash-latest returns 400
 * without a signature and 200 with the real one or the placeholder;
 * gemini-2.5-flash accepts the placeholder.
 */

/** Google's documented placeholder for a function call whose real signature is unknown. */
export const GEMINI_PLACEHOLDER_SIGNATURE = "skip_thought_signature_validator";

/** Default number of signatures one provider instance remembers (oldest dropped first). */
const DEFAULT_CAPACITY = 2048;

/** Per-provider-instance map from generated tool-call id to its thought signature. */
export interface ThoughtSignatureStore {
  /** Remember the signature Gemini returned on the call with this id. */
  readonly remember: (toolCallId: string, signature: string) => void;
  /** The remembered signature for this id, if any. */
  readonly lookup: (toolCallId: string) => string | undefined;
}

/**
 * Create a bounded signature store. One per `GeminiProviderLive` instance (no
 * module-level state); the oldest entries drop once `capacity` is reached.
 *
 * @param capacity — maximum remembered signatures
 */
export const makeThoughtSignatureStore = (capacity: number = DEFAULT_CAPACITY): ThoughtSignatureStore => {
  const byId = new Map<string, string>();
  return {
    remember: (toolCallId, signature) => {
      if (signature.length === 0) return;
      byId.delete(toolCallId);
      byId.set(toolCallId, signature);
      while (byId.size > capacity) {
        const oldest = byId.keys().next();
        if (oldest.done === true) break;
        byId.delete(oldest.value);
      }
    },
    lookup: (toolCallId) => byId.get(toolCallId),
  };
};

/**
 * A tool-call id unique across calls and provider instances. Signatures are
 * keyed by this id, so a reused id (the old per-response `call_0`) would
 * replay one step's signature on another step.
 *
 * @param index — position of the call in its response
 */
export const newGeminiToolCallId = (index: number): string =>
  `gemini-tc-${Date.now().toString(36)}-${globalThis.crypto.randomUUID().slice(0, 8)}-${index}`;

/** A response part as the SDK returns it (only the fields read here). */
type SignedPart = { readonly functionCall?: unknown; readonly thoughtSignature?: string };

/**
 * Store the signatures of a response's function-call parts under the ids the
 * provider assigned. Ids pair with function-call parts by position.
 *
 * @param store — the provider instance's store
 * @param parts — `candidates[0].content.parts` of the response
 * @param toolCallIds — ids assigned to the response's tool calls, in order
 */
export const rememberFunctionCallSignatures = (
  store: ThoughtSignatureStore,
  parts: readonly SignedPart[] | undefined,
  toolCallIds: readonly string[],
): void => {
  if (parts === undefined) return;
  const callParts = parts.filter((p) => p.functionCall !== undefined);
  callParts.forEach((part, i) => {
    const id = toolCallIds[i];
    if (id !== undefined && typeof part.thoughtSignature === "string") store.remember(id, part.thoughtSignature);
  });
};

/**
 * Make sure a model content's function calls can be replayed: if none of its
 * function-call parts carries a signature, give the first one the placeholder.
 * Mutates the first function-call part in place.
 *
 * @param parts — parts of one model content
 */
export const ensureFunctionCallSignature = (parts: readonly object[]): void => {
  const calls = parts.filter(isCallPart);
  const first = calls[0];
  if (first === undefined || calls.some((p) => typeof p.thoughtSignature === "string")) return;
  first.thoughtSignature = GEMINI_PLACEHOLDER_SIGNATURE;
};

type CallPart = { functionCall: unknown; thoughtSignature?: string };
const isCallPart = (p: object): p is CallPart => "functionCall" in p;
