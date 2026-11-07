/**
 * act/skill-activation.ts — the kernel side of `activate-skill` (skills spec
 * step 4, wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md
 * §4, §5 and advisor amendments §11 items 1, 2, 5, 7).
 *
 * The decision itself is the tools package's `makeActivateSkillHandler`. This
 * module supplies its inputs and routes its result:
 *
 * - Loaded set and spent budget are a fold of the run's `skill-activated`
 *   ledger facts plus this round's staged activations. No KernelState field
 *   carries them.
 * - Budget: one body may pin at most `min(5k tokens, 10% of the window)`;
 *   all preserved skill blocks together at most 20% of the window, where the
 *   window is `resolveEffectiveNumCtx(profile)`.
 * - `{ name }` activated: the envelope is returned with
 *   `preserveOnCompaction` and an activation is staged on the round (the round
 *   commits it as a `skill-activated` fact on every exit path).
 * - `{ name, file }`: an ordinary result, through `compressToolResult` (stored
 *   with a recall ref when over budget). Never preserved, no fact.
 *
 * The handler only runs when the run has activatable skills; act.ts gates the
 * intercept on {@link hasActivatableSkills}, so a run without skills never
 * reaches it.
 */
import { Effect, Ref } from "effect";
import {
  currentScratchpadStore,
  makeActivateSkillHandler,
  setScratchpadBounded,
  type ResolvedSkills,
  type ToolCallSpec,
} from "@reactive-agents/tools";
import type { KernelContext, KernelState } from "../../state/kernel-state.js";
import { resolveEffectiveNumCtx } from "../../../context/context-profile.js";
import { entriesOfKind, type RunLedger } from "../../ledger/run-ledger.js";
import { compressToolResult } from "../attend/tool-formatting.js";
import type { ReasoningStep } from "../../../types/index.js";
import type { ChecklistRound } from "./checklist-round.js";
import type { MetaToolResult } from "./meta-tool-handlers.js";

/** Largest skill body one activation may pin, in tokens (Claude Code's rule; not measured here). */
export const SKILL_BODY_MAX_TOKENS = 5_000;
/** Share of the window one activation may pin. */
export const SKILL_BODY_WINDOW_SHARE = 0.1;
/** Share of the window all pinned skill blocks may take together. */
export const SKILL_TOTAL_WINDOW_SHARE = 0.2;
/** Window assumed when the profile declares none (matches from-kernel-state.ts). */
const DEFAULT_SKILL_WINDOW = 32_768;
/** Provenance prefix of facts merged up from a child run; a child's skills are not in this thread. */
const CHILD_PASS_PREFIX = "sub-agent:";

/** Token estimate shared by the handler, the round's block count and the tests. */
export const estimateSkillTokens = (text: string): number => Math.ceil(text.length / 4);

/** The run's skill budget for a projection window of `windowTokens`. */
export function skillBudget(windowTokens: number): { readonly maxBodyTokens: number; readonly totalTokens: number } {
  return {
    maxBodyTokens: Math.min(SKILL_BODY_MAX_TOKENS, Math.floor(windowTokens * SKILL_BODY_WINDOW_SHARE)),
    totalTokens: Math.floor(windowTokens * SKILL_TOTAL_WINDOW_SHARE),
  };
}

/**
 * Skills already in context and the tokens they pin: this run's own
 * `skill-activated` facts, this round's staged activations, and `pinned`
 * names (already in the system prompt, so they spend no skill budget).
 */
export function loadedSkills(
  ledger: RunLedger | undefined,
  round: ChecklistRound,
  pinned: readonly string[] = [],
): { readonly names: ReadonlySet<string>; readonly spentTokens: number } {
  const names = new Set<string>(pinned);
  let spentTokens = 0;
  for (const e of entriesOfKind(ledger, "skill-activated")) {
    if ((e.pass ?? "").startsWith(CHILD_PASS_PREFIX)) continue;
    names.add(e.name);
    spentTokens += e.tokens;
  }
  for (const s of round.skills) {
    names.add(s.name);
    spentTokens += s.tokens;
  }
  return { names, spentTokens };
}

const NO_SKILLS: ResolvedSkills = new Map();

/**
 * `activate-skill` meta-tool handler (registered in meta-tool-handlers.ts).
 * Never fails: every refusal is model-facing text.
 */
export function handleActivateSkillTool(
  tc: ToolCallSpec,
  state: KernelState,
  context: KernelContext,
  _allSteps: readonly ReasoningStep[],
  _newToolsUsed: Set<string>,
  round: ChecklistRound,
): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const skillsContext = context.input.skillsContext;
    const skills = skillsContext?.skills ?? NO_SKILLS;
    const budget = skillBudget(resolveEffectiveNumCtx(context.profile) ?? DEFAULT_SKILL_WINDOW);
    const loaded = loadedSkills(state.ledger, round, skillsContext?.pinned);
    const result = yield* makeActivateSkillHandler({
      skills,
      loaded: loaded.names,
      maxBodyTokens: budget.maxBodyTokens,
      remainingTokens: budget.totalTokens - loaded.spentTokens,
      estimateTokens: estimateSkillTokens,
    })(tc.arguments ?? {});

    if (result.kind === "activated") {
      round.skills.push({
        name: result.name,
        sha256: result.sha256,
        source: skills.get(result.name)?.source ?? "installed",
        via: "agent",
        tokens: result.tokens,
        toolCallId: tc.id,
      });
      return { content: result.content, success: true, preserveOnCompaction: true };
    }
    if (result.kind === "file") {
      const budgetChars = context.compression.budget ?? context.profile.toolResultMaxChars ?? 800;
      const previewItems = context.compression.previewItems ?? context.profile.toolResultPreviewItems ?? 3;
      const scratchpad = yield* Ref.get(yield* currentScratchpadStore);
      const compressed = compressToolResult(result.content, tc.name, budgetChars, previewItems, scratchpad);
      if ((context.compression.autoStore ?? true) && compressed.stored) {
        setScratchpadBounded(
          scratchpad,
          compressed.stored.key,
          compressed.stored.value,
          context.input.sessionId ?? "reasoning-session",
        );
      }
      return { content: compressed.content, success: true };
    }
    return { content: result.content, success: result.success };
  });
}
