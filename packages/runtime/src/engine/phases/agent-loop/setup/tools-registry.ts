/**
 * Tool registry setup for the agent loop:
 *   1. Single fetch of tool definitions from `ToolService` (cached for the
 *      whole run — used by classifier, kernel-call, and tool-dispatch)
 *   2. Warn on `allowedTools` names that don't match any registered tool
 *   3. Log strategy-select summary (filtered to capability tools only,
 *      hiding framework infrastructure)
 *
 * Acquires `ToolService` lazily; falls back to empty registry if absent.
 *
 * Extracted from `execution-engine.ts:957-997` (W23 step 4).
 */
import { Effect, Context } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { ToolService } from "@reactive-agents/tools";
import type { ReactiveAgentsConfig, ExecutionContext } from "../../../../types.js";
import type { ObsLike } from "../../../runtime-context.js";
import { checkAllowedToolsMismatch } from "../../../util.js";

/**
 * Tool names whose presence in the registry should NOT appear in the
 * strategy-select log (framework infrastructure, not capability tools).
 */
const FRAMEWORK_TOOL_NAMES = new Set<string>([
  "final-answer",
  "task-complete",
  "context-status",
  "brief",
  "pulse",
  "find",
  "recall",
  "activate-skill",
  "get-skill-section",
  "context-task",
]);

/**
 * Fetch tool defs once per run + emit allowedTools-mismatch warning + log
 * strategy summary.
 *
 * Returns the cached tool defs (typed as readonly any[] to match the
 * loose schema used by the classifier and tool dispatch). Side effects:
 *   - obs.info() warning on allowedTools mismatch (when present)
 *   - obs.info() strategy summary line
 */
export const fetchToolsRegistry = (
  config: ReactiveAgentsConfig,
  ctx: ExecutionContext,
  obs: ObsLike | null,
  isNormal: boolean,
): Effect.Effect<readonly any[], never> =>
  Effect.gen(function* () {
    const cachedToolDefs = yield* Effect.serviceOption(ToolService).pipe(
      Effect.flatMap((opt) =>
        opt._tag === "Some"
          ? (opt.value.listTools() as Effect.Effect<readonly any[], never>)
          : Effect.succeed([] as readonly any[]),
      ),
      Effect.catchAll(() => Effect.succeed([] as readonly any[])),
    );

    // Warn on allowedTools mismatch — exclude framework meta-tools (always available inline)
    const effectiveAllowedTools = config.allowedTools ?? [];
    if (effectiveAllowedTools.length > 0) {
      const mismatches = checkAllowedToolsMismatch(effectiveAllowedTools, cachedToolDefs)
        .filter((name) => !FRAMEWORK_TOOL_NAMES.has(name));
      if (mismatches.length > 0 && obs && isNormal) {
        yield* obs
          .info(
            `[allowedTools] These tools are in allowedTools but not registered in ToolService: ${mismatches.join(", ")}. ` +
              `Registered tools: ${cachedToolDefs.map((t: any) => t.name).join(", ")}. ` +
              `Note: framework tools (final-answer, recall, brief, etc.) are always available inline.`,
          )
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "runtime/src/engine/phases/agent-loop/setup/tools-registry.ts:allowedTools-warn",
                tag: errorTag(err),
              }),
            ),
          );
      }
    }

    // Log strategy-select summary (capability tools only, hides framework)
    if (obs && isNormal) {
      const toolNames = cachedToolDefs
        .map((t: any) => t.name as string)
        .filter((n) => !FRAMEWORK_TOOL_NAMES.has(n))
        .join(", ");
      const toolsInfo = toolNames ? ` | tools: ${toolNames}` : "";
      yield* obs
        .info(`◉ [strategy]   ${ctx.selectedStrategy ?? "reactive"}${toolsInfo}`)
        .pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({
              site: "runtime/src/engine/phases/agent-loop/setup/tools-registry.ts:strategy-summary",
              tag: errorTag(err),
            }),
          ),
        );
    }

    return cachedToolDefs;
  });
