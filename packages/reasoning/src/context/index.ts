// File: src/context/index.ts
export {
  ModelTier,
  ContextProfileSchema,
  CONTEXT_PROFILES,
  mergeProfile,
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
// RA_ASSEMBLY flip; project() (assembly/) is the sole prompt pipeline. GuidanceContext
// + buildGuidanceText live on in ./guidance.js (hotfix 0.5-1).
export { buildGuidanceText } from "./guidance.js";
export type { GuidanceContext } from "./guidance.js";

// defaultContextCurator + Prompt/ContextCurator/CuratorOptions DELETED in
// Sprint-1 A3 (2026-06-02). Canonical project() is the sole assembler;
// see packages/reasoning/src/assembly/project.ts.


