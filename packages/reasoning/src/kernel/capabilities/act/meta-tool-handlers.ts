/**
 * act/meta-tool-handlers.ts — Inline meta-tool handler registry.
 *
 * Extracted from act.ts (WS-6 Phase 5). The three inline meta-tools
 * (brief / pulse / activate-skill) are a self-contained cluster: each is a
 * pure mapping from (tool call + read-only kernel state) to a `MetaToolResult`
 * with no mutation of caller state. They round-trip nothing through
 * ToolService — unlike `recall` / `find`, which are NOT in this registry.
 *
 * `handleActing` owns the gating decision (`input.metaTools?.brief` etc.) and
 * the `makeStep` action/observation wrapping; only the registry lookup +
 * handler bodies live here.
 *
 * Imports are substrate-only (`@reactive-agents/tools`) plus shared state /
 * types — no sibling-capability internal imports.
 */
import { Effect, Ref } from "effect";
import {
  scratchpadStoreRef,
  buildBriefResponse,
  mergeBriefAvailableSkills,
  type BriefInput,
  buildPulseResponse,
  type PulseInput,
  type ToolCallSpec,
  activateSkillHandler,
} from "@reactive-agents/tools";
import type {
  KernelState,
  KernelContext,
} from "../../../kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";

export type MetaToolResult = { readonly content: string; readonly success: boolean };

export type MetaToolHandler = (
  tc: ToolCallSpec,
  state: KernelState,
  context: KernelContext,
  allSteps: readonly ReasoningStep[],
  newToolsUsed: Set<string>,
) => Effect.Effect<MetaToolResult, never>;

/**
 * brief — situational awareness snapshot (inline, no ToolService round-trip).
 */
function handleBriefTool(
  tc: ToolCallSpec,
  state: KernelState,
  context: KernelContext,
  _allSteps: readonly ReasoningStep[],
  _newToolsUsed: Set<string>,
): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const { input } = context;
    const liveStore = yield* Ref.get(scratchpadStoreRef);
    const recallKeys = [...liveStore.keys()];
    const briefInput: BriefInput = {
      section: tc.arguments?.section as string | undefined,
      availableTools: input.availableToolSchemas ?? [],
      indexedDocuments: input.metaTools?.staticBriefInfo?.indexedDocuments ?? [],
      availableSkills: mergeBriefAvailableSkills(
        input.metaTools?.staticBriefInfo?.availableSkills,
        input.briefResolvedSkills,
      ),
      memoryBootstrap: input.metaTools?.staticBriefInfo?.memoryBootstrap ?? { semanticLines: 0, episodicEntries: 0 },
      recallKeys,
      tokens: state.tokens,
      tokenBudget: context.profile.maxTokens ?? 8000,
      entropy: state.meta.entropy?.latest,
      controllerDecisionLog: state.controllerDecisionLog,
      iterationCount: state.iteration,
    };
    const briefContent = buildBriefResponse(briefInput);
    return { content: briefContent, success: true };
  });
}

/**
 * pulse — reactive intelligence introspection (inline, no ToolService round-trip).
 */
function handlePulseTool(
  tc: ToolCallSpec,
  state: KernelState,
  context: KernelContext,
  allSteps: readonly ReasoningStep[],
  newToolsUsed: Set<string>,
): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const { input } = context;
    const pulseInput: PulseInput = {
      question: tc.arguments?.question as string | undefined,
      entropy: state.meta.entropy?.latest as PulseInput["entropy"],
      controllerDecisionLog: state.controllerDecisionLog,
      steps: allSteps as ReasoningStep[],
      iteration: state.iteration,
      maxIterations: (state.meta.maxIterations as number | undefined) ?? 10,
      tokens: state.tokens,
      tokenBudget: context.profile.maxTokens ?? 8000,
      task: input.task,
      allToolSchemas: input.allToolSchemas ?? input.availableToolSchemas ?? [],
      toolsUsed: newToolsUsed,
      requiredTools: input.requiredTools ?? [],
    };
    const pulseContent = JSON.stringify(buildPulseResponse(pulseInput), null, 2);
    return { content: pulseContent, success: true };
  });
}

/**
 * activate-skill — acknowledge the request inline; the intervention dispatcher
 * handles the actual inject-skill-content patch on the next controller tick.
 */
function handleActivateSkillTool(
  tc: ToolCallSpec,
  _state: KernelState,
  _context: KernelContext,
  _allSteps: readonly ReasoningStep[],
  _newToolsUsed: Set<string>,
): Effect.Effect<MetaToolResult, never> {
  return activateSkillHandler(tc.arguments ?? {}).pipe(
    Effect.map((result) => {
      const content = JSON.stringify(result);
      return { content, success: (result as { ok?: boolean }).ok === true };
    }),
    Effect.catchAll(() =>
      Effect.succeed({
        content: JSON.stringify({ ok: false, error: "activate-skill handler failed" }),
        success: false,
      }),
    ),
  );
}

/**
 * Open registry — new inline meta-tools are a one-line addition.
 * Tools that go through ToolService (recall, find) are NOT in this registry.
 */
export const metaToolRegistry = new Map<string, MetaToolHandler>([
  ["brief", handleBriefTool],
  ["pulse", handlePulseTool],
  ["activate-skill", handleActivateSkillTool],
]);
