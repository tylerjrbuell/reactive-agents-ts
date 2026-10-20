/**
 * Think phase — tool-surface & guidance resolution stage.
 *
 * `handleThinking`'s first stage, moved verbatim from `think.ts` (#219 /
 * HS-249 decomposition). Covers the harness-config binding, dynamic
 * meta-tool injection (final-answer / abstain / request_user_input), the
 * context-pressure hard gate, tool-surface resolution (classification
 * pruning, lazy disclosure, required-tools gate narrowing, the W-Q
 * intervention inputs), and harness skill injection into the effective
 * system prompt. The canonical provider-request assembly itself stays in
 * `think.ts` (grandfathered projector consumer — see
 * `scripts/check-projection.sh`); this stage supplies its inputs.
 */
import { Effect, Ref } from "effect";
import { discoveredToolsStoreRef } from "@reactive-agents/tools";
import { resolveToolSurface } from "./tool-surface.js";
import { forbiddenTools } from "../../contract/run-contract.js";
import { finalAnswerTool, shouldShowFinalAnswer, requestUserInputTool } from "@reactive-agents/tools";
import { getMissingRequiredToolsFromSteps } from "../verify/requirement-state.js";
import { transitionState, asKernelStateLike, type KernelState, type KernelContext } from "../../../kernel/state/kernel-state.js";
import { shouldNarrowToFinalAnswerOnly } from "./context-pressure.js";
import { ABSTAIN_TOOL_NAME } from "../act/meta-tool-handlers.js";
import { shouldOfferAbstain } from "./abstain-gate.js";
import { resolveHarnessConfig } from "../../../harness-config.js";
import type { ToolSchema } from "../attend/tool-formatting.js";

/** Explicit param surface for {@link resolveThinkToolSurface}. */
export interface ResolveThinkSurfaceParams {
  readonly state: KernelState
  readonly context: KernelContext
}

/**
 * Resolve the per-iteration tool surface + harness skill prompt supply.
 * Returns the (guidance-uncleared) state plus every derived local the
 * canonical request core in `think.ts` and the downstream stages consume.
 */
