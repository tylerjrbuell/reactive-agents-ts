/**
 * @reactive-agents/ui-core — headless core for agent UI bindings.
 * Effect-free and dependency-free by design: this package runs in browsers.
 */
export * from "./protocol/events.js";
export * from "./parse-partial.js";
export { connectRunStream, type ConnectOptions, type FetchLike } from "./stream/connect.js";
export {
  initialRunState,
  reduceRunState,
  type RunState,
  type ReduceOptions,
} from "./state/run-machine.js";
export {
  initialTurnTrace,
  foldTurnTrace,
  finishTurnTrace,
  visibleThoughts,
  visibleIterations,
  mergeThoughtText,
  type TurnTraceState,
  type TurnTrace,
  type TraceToolCall,
  type PersistedSubAgent,
  type PersistedReasoningStep,
  type VisibleIteration,
  type TurnContext,
} from "./state/turn-trace.js";
export {
  turnOutcomeOf,
  splitUnfinished,
  interruptionCause,
  causeLineOf,
  type TurnEnding,
  type TurnOutcome,
  type TurnDeliverable,
  type RunCompletionLike,
  type InterruptedBy,
} from "./state/turn-outcome.js";
export { initialModelWait, foldModelWait, modelWaitLabel, type ModelWaitState } from "./state/model-wait.js";
export { statusOfTurn, statusOfRun, statusOfSubAgent, type StatusTone, type StatusView } from "./state/status.js";
export {
  formatCost,
  formatTokens,
  formatRelativeTime,
  formatClockTime,
  type TimeFormatOptions,
} from "./state/format.js";
export {
  buildTurnSteps,
  turnStepsOf,
  persistedTurnStepsOf,
  summarizeTurn,
  failureReason,
  shortToolName,
  type TurnStep,
  type StepAction,
  type StepFailure,
  type StepCall,
  type StepIterationText,
  type TurnSummary,
} from "./state/turn-steps.js";
export {
  buildTurnTranscript,
  turnTranscriptOf,
  persistedTurnTranscriptOf,
  type TranscriptSegment,
  type TranscriptProse,
  type TranscriptTools,
  type TranscriptAnswer,
  type TranscriptEnding,
} from "./state/turn-transcript.js";
export { foldSubAgentActivity, type SubAgentTrace, type SubAgentBlock, type SubAgentFolder } from "./state/sub-agent-fold.js";
export { toolBadgesOf, type ToolBadge, type ToolBadges, type ToolBadgeTone } from "./state/tool-badges.js";
export {
  FLOOR_REQUIREMENT_ID,
  isImplicitRequirement,
  goalSummaryOf,
  findSubAgentGroup,
  type GoalStatus,
  type GoalSummary,
} from "./state/goal-checks.js";
export {
  subAgentCardOf,
  subAgentRollup,
  argHint,
  type SubAgentCard,
  type SubAgentCardInput,
  type SubAgentCardState,
  type SubAgentRollup,
} from "./state/sub-agent-card.js";
export { turnStrategiesOf, type StrategySource, type TurnStrategies } from "./state/turn-strategy.js";
export { formatTurnDuration } from "./state/turn-duration.js";
export {
  splitTokens,
  charsToTokens,
  estimateTokens,
  contextLevel,
  summarizeUsage,
  type ContextLevel,
  type TokenSplit,
  type CallUsage,
  type TurnUsage,
} from "./state/token-usage.js";
export { type UiNode, isUiNode, uiTreeSchema, reconcileUiTree } from "./render/tree.js";
export { type InboxRun, fetchInbox } from "./inbox/controller.js";
export {
  type InteractionResult,
  respondToInteraction,
  decideApproval,
} from "./interaction/controller.js";
