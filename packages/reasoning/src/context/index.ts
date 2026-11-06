// File: src/context/index.ts
export {
  ModelTier,
  ContextProfileSchema,
  CONTEXT_PROFILES,
  mergeProfile,
  resolveEffectiveNumCtx,
} from "./context-profile.js";
export type { ContextProfile } from "./context-profile.js";

export { resolveProfile, resolveProfileWithWindow } from "./profile-resolver.js";

export {
  buildEnvironmentContext,
  resolveEnvTimePrecision,
  buildRules,
} from "./context-engine.js";
export type { StaticContextInput, EnvTimePrecision } from "./context-engine.js";

// Dead APC/ContextManager stack DELETED (Phase 1b, 2026-07-07): ContextManager,
// composePrompt/PromptSectionRegistry, DEFAULT_SECTIONS, buildIterationSystemPrompt,
// buildConversationMessages, applyMessageWindowWithCompact — no live caller since the
// RA_ASSEMBLY flip; project() (assembly/) is the sole prompt pipeline. The guidance
// renderer (formerly ./guidance.js buildGuidanceText) is now the one guidance channel:
// kernel/state/guidance-channel.ts renderGuidance (Plan 9 Phase 4 stage 3).

// defaultContextCurator + Prompt/ContextCurator/CuratorOptions DELETED in
// Sprint-1 A3 (2026-06-02). Canonical project() is the sole assembler;
// see packages/reasoning/src/assembly/project.ts.


