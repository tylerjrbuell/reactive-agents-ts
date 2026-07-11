/**
 * `createAgent(config)` — the declarative front door of the dual API.
 *
 * The third projection of the single source of truth (`AgentConfigSchema`,
 * `agent-config.ts`). It is thin BY CONSTRUCTION — validate + `fromConfig` +
 * `build()` — and adds zero mapping logic: it reuses the exact round-trip the
 * drift-gate (`config-serialization-drift.test.ts`) already guards, so anything
 * expressible in the fluent builder is expressible here and vice-versa.
 *
 *   createAgent(cfg)  ≡  ReactiveAgents.fromConfig(cfg).then(b => b.build())
 *
 * Design contract (spec §0 DP1/DP6/DP7):
 * - DP1 first-5-minutes: `createAgent({ name, provider, model, tools })` returns
 *   a running agent on sensible defaults; nothing else is required.
 * - DP6 errors that teach: unknown/invalid keys are rejected LOUDLY at call time
 *   (Effect structs are exact) with the offending path named, and the same
 *   `build()` guards (durable/approval/etc.) that the fluent surface hits fire
 *   here too because `createAgent` calls `build()`.
 * - DP7 symmetry: `createAgent({ tools: { allowedTools } })` ≡
 *   `.withTools({ allowedTools })` — identical key, identical result.
 */
import { Schema } from "effect";
import { AgentConfigSchema, agentConfigToBuilder, type AgentConfig } from "./agent-config.js";
import type { ReactiveAgent } from "./reactive-agent.js";

/**
 * Build a fully-configured agent from a declarative {@link AgentConfig}.
 *
 * @typeParam TOut - Output type of `result.object`. Declarative config cannot
 *   carry a schema object (schemas are not JSON), so the declarative path yields
 *   `string` output by default; use the fluent `.withOutputSchema<T>()` for
 *   typed extraction.
 * @param config - A plain `AgentConfig`. Validated against `AgentConfigSchema`
 *   before use — unknown or malformed keys throw with the path named.
 * @returns The same `ReactiveAgent` the fluent builder produces.
 *
 * @example
 * ```typescript
 * const agent = await createAgent({
 *   name: "researcher",
 *   provider: "anthropic",
 *   model: "claude-opus-4-8",
 *   profile: "balanced",
 *   tools: { allowedTools: ["web-search", "file-write"] },
 * });
 * const result = await agent.run("Summarize the latest on X");
 * ```
 */
export async function createAgent<TOut = string>(
  config: AgentConfig,
): Promise<ReactiveAgent<TOut>> {
  let validated: AgentConfig;
  try {
    // Exact-struct decode: unknown keys are rejected, the offending path named
    // (builder-never-lies, spec §5.2b/§5.5). Effect strips excess properties by
    // DEFAULT (onExcessProperty: "ignore"), which would silently swallow a
    // typo'd key — so we force "error" to make the declarative surface loud.
    // `errors: "all"` reports every bad key at once instead of stopping at the
    // first.
    validated = Schema.decodeUnknownSync(AgentConfigSchema)(config, {
      errors: "all",
      onExcessProperty: "error",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `createAgent: invalid config.\n${detail}\n` +
        "Every key must match AgentConfigSchema (unknown keys are rejected). " +
        "See the generated reference at " +
        "apps/docs/src/content/docs/reference/configuration.md.",
    );
  }

  const builder = await agentConfigToBuilder(validated);
  // The declarative path is always string-typed output (no schema object in
  // config); the generic default reflects that. The builder is `unknown`-typed
  // internally, so re-project it to the caller's `TOut`.
  return (await builder.build()) as unknown as ReactiveAgent<TOut>;
}
