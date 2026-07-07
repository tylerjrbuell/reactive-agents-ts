/**
 * Reasoning-path tool schema preparation.
 *
 * Composes 4 schema transforms in order:
 *   1. Built-ins opt-in filter — built-in tools are unconditionally registered
 *      in ToolServiceLive (so `discover-tools` can surface them) but are
 *      removed from the base prompt schema unless the consumer explicitly
 *      opts in via `config.builtins`. allowedTools/requiredTools always pass.
 *   2. Dynamic final-answer description — multi-signal composition over
 *      regex-classified output format + ModelCalibration fields. Only ADDS
 *      guidance to the static base; never strips it.
 *   3. allowedTools prompt filter (IC-6) — when allowedTools is specified,
 *      restrict the prompt schema to that allowlist (full set retained for
 *      the completion guard via allToolSchemas elsewhere).
 *   4. Adaptive tool filter — when classification has produced relevant tools
 *      use those; otherwise heuristic keyword matching. Only applied when
 *      schemas exceed 10 tools and the filter actually reduces the set.
 *      ALWAYS_INCLUDE conductor tools and required tools regardless.
 *
 * Extracted from `execution-engine.ts:960-1071` (W23 step 6a-6) to shrink
 * the engine module without changing behavior.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import {
  BUILTIN_TOOL_NAMES,
  buildFinalAnswerDescription,
  buildFinalAnswerOutputDescription,
} from "@reactive-agents/tools";
import { extractOutputFormat, filterToolsByRelevance } from "@reactive-agents/reasoning";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { ReactiveAgentsConfig } from "../../../../types.js";
import type { ObsLike } from "../../../runtime-context.js";
import { extractTaskText } from "../../../util.js";

export type ToolSchema = {
  name: string;
  description: string;
  parameters: { name: string; type: string; description: string; required: boolean }[];
};

export interface PrepareToolSchemasArgs {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly availableToolSchemas: readonly ToolSchema[];
  readonly availableToolNames: readonly string[];
  readonly effectiveAllowedTools: readonly string[];
  readonly effectiveFocusedTools: readonly string[];
  readonly effectiveRequiredTools: readonly string[] | undefined;
  readonly classifiedRelevantTools: readonly string[] | undefined;
  readonly resolvedCalibration: ModelCalibration | undefined;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
}

export interface PreparedToolSchemas {
  readonly availableToolSchemas: ToolSchema[];
  readonly availableToolNames: string[];
}

export const prepareReasoningToolSchemas = (
  args: PrepareToolSchemasArgs,
): Effect.Effect<PreparedToolSchemas, never> => {
  const {
    config,
    task,
    availableToolSchemas: initialSchemas,
    availableToolNames: initialNames,
    effectiveAllowedTools,
    effectiveFocusedTools,
    effectiveRequiredTools,
    classifiedRelevantTools,
    resolvedCalibration,
    obs,
    isNormal,
  } = args;
  return Effect.gen(function* () {
    let availableToolSchemas: ToolSchema[] = [...initialSchemas];
    let availableToolNames: string[] = [...initialNames];

    // ── Built-ins opt-in (2026-05-06) ──
    // Built-in tools (file-write, web-search, code-execute, etc.) are
    // registered unconditionally in ToolServiceLive so `discover-tools`
    // can surface them at runtime, but should NOT appear in the base
    // LLM schema unless the consumer explicitly opts in. Without this
    // filter, the relevance classifier promotes built-ins like
    // file-write on tasks like "write a markdown report" — leading to
    // gratuitous filesystem writes and the model returning file paths
    // as final answers. Required + relevant + meta-tools are unaffected.
    const builtinsOpt = config.builtins;
    const optedInBuiltins = new Set<string>();
    if (builtinsOpt === true) {
      // Opt-in to all built-ins (legacy behavior).
      for (const name of BUILTIN_TOOL_NAMES) optedInBuiltins.add(name);
    } else if (Array.isArray(builtinsOpt)) {
      for (const name of builtinsOpt) optedInBuiltins.add(name);
    }
    // Always honor explicit allowedTools / requiredTools — those are
    // the consumer's intent regardless of the builtins opt-in default.
    for (const name of effectiveAllowedTools) optedInBuiltins.add(name);
    for (const name of effectiveRequiredTools ?? []) optedInBuiltins.add(name);
    if (builtinsOpt !== true) {
      availableToolSchemas = availableToolSchemas.filter((ts) =>
        !BUILTIN_TOOL_NAMES.has(ts.name) || optedInBuiltins.has(ts.name),
      );
      availableToolNames = availableToolSchemas.map((t) => t.name);
    }

    // ── Dynamic final-answer description (Path C(d), 2026-05-07) ──
    // Multi-signal composition: regex-classified output format
    // (task signal) + ModelCalibration fields (model signal).
    // The builder only ADDS guidance; it never strips the
    // empirically-validated static base. See spec
    // wiki/Architecture/Design-Specs/2026-05-06-intelligent-default-builders.md
    // for the full pattern.
    const taskTextForIntent = extractTaskText(task.input);
    const finalAnswerCtx = {
      outputFormat: extractOutputFormat(taskTextForIntent).format,
      hasRequiredTools: (effectiveRequiredTools?.length ?? 0) > 0,
      systemPromptAttention: resolvedCalibration?.systemPromptAttention,
      observationHandling: resolvedCalibration?.observationHandling,
      toolCallDialect: resolvedCalibration?.toolCallDialect,
    };
    const dynamicFinalAnswerDescription = buildFinalAnswerDescription(finalAnswerCtx);
    const dynamicFinalAnswerOutputDesc = buildFinalAnswerOutputDescription(finalAnswerCtx);
    availableToolSchemas = availableToolSchemas.map((ts) => {
      if (ts.name !== "final-answer") return ts;
      return {
        ...ts,
        description: dynamicFinalAnswerDescription,
        parameters: ts.parameters.map((p: typeof ts.parameters[number]) =>
          p.name === "output"
            ? { ...p, description: dynamicFinalAnswerOutputDesc }
            : p,
        ),
      };
    });

    // ── Prompt visibility filter ──
    // Priority: focusedTools (soft guidance) → allowedTools (hard restriction) → all tools.
    // focusedTools: show only these in prompt, execution of other tools is NOT blocked.
    // allowedTools: show only these in prompt AND block execution of non-listed tools.
    if (effectiveFocusedTools.length > 0) {
      availableToolSchemas = availableToolSchemas.filter(ts =>
        effectiveFocusedTools.includes(ts.name)
      );
    } else if (effectiveAllowedTools.length > 0) {
      availableToolSchemas = availableToolSchemas.filter(ts =>
        effectiveAllowedTools.includes(ts.name)
      );
    }

    // ── Adaptive tool filtering ──
    // When LLM classification produced relevant tools, use those.
    // Otherwise fall back to heuristic filtering.
    // All tools remain callable by name — filtering only affects what's
    // shown in the prompt to reduce context noise.
    if (config.adaptiveToolFiltering && availableToolSchemas.length > 10) {
      // Always include conductor tools and spawn-agent regardless of relevance filtering
      const ALWAYS_INCLUDE = new Set([
        "recall", "find", "brief", "pulse", "todo",
        "spawn-agent",
      ]);

      const requiredSet = new Set(effectiveRequiredTools ?? []);
      let filteredSet: Set<string>;

      if (classifiedRelevantTools && classifiedRelevantTools.length > 0) {
        // LLM-classified: use required + relevant from classification
        filteredSet = new Set([...classifiedRelevantTools, ...requiredSet]);
      } else {
        // Fallback: heuristic keyword matching
        const taskTextForFilter = extractTaskText(task.input);
        const { primary } = filterToolsByRelevance(taskTextForFilter, availableToolSchemas);
        filteredSet = new Set(primary.map((t: { name: string }) => t.name));
      }
      for (const name of ALWAYS_INCLUDE) filteredSet.add(name);
      for (const name of requiredSet) filteredSet.add(name);

      // Filter schemas to only those in the filtered set
      const filtered = availableToolSchemas.filter(t => filteredSet.has(t.name));

      // Only apply filtering if it actually reduces the set meaningfully
      if (filtered.length < availableToolSchemas.length && filtered.length >= 2) {
        const hiddenCount = availableToolSchemas.length - filtered.length;
        availableToolSchemas = filtered;
        availableToolNames = filtered.map(t => t.name);
        if (obs && isNormal) {
          yield* obs.info(`◉ [adaptive-tools] showing ${filtered.length} of ${filtered.length + hiddenCount} tools (${hiddenCount} hidden)`)
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/setup/tool-schemas.ts:log-adaptive-filter", tag: errorTag(err) })));
        }
      }
    }

    // ── Forbidden-tool exclusion (TaskContract, realization-plan P2b) ──
    // A `.withContract({ tools: [{ kind: "forbidden", name }] })` declares
    // names that "MUST NOT be visible to the LLM" (task-contract.ts:33-34).
    // Applied LAST so it wins over the adaptive block's required/ALWAYS_INCLUDE
    // re-additions above, and runs AFTER MCP/discover-tools discovery (the
    // input schemas are the post-discovery registry snapshot) — so discovered
    // forbidden tools are excluded too. Filters BOTH the prompt-visible schemas
    // and the surfaced name set. This is the live consumer of the contract's
    // forbidden list (§4.4 — no dead field).
    const forbidden = config.forbiddenTools;
    if (forbidden && forbidden.length > 0) {
      const forbiddenSet = new Set(forbidden);
      availableToolSchemas = availableToolSchemas.filter((ts) => !forbiddenSet.has(ts.name));
      availableToolNames = availableToolNames.filter((n) => !forbiddenSet.has(n));
    }

    return { availableToolSchemas, availableToolNames };
  });
};
