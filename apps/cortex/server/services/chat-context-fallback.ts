import { resolveCapability } from "@reactive-agents/llm-provider";
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { contextLevel } from "@reactive-agents/ui-core";

type ContextPressureEvent = Extract<AgentStreamEvent, { _tag: "ContextPressure" }>;

/**
 * Context-window reading for providers that never report one on the stream.
 *
 * The framework emits `ContextPressure` only when the provider surfaces the exact
 * window it used (`resolvedParams.contextWindow`, set by Ollama alone), so a hosted
 * model (OpenAI, Anthropic, Gemini) streams tokens and cost but no reading and the
 * chat meter says "no reading yet". When a call reports its prompt tokens and the
 * framework capability for that (provider, model) is a real row (never the
 * conservative `fallback`, which would show a made-up window), this derives the same
 * event from them. A real `ContextPressure` on the stream always wins: once one is
 * seen, nothing more is synthesized.
 */
export interface ContextFallback {
  /** Feed every stream event; returns a derived `ContextPressure` to emit after this one, if any. */
  readonly observe: (event: AgentStreamEvent) => ContextPressureEvent | undefined;
}

/** Window of a model from the framework capability table, or undefined when it is only the fallback. */
export function knownWindowTokens(provider: string, model: string): number | undefined {
  const cap = resolveCapability(provider, model);
  return cap.source === "fallback" || cap.maxContextTokens <= 0 ? undefined : cap.maxContextTokens;
}

/** Pass a turn's stream through, adding the derived `ContextPressure` right after the call that reported its prompt tokens. */
export async function* withDerivedContext(source: AsyncIterable<AgentStreamEvent>): AsyncGenerator<AgentStreamEvent> {
  const fallback = makeContextFallback();
  for await (const event of source) {
    yield event;
    const derived = fallback.observe(event);
    if (derived) yield derived;
  }
}

/** One per turn: tracks whether the stream carried its own reading. */
export function makeContextFallback(windowOf: (provider: string, model: string) => number | undefined = knownWindowTokens): ContextFallback {
  let sawReal = false;
  return {
    observe(event) {
      if (event._tag === "ContextPressure") {
        sawReal = true;
        return undefined;
      }
      if (sawReal || event._tag !== "TokenUsage") return undefined;
      const used = event.tokensIn;
      if (typeof used !== "number" || used <= 0) return undefined;
      const window = windowOf(event.provider, event.model);
      if (window === undefined || window <= 0) return undefined;
      const utilizationPct = Math.round((used / window) * 100);
      return {
        _tag: "ContextPressure",
        tokensUsed: used,
        tokensAvailable: Math.max(0, window - used),
        utilizationPct,
        level: contextLevel(utilizationPct),
      };
    },
  };
}
