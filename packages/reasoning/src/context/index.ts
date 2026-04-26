// File: src/context/index.ts
export {
  ModelTier,
  ContextProfileSchema,
  CONTEXT_PROFILES,
  mergeProfile,
} from "./context-profile.js";
export type { ContextProfile } from "./context-profile.js";

export { resolveProfile } from "./profile-resolver.js";

export {
  buildStaticContext,
  buildEnvironmentContext,
  buildRules,
} from "./context-engine.js";
export type { StaticContextInput } from "./context-engine.js";

export { applyMessageWindowWithCompact } from "./message-window.js";

export { ContextManager } from "./context-manager.js";
export type { GuidanceContext, ContextManagerOutput } from "./context-manager.js";

export {
  defaultContextCurator,
  renderObservationForPrompt,
} from "./context-curator.js";
export type { Prompt, ContextCurator } from "./context-curator.js";
