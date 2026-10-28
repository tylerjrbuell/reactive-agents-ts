import type {
  ThinkingEmitted,
} from "../llm-purpose.js";
import type {
  SkillActivated,
  SkillRefined,
  SkillRefinementSuggested,
  SkillRolledBack,
  SkillConflictDetected,
  SkillPromoted,
  SkillSkippedContextFull,
  SkillEvicted,
  TemperatureAdjusted,
  ToolInjected,
  MemoryBoostTriggered,
  AgentNeedsHuman,
} from "../intelligence-events.js";
import type {
  MemorySnapshot,
  ContextPressure,
  ChatTurnEvent,
  AgentHealthReport,
  ProviderFallbackActivated,
  DebriefCompleted,
  AgentConnected,
  AgentDisconnected,
} from "../cortex-events.js";
import type {
  JudgmentEvaluated,
  JudgmentFailed,
  JudgmentShadow,
} from "../judgment-events.js";

/** Skill, intelligence-control, cortex and judgment events. */
export type ExtensionAgentEvent =
  // ─── Skill lifecycle events ───
  | SkillActivated
  | SkillRefined
  | SkillRefinementSuggested
  | SkillRolledBack
  | SkillConflictDetected
  | SkillPromoted
  | SkillSkippedContextFull
  | SkillEvicted
  // ─── Intelligence control events ───
  | TemperatureAdjusted
  | ToolInjected
  | MemoryBoostTriggered
  | AgentNeedsHuman
  // ─── Cortex events ───
  | MemorySnapshot
  | ContextPressure
  | ChatTurnEvent
  | AgentHealthReport
  | ProviderFallbackActivated
  | DebriefCompleted
  | AgentConnected
  | AgentDisconnected
  // ─── Judgment primitive events (@reactive-agents/judgment) ───
  | JudgmentEvaluated
  | JudgmentFailed
  | JudgmentShadow
  | ThinkingEmitted;
