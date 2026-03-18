/**
 * Lightweight agent composition API.
 *
 * Provides functional primitives for building agent pipelines:
 * - `agentFn()` — lazy-building callable agent primitive
 * - `pipe()` — sequential composition (output → next input)
 * - `parallel()` — concurrent composition (all results merged)
 * - `race()` — first-to-complete wins
 */
import type { AgentConfig } from "./agent-config.js";
import type { AgentResult } from "./builder.js";
import type { ReactiveAgentBuilder } from "./builder.js";

// ─── AgentFn Type ─────────────────────────────────────────────────────────────

/**
 * A callable agent function that accepts a string input and returns an AgentResult.
 *
 * Agents are built lazily on first call. Use `dispose()` to release resources.
 * The `config` property exposes the underlying AgentConfig for introspection.
 *
 * @example
 * ```typescript
 * const fn = agentFn(
 *   { name: "researcher", provider: "anthropic" },
 *   (b) => b.withReasoning().withTools(),
 * );
 * const result = await fn("What is the capital of France?");
 * await fn.dispose();
 * ```
 */
export type AgentFn = ((input: string) => Promise<AgentResult>) & {
  /** Release all resources held by the underlying agent. */
  dispose: () => Promise<void>;
  /** The AgentConfig used to construct this function. */
  config: AgentConfig;
};

// ─── agentFn() ────────────────────────────────────────────────────────────────

/**
 * Create a lazy-building AgentFn from an AgentConfig.
 *
 * The underlying agent is built on first invocation. Subsequent calls reuse
 * the same agent instance. Call `dispose()` to release resources when done.
 *
 * @param config - Required fields (`name`, `provider`) plus any optional AgentConfig fields.
 * @param customize - Optional callback to further configure the builder before `.build()`.
 * @returns An AgentFn callable with `.dispose()` and `.config` properties.
 *
 * @example
 * ```typescript
 * const fn = agentFn(
 *   { name: "analyst", provider: "anthropic" },
 *   (b) => b.withReasoning().withTools(),
 * );
 * const result = await fn("Analyze this data");
 * await fn.dispose();
 * ```
 */
export function agentFn(
  config: Partial<AgentConfig> & Pick<AgentConfig, "name" | "provider">,
  customize?: (builder: ReactiveAgentBuilder) => ReactiveAgentBuilder,
): AgentFn {
  let agent: {
    run: (input: string) => Promise<AgentResult>;
    dispose: () => Promise<void>;
  } | null = null;

  const fullConfig = { ...config } as AgentConfig;

  const fn = async (input: string): Promise<AgentResult> => {
    if (!agent) {
      const { agentConfigToBuilder } = await import("./agent-config.js");
      let builder = await agentConfigToBuilder(fullConfig);
      if (customize) builder = customize(builder);
      agent = await builder.build();
    }
    return agent.run(input);
  };

  fn.dispose = async () => {
    if (agent) {
      await agent.dispose();
      agent = null;
    }
  };

  fn.config = fullConfig;

  return fn as AgentFn;
}

// ─── pipe() ───────────────────────────────────────────────────────────────────

/**
 * Compose multiple AgentFns sequentially.
 *
 * Each agent receives the output of the previous agent as its input.
 * The result of the final agent is returned, enriched with composition metadata.
 *
 * @param fns - One or more AgentFns to chain in order.
 * @returns A new AgentFn that runs all agents in sequence.
 *
 * @example
 * ```typescript
 * const pipeline = pipe(extractor, summarizer, formatter);
 * const result = await pipeline("raw input");
 * // result.output is the formatted summary
 * await pipeline.dispose();
 * ```
 */
export function pipe(...fns: AgentFn[]): AgentFn {
  if (fns.length === 0) throw new Error("pipe requires at least one AgentFn");

  const composedName = `pipe(${fns.map((f) => f.config.name).join(", ")})`;

  const fn = async (input: string): Promise<AgentResult> => {
    let current = input;
    let lastResult: AgentResult | null = null;

    for (const agFn of fns) {
      lastResult = await agFn(current);
      current = lastResult.output;
    }

    return {
      ...lastResult!,
      agentId: composedName,
      metadata: {
        ...lastResult!.metadata,
        compositionType: "pipe",
        stages: fns.length,
      } as AgentResult["metadata"] & Record<string, unknown>,
    };
  };

  fn.dispose = async () => {
    await Promise.allSettled(fns.map((f) => f.dispose()));
  };

  fn.config = {
    name: composedName,
    provider: fns[0].config.provider,
  } as AgentConfig;

  return fn as AgentFn;
}