export function resolveThinkToolSurface(params: ResolveThinkSurfaceParams) {
  return Effect.gen(function* () {
    let { state } = params;
    const { context } = params;
    const { input, profile } = context;
    // Prologue local (orig think.ts:339) — consumed by the harnessPipeline
    // transforms below and re-derived by the request core in think.ts.
    const strategy = state.strategy;
    // Carried harness config (Task 3) — the ONLY source for the mechanism
    // switches below. Falls back to env/default resolution when this pass
    // was constructed without an envelope (see harness-control-surface plan).
    const h = input.harness ?? resolveHarnessConfig();

    const maxIter = (state.meta.maxIterations as number) ?? 10;

    // ── Dynamic meta-tool injection (final-answer) ───────────────────────────
    // When all required tools have been called and the agent is ready to complete,
    // inject the final-answer tool into the available tool schemas so the LLM
    // can discover and use it as the preferred termination mechanism.
    const hasNonMetaToolCalledForThink = [...state.toolsUsed].some(
      (t) => t !== "final-answer" && t !== "task-complete" && t !== "context-status" && t !== "brief" && t !== "pulse" && t !== "find" && t !== "recall",
    );
    // When no required tools are specified, scratchpad usage alone satisfies the
    // "has done real work" condition — matches the hard gate logic at line ~680.
    const hasAnyToolWork = hasNonMetaToolCalledForThink
      || ((input.requiredTools ?? []).length === 0 && state.toolsUsed.size > 0);
    const hasErrorsForThink = state.steps.some(
      (s) => s.type === "observation" && s.metadata?.observationResult?.success === false,
    );
    const finalAnswerVisible = shouldShowFinalAnswer({
      requiredToolsCalled: state.toolsUsed,
      requiredTools: [...(input.requiredTools ?? [])],
      iteration: state.iteration,
      hasErrors: hasErrorsForThink,
      hasNonMetaToolCalled: hasAnyToolWork,
    });

    // O3: abstain tool schema — offered only when metaTools.abstain === true.
    // Do NOT offer at iteration 0; the model should attempt the task first.
    const abstainToolSchema: ToolSchema = {
      name: ABSTAIN_TOOL_NAME,
      description:
        "Decline to answer when you cannot ground a response in available evidence or a " +
        "required tool/input is unavailable. State the reason and what was missing. " +
        "Do NOT use this to skip work you can still attempt.",
      parameters: [
        { name: "reason", type: "string", description: "Why you cannot answer", required: true },
        {
          name: "missing",
          type: "array",
          description: "Tool names or inputs that were needed but unavailable (e.g. 'tool:web-search')",
          required: false,
          items: { type: "string" },
        },
      ],
    };

    const augmentedToolSchemas: readonly ToolSchema[] = [
      ...(input.availableToolSchemas ?? []),
      ...(finalAnswerVisible ? [{ name: finalAnswerTool.name, description: finalAnswerTool.description, parameters: finalAnswerTool.parameters }] : []),
      ...(shouldOfferAbstain({
        enabled: input.metaTools?.abstain === true,
        iteration: state.iteration,
        requiredToolUnavailable: false,
        toolsAttempted: state.toolsUsed.size,
      }) ? [abstainToolSchema] : []),
      // Agentic-UI (Task 9): offer request_user_input whenever
      // metaTools.userInteraction === true. Unlike abstain there is NO
      // iteration gate — the model may ask for human input on iteration 0.
      ...(input.metaTools?.userInteraction === true
        ? [{ name: requestUserInputTool.name, description: requestUserInputTool.description, parameters: requestUserInputTool.parameters }]
        : []),
    ] as readonly ToolSchema[];

    // ── Context pressure hard gate ───────────────────────────────────────────
    // When token budget is exhausted beyond the tier-specific threshold, the
    // model has nothing useful to reason with. Narrow available tools to only
    // final-answer so the model's next action is a clean exit.
    //
    // Important: never narrow while required tools are still pending — doing so
    // hides the very tools the harness is demanding, creating an unsatisfiable
    // state (model sees only `final-answer` but is told it must call `web-search`).
    const missingRequiredForPressure = getMissingRequiredToolsFromSteps(
      state.steps,
      input.requiredTools ?? [],
      input.requiredToolQuantities,
    );
    const pressureCritical =
      missingRequiredForPressure.length === 0 &&
      shouldNarrowToFinalAnswerOnly({
        estimatedTokens: state.tokens,
        maxTokens: profile.maxTokens ?? Number.MAX_SAFE_INTEGER,
        tier: profile.tier,
      });

    // When lazy mode is active (default) the disclosure filter owns visibility
    // (the visible set already includes state.toolsUsed so the model can
    // re-invoke tools it's already used). Pressure-narrowing-to-final-answer-
    // only induces panic dumps on local models when fired prematurely, so the
    // resolver applies it only on the non-lazy arm.
    const lazyMode = h.lazyDisclosure;

    // ── Tool surface resolution (Overhaul Phase 2) ───────────────────────────
    // One resolver computes the entire per-iteration surface — classification
    // pruning (attention-load reduction: e.g. 38 GitHub MCP tools → 3, only
    // when the set is > 15 since small-set classifier output is incomplete),
    // RA_LAZY_TOOLS per-iteration disclosure (default-on since 2026-04-26,
    // visible = required + relevant + used + discovered + meta; the rest is
    // reachable via discover-tools), and the required-tools gate FC narrowing
    // — plus a per-tool reason map surfaced as the `tool-surface-resolved`
    // trace event. See tool-surface.ts for the invariants.
    const PRUNE_MIN_TOOLS = 15;
    const classifiedRequired = input.requiredTools ?? [];
    const classifiedRelevant = input.relevantTools ?? [];
    const hasClassification = classifiedRequired.length > 0 || classifiedRelevant.length > 0;
    const discovered = yield* Ref.get(discoveredToolsStoreRef);
    const gateBlockedTools =
      (state.meta.gateBlockedTools as readonly string[] | undefined) ?? [];
    // The contract's declared deny-list — the read path for
    // `constraints.forbidden-tool`. Empty without a contract, so the default
    // surface is unchanged. Captured once so the W-Q tool-surface intervention
    // (below) can report which tools the deny-list actually removed.
    const deniedToolNames = forbiddenTools(state.meta.runContract);
    const toolSurface = resolveToolSurface({
      augmented: augmentedToolSchemas,
      finalAnswerSchema: {
        name: finalAnswerTool.name,
        description: finalAnswerTool.description,
        parameters: finalAnswerTool.parameters,
      } as ToolSchema,
      lazyMode,
      pressureCritical,
      hasClassification,
      requiredTools: classifiedRequired,
      relevantTools: classifiedRelevant,
      allowedTools: input.allowedTools ?? [],
      forbiddenTools: deniedToolNames,
      toolsUsed: state.toolsUsed,
      discovered,
      // The FULL catalog discover-tools lists from (tool-capabilities.ts
      // registers the handler with `catalog = input.allToolSchemas`).
      // Discovered names resolve their schema here when the engine's
      // pre-filtered availableToolSchemas withheld it — without this,
      // discovery was a dead-end for catalog-only built-ins (live
      // regression 01KX6KY8ANMXC1BSQ1SNJN3DAP: 4 consecutive
      // discover-tools calls, surface never changed).
      catalog: input.allToolSchemas ?? [],
      gateBlockedTools,
      // Same missing-required computation the pressure gate used above — the
      // gate narrowing keys off the identical unsatisfied set.
      missingRequiredTools: missingRequiredForPressure,
      pruneMinTools: PRUNE_MIN_TOOLS,
      // Seeds the FREE keyword heuristic for UNCLASSIFIED runs only. Without
      // it, lazy disclosure read "no classification" as "nothing is relevant"
      // and hid every domain tool — costing an extra `discover-tools` round
      // trip to reach a tool the task named outright (tool-surface.ts).
      taskText: input.task,
      // Consumer-intent floor, carried separately from classifier relevance so
      // `hasClassification` above stays honest.
      floorTools: input.builtinFloorTools ?? [],
      harness: h,
    });
    const promptSchemas = toolSurface.visible;

    // ── Tool-surface narrowing intervention (Spec §5b — W-Q / task #54) ──────
    // The c4e964e8 postmortem cost: NO site could say WHY a tool was hidden.
    // resolveToolSurface is a per-iteration PURE resolver (no dedicated step),
    // so the two HARD, deterministic narrowings that change what the model can
    // CALL are stamped on this iteration's thought step (dedup: once per run per
    // actor). The soft lazy/classification disclosure is deliberately NOT
    // stamped — it prunes every iteration and tools stay reachable via
    // discover-tools, so it is steady-state operation, not a control action.
    const surfaceDeniedTool =
      deniedToolNames.length > 0 &&
      augmentedToolSchemas.some((t) => deniedToolNames.includes(t.name));
    // Stage-3 gate narrowing: the required-tools gate cut the FC-callable set
    // below what is visible while required tools are still pending.
    const surfaceGateNarrowed = toolSurface.callable.length < toolSurface.visible.length;

    // ── Harness skill injection ──────────────────────────────────────────────
    const harnessContent = input.metaTools?.harnessContent;
    const isNonTrivial =
      input.task.length >= 80 ||
      (input.requiredTools?.length ?? 0) > 0 ||
      (input.metaTools?.staticBriefInfo?.indexedDocuments.length ?? 0) > 0;
    const rawSystemPrompt =
      harnessContent && isNonTrivial && (input.metaTools?.brief || input.metaTools?.pulse)
        ? `${harnessContent}\n\n${input.systemPrompt ?? ""}`
        : input.systemPrompt;
    const pipeline = input.harnessPipeline;
    const effectiveSystemPrompt = pipeline
      ? (yield* Effect.promise(() =>
          pipeline.transform('prompt.system', rawSystemPrompt ?? "", {
            iteration: state.iteration,
            phase: 'think',
            state: asKernelStateLike(state),
            strategy,
          })
        )) ?? rawSystemPrompt
      : rawSystemPrompt;


    // Payload seam — inputs the request core and downstream stages need.
    return {
      state,
      toolSurface,
      promptSchemas,
      pipeline,
      effectiveSystemPrompt,
      missingRequiredForPressure,
      surfaceDeniedTool,
      surfaceGateNarrowed,
      deniedToolNames,
      h,
    };
  });
}
