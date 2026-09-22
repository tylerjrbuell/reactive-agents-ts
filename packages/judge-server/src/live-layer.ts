// Live JudgeLLMService Layer for the judge-server.
//
// The judge-server's whole purpose (Rule 4 of 00-RESEARCH-DISCIPLINE.md) is to
// host a JUDGE provider stack that is code-path-isolated from the SUT's. The
// stub layer in `index.ts` is fine for handler/contract tests, but for
// production scoring we need a real provider connection.
//
// This Layer is intentionally thin: it composes `LLMService` from
// `@reactive-agents/llm-provider` (the standard provider stack) and adapts the
// resulting service to the `JudgeLLMService` Tag exported by
// `@reactive-agents/eval`. It is the natural seam between the eval frozen-judge
// abstraction and the concrete provider SDK calls.
//
// The Layer is lazy: nothing here instantiates the provider SDK or reads
// network/credentials until an Effect that depends on `JudgeLLMService` is
// actually run. That's why the Step 6 Layer-construction test does NOT need a
// real API key.

import { Layer, Effect } from "effect";
import { JudgeLLMService } from "@reactive-agents/eval";
import { LLMService } from "@reactive-agents/llm-provider";
import { createLLMProviderLayer } from "@reactive-agents/llm-provider";
import { JudgmentService, makeJevBackend, makeJudgmentServiceLive, withEvents } from "@reactive-agents/judgment";
import { EventBusLive } from "@reactive-agents/core";

export type JudgeProvider = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "groq" | "xai";

export interface LiveLayerConfig {
  /** Model identifier passed to the provider (e.g. "claude-haiku-4-5-20251001"). */
  readonly model: string;
  /** Provider key resolved from JUDGE_PROVIDER env. */
  readonly provider: JudgeProvider;
}

const PROVIDERS: readonly JudgeProvider[] = ["anthropic", "openai", "ollama", "gemini", "litellm", "groq", "xai"];

const isJudgeProvider = (value: string): value is JudgeProvider =>
  (PROVIDERS as readonly string[]).includes(value);

/**
 * Resolve the live-layer config from process.env with sensible defaults.
 * Used by the server entry point so callers don't have to reach into env directly.
 */
export const resolveLiveLayerConfig = (): LiveLayerConfig => {
  const rawProvider = process.env.JUDGE_PROVIDER ?? "anthropic";
  if (!isJudgeProvider(rawProvider)) {
    throw new Error(
      `JUDGE_PROVIDER="${rawProvider}" is not a recognized provider. ` +
        `Expected one of: ${PROVIDERS.join(", ")}.`,
    );
  }
  return {
    model: process.env.JUDGE_MODEL ?? "claude-haiku-4-5-20251001",
    provider: rawProvider,
  };
};

/**
 * Build the live JudgeLLMService Layer.
 *
 * Internally this constructs a standard LLM provider stack (via
 * `createLLMProviderLayer`) and then adapts it to the JudgeLLMService Tag.
 * The adapter is trivial: `JudgeLLMServiceShape.complete(req) === LLMService.complete(req)`
 * — both have the same `(CompletionRequest) => Effect<CompletionResponse, LLMErrors>`
 * signature today. The Tag separation is the load-bearing piece (Rule 4); the
 * code path is naturally distinct because the SUT and the judge live in
 * different processes.
 */
export const buildJudgeLayer = (config: LiveLayerConfig): Layer.Layer<JudgeLLMService> => {
  const providerLayer = createLLMProviderLayer(config.provider, undefined, config.model);
  const adapter = Layer.effect(
    JudgeLLMService,
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return JudgeLLMService.of({
        complete: (request) => llm.complete(request),
      });
    }),
  );
  return adapter.pipe(Layer.provide(providerLayer));
};

/**
 * Build the live `JudgmentService` Layer for `judgeEngine: "jev"` — reads
 * `TYPESAFE_API_KEY` (and optional `JEV_MODEL`/`TYPESAFE_BASE_URL`) from the
 * environment via the SDK's own resolution (see `makeJevBackend`).
 * `makeJevBackend` constructs the SDK client synchronously (and throws if
 * `TYPESAFE_API_KEY` is missing), so this is wrapped in `Layer.suspend` to
 * defer that construction until the layer is actually built — same
 * laziness guarantee as `buildJudgeLayer` above, and load-bearing: a server
 * started with `judgeEngine !== "jev"` must not crash on a missing
 * TypeSafe key it never needed.
 *
 * Decorated with `withEvents` so `JudgmentEvaluated`/`JudgmentFailed`
 * actually fire in production (code review, 2026-09-22 — the undecorated
 * version left those events documented but dead outside unit tests, since
 * no other composition root in the codebase wires `.withJudgment()` yet).
 * judge-server is a standalone process, so it gets its own self-contained
 * `EventBusLive` instance here — the returned Layer requires nothing
 * external, matching `buildJudgeLayer`'s `Layer.Layer<JudgeLLMService>`
 * (no leaked requirements) above.
 */
export const buildJudgmentLayer = (): Layer.Layer<JudgmentService> =>
  Layer.suspend(() =>
    withEvents("judge-server", "jev").pipe(
      Layer.provide(makeJudgmentServiceLive(makeJevBackend({ model: process.env.JEV_MODEL }))),
      Layer.provide(EventBusLive),
    ),
  );
