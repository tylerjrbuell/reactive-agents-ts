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
  buildStaticContext,
  buildEnvironmentContext,
  resolveEnvTimePrecision,
  buildRules,
} from "./context-engine.js";
export type { StaticContextInput, EnvTimePrecision } from "./context-engine.js";

export { applyMessageWindowWithCompact } from "./message-window.js";

export { ContextManager } from "./context-manager.js";
export type { GuidanceContext, ContextManagerOutput } from "./context-manager.js";

// defaultContextCurator + Prompt/ContextCurator/CuratorOptions DELETED in
// Sprint-1 A3 (2026-06-02). Canonical project() is the sole assembler;
// see packages/reasoning/src/assembly/project.ts.

// ── Adaptive Prompt Composer (APC-2) ─────────────────────────────────────────
export {
  PromptSectionRegistry,
  composePrompt,
  auditPromptSections,
  defaultPromptSectionRegistry,
} from "./prompt-composer.js";
export type {
  PromptSection,
  PromptSectionContext,
  PromptSectionAuditEntry,
  ComposeOptions,
  ComposeResult,
} from "./prompt-composer.js";
