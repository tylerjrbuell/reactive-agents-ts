/**
 * Intelligence event types for the Living Intelligence System.
 * These are added to the AgentEvent union in event-bus.ts.
 */

// ─── Skill lifecycle events ───

export type SkillActivated = {
  readonly _tag: "SkillActivated";
  readonly skillName: string;
  readonly version: number;
  readonly trigger: "model" | "harness" | "bootstrap";
  readonly iteration: number;
  readonly confidence: string;
};

export type SkillRefined = {
  readonly _tag: "SkillRefined";
  readonly skillName: string;
  readonly previousVersion: number;
  readonly newVersion: number;
  readonly taskCategory: string;
};

export type SkillRefinementSuggested = {
  readonly _tag: "SkillRefinementSuggested";
  readonly skillName: string;
  readonly newInstructions: string;
  readonly reason: string;
};

export type SkillRolledBack = {
  readonly _tag: "SkillRolledBack";
  readonly skillName: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly reason: "regression" | "manual";
};

export type SkillConflictDetected = {
  readonly _tag: "SkillConflictDetected";
  readonly skillA: string;
  readonly skillB: string;
  readonly conflictType: "instruction" | "config" | "task-overlap";
};

export type SkillPromoted = {
  readonly _tag: "SkillPromoted";
  readonly skillName: string;
  readonly fromConfidence: string;
  readonly toConfidence: string;
};

export type SkillSkippedContextFull = {
  readonly _tag: "SkillSkippedContextFull";
  readonly skillName: string;
  readonly requiredTokens: number;
  readonly availableTokens: number;
  readonly modelTier: string;
};

export type SkillEvicted = {
  readonly _tag: "SkillEvicted";
  readonly skillName: string;
  readonly reason: "budget" | "low-priority";
  readonly verbosityAtEviction: string;
};

// ─── Intelligence control events ───

export type TemperatureAdjusted = {
  readonly _tag: "TemperatureAdjusted";
  readonly delta: number;
  readonly reason: string;
  readonly iteration: number;
};

export type ToolInjected = {
  readonly _tag: "ToolInjected";
  readonly toolName: string;
  readonly reason: string;
  readonly iteration: number;
};

export type MemoryBoostTriggered = {
  readonly _tag: "MemoryBoostTriggered";
  readonly from: string;
  readonly to: string;
  readonly iteration: number;
};

export type AgentNeedsHuman = {
  readonly _tag: "AgentNeedsHuman";
  readonly agentId: string;
  readonly taskId: string;
  readonly reason: string;
  readonly decisionsExhausted: readonly string[];
  readonly context: string;
};

// ─── Union types ───

export type SkillEvent =
  | SkillActivated
  | SkillRefined
  | SkillRefinementSuggested
  | SkillRolledBack
  | SkillConflictDetected
  | SkillPromoted
  | SkillSkippedContextFull
  | SkillEvicted;

export type IntelligenceControlEvent =
  | TemperatureAdjusted
  | ToolInjected
  | MemoryBoostTriggered
  | AgentNeedsHuman;

export type IntelligenceEvent = SkillEvent | IntelligenceControlEvent;