// ─── parallel() ───────────────────────────────────────────────────────────────

/**
 * Compose multiple AgentFns to run concurrently on the same input.
 *
 * All agents receive the same input simultaneously. Their outputs are merged
 * into a single string formatted as `[agent-name]: output\n\n[agent-name]: output`.
 * The result is successful only if all agents succeed.
 *
 * @param fns - One or more AgentFns to run in parallel.
 * @returns A new AgentFn that runs all agents concurrently and merges results.
 *
 * @example
 * ```typescript
 * const combined = parallel(sentimentAgent, keywordsAgent, summaryAgent);
 * const result = await combined("article text here");
 * // result.metadata.results contains individual agent outputs
 * await combined.dispose();
 * ```
 */
export function parallel(...fns: AgentFn[]): AgentFn {
  if (fns.length === 0)
    throw new Error("parallel requires at least one AgentFn");

  const composedName = `parallel(${fns.map((f) => f.config.name).join(", ")})`;

  const fn = async (input: string): Promise<AgentResult> => {
    const results = await Promise.all(fns.map((f) => f(input)));

    const output = results
      .map((r, i) => `[${fns[i].config.name}]: ${r.output}`)
      .join("\n\n");

    return {
      output,
      success: results.every((r) => r.success),
      taskId: results[0]?.taskId ?? "",
      agentId: composedName,
      metadata: {
        duration: Math.max(...results.map((r) => r.metadata.duration)),
        cost: results.reduce((sum, r) => sum + r.metadata.cost, 0),
        tokensUsed: results.reduce((sum, r) => sum + r.metadata.tokensUsed, 0),
        stepsCount: results.reduce((sum, r) => sum + r.metadata.stepsCount, 0),
        compositionType: "parallel",
        results: results.map((r, i) => ({
          name: fns[i].config.name,
          output: r.output,
          success: r.success,
          agentId: r.agentId,
        })),
      } as AgentResult["metadata"] & Record<string, unknown>,
    };
  };

  fn.dispose = async () => {
    await Promise.allSettled(fns.map((f) => f.dispose()));
  };

  fn.config = {
    name: composedName,
    provider: fns[0].config.provider,
  } as AgentConfig;

  return fn as AgentFn;
}

// ─── race() ───────────────────────────────────────────────────────────────────

/**
 * Compose multiple AgentFns as a race — first to complete wins.
 *
 * All agents start concurrently. The result of whichever finishes first is
 * returned. Losing agents continue running in the background — their results
 * are discarded but they still consume tokens/compute. Call `dispose()` to
 * clean up all agents. Future: AbortController support for canceling losers.
 *
 * @param fns - One or more AgentFns to race against each other.
 * @returns A new AgentFn that returns the first result to complete.
 *
 * @example
 * ```typescript
 * const fastest = race(claudeAgent, gptAgent, geminiAgent);
 * const result = await fastest("answer this quickly");
 * await fastest.dispose();
 * ```
 */
export function race(...fns: AgentFn[]): AgentFn {
  if (fns.length === 0) throw new Error("race requires at least one AgentFn");

  const composedName = `race(${fns.map((f) => f.config.name).join(", ")})`;

  const fn = async (input: string): Promise<AgentResult> => {
    const result = await Promise.race(fns.map((f) => f(input)));
    return {
      ...result,
      metadata: {
        ...result.metadata,
        compositionType: "race",
        candidates: fns.length,
      } as AgentResult["metadata"] & Record<string, unknown>,
    };
  };

  fn.dispose = async () => {
    await Promise.allSettled(fns.map((f) => f.dispose()));
  };

  fn.config = {
    name: composedName,
    provider: fns[0].config.provider,
  } as AgentConfig;

  return fn as AgentFn;
}
