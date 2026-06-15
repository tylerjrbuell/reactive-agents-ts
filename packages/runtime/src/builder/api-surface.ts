/**
 * Public API surface helpers for ReactiveAgentBuilder (W26-B-2 step 1).
 *
 * Hoists two pieces out of builder.ts:
 *   - `fromConfig` / `fromJSON` factories used by the `ReactiveAgents` namespace
 *   - `invokeUserHookSafely` — internal helper used by `withHook` to surface
 *     escaped lifecycle-hook errors through the builder's `_errorHandler`.
 *
 * `ReactiveAgents.create` stays in builder.ts because it constructs the class
 * directly — keeping it inline avoids the dynamic-import dance and matches the
 * `new ReactiveAgentBuilder()` line's location next to the class definition.
 */
import type { ReactiveAgentBuilder } from "../builder.js";
import type { LifecycleHook, ExecutionContext } from "../types.js";
import type { RuntimeErrors } from "../errors.js";
import { runHookResultForSideEffect } from "../hooks-normalize.js";

/**
 * Reconstruct a builder from an AgentConfig object.
 *
 * The returned builder is fully configured and can be further customized
 * with additional builder methods before calling `.build()`.
 */
export const reactiveAgentsFromConfig = async (
  config: import("../agent-config.js").AgentConfig,
): Promise<ReactiveAgentBuilder> => {
  const { agentConfigToBuilder } = await import("../agent-config.js");
  return agentConfigToBuilder(config);
};

/**
 * Reconstruct a builder from a JSON string containing an AgentConfig.
 * Parses and validates the JSON before reconstructing the builder.
 * Throws a ParseError if the JSON is invalid.
 */
export const reactiveAgentsFromJSON = async (
  json: string,
): Promise<ReactiveAgentBuilder> => {
  const { agentConfigFromJSON, agentConfigToBuilder } = await import(
    "../agent-config.js"
  );
  const config = agentConfigFromJSON(json);
  return agentConfigToBuilder(config);
};

/**
 * Run a user lifecycle hook and route any escaping error to the builder's
 * `_errorHandler` (when set) or `console.warn` (fallback). Resolves HS-14 (#74):
 * hook errors are no longer silently discarded.
 */
export async function invokeUserHookSafely(
  self: ReactiveAgentBuilder,
  hook: LifecycleHook,
  ctx: { phase: string; iteration: number },
): Promise<void> {
  const surface = (err: unknown): void => {
    const handler = (
      self as unknown as {
        _errorHandler?: (
          e: RuntimeErrors | Error,
          c: {
            taskId: string;
            phase: string;
            iteration: number;
            lastStep?: string;
          },
        ) => void;
      }
    )._errorHandler;
    const normalized = err instanceof Error ? err : new Error(String(err));
    if (handler) {
      try {
        handler(normalized, {
          taskId: "",
          phase: ctx.phase,
          iteration: ctx.iteration,
        });
      } catch {
        // Handler-of-handler crash: swallow to avoid recursion; preserve original via console.warn
        console.warn(
          "[reactive-agents] error handler crashed while reporting lifecycle hook failure:",
          normalized,
        );
      }
      return;
    }
    console.warn(
      "[reactive-agents] lifecycle hook threw (no errorHandler registered):",
      normalized,
    );
  };
  let result: unknown;
  try {
    result = hook.handler({
      phase: ctx.phase,
      iteration: ctx.iteration,
    } as ExecutionContext);
  } catch (err) {
    surface(err);
    return;
  }
  try {
    await runHookResultForSideEffect(result as Parameters<typeof runHookResultForSideEffect>[0]);
  } catch (err) {
    surface(err);
  }
}
