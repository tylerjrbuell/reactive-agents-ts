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
  USER_STOP_CRITERION,
  isUserStopKind,
  isUserStopResult,
  userInterruptOf,
  type UserInterrupt,
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
  reactLoopOf,
  reactLoopChip,
  compactArgs,
  type ReactLoop,
  type ReactLoopInput,
  type LoopRow,
  type LoopAction,
  type LoopStepInput,
  type LoopCallInput,
} from "./state/react-loop.js";
export {
  buildTurnTranscript,
  turnTranscriptOf,
  persistedTurnTranscriptOf,
  type TranscriptSegment,
  type TranscriptProse,
  type TranscriptTools,
  type TranscriptAnswer,
  type TranscriptEnding,
  type TranscriptThinking,
} from "./state/turn-transcript.js";
export {
  foldStructured,
  fieldRowsOf,
  hasFieldRows,
  pointerLabel,
  obtainedOf,
  MAX_FIELD_ROWS,
  type TurnStructured,
  type FieldRow,
  type FieldKind,
  type ObtainedView,
} from "./state/structured-output.js";
export {
  SCHEMA_FIELD_TYPES,
  fieldsToJsonSchema,
  jsonSchemaToFields,
  type SchemaField,
  type SchemaFieldType,
  type ParsedSchemaFields,
} from "./state/schema-fields.js";
export { continuationsOf, continuationChainOf, type LineageRun } from "./state/run-lineage.js";
export { foldSubAgentActivity,type SubAgentTrace, type SubAgentBlock, type SubAgentFolder } from "./state/sub-agent-fold.js";
export { toolBadgesOf, type ToolBadge, type ToolBadges, type ToolBadgeTone } from "./state/tool-badges.js";
export {
  nextStepId,
  addStep,
  removeStep,
  moveStep,
  setStepTitle,
  setStepTool,
  planEdited,
  stepStatusLabel,
  planProgressLine,
  type PlanDraftStep,
} from "./state/plan-edit.js";
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
  STRATEGY_RANK_CONFIG,
  STRATEGY_RANK_LOOP,
  STRATEGY_RANK_STEP,
  initialRunStrategy,
  strategyClaimsOf,
  foldRunStrategy,
  runStrategyOf,
  runStrategyOfEvents,
  type StrategyRank,
  type StrategyClaim,
  type StrategyClaims,
  type RunStrategyState,
  type RunStrategy,
} from "./state/run-strategy.js";
export { splitReasoning, type ReasoningSplit } from "./state/reasoning-split.js";
export {
  STRATEGY_PHASES,
  strategySpecOf,
  strategyPhasesOf,
  strategyStepOf,
  strategyStepFromWire,
  phaseIdOf,
  totNodeOfWire,
  totNodeOfThought,
  initialStrategyRun,
  foldStrategyRun,
  endStrategyRun,
  strategyStatusOf,
  totTreeOf,
  totForestOf,
  totHasEdges,
  attemptsOf,
  type TotTreeNode,
  type CodeVerify,
  type StrategyPhaseDef,
  type StrategySpec,
  type StrategyStep,
  type StrategyStepDetail,
  type StrategyRow,
  type StrategyRowStatus,
  type StrategyRunState,
  type StrategyRunHolder,
  type StrategyAttempt,
  type TotNode,
  type TotLevel,
} from "./state/strategy-phases.js";
export {
  adaptiveChoiceOf,
  adaptiveChoiceLine,
  planProgressOf,
  planSummaryOf,
  quietRunLine,
  DIRECT_SETTLED,
  type AdaptiveChoice,
  type AdaptiveHow,
  type PlanProgress,
} from "./state/strategy-summary.js";
export {
  planStepsOf,
  planStepBadgesOf,
  planStepEventLine,
  planStepPayloadOf,
  strategyChoicePayloadOf,
  type PlanStepEvent,
  type PlanStepEventKind,
  type PlanStepPayload,
  type PlanStepView,
  type StrategyChoicePayload,
} from "./state/strategy-plan-history.js";
export {
  DEFAULT_STRATEGY_RUN_CAPS,
  strategyRunForStorage,
  strategyRunFromStorage,
  type StrategyRunCaps,
} from "./state/strategy-run-persist.js";
export {
  approvalGateOf,
  strategyApprovalConflictOf,
  strategyConflictLineOf,
  type ApprovalGate,
  type ConflictResolution,
  type StrategyApprovalConflict,
  type StrategyApprovalInput,
} from "./state/strategy-conflict.js";
export {
  SAFETY_EVENT_TAGS,
  safetyBodyOf,
  safetyEntriesOf,
  safetySummaryOf,
  safetyPlaceLabel,
  type SafetyKind,
  type SafetyTone,
  type SafetyPhase,
  type SafetyEntry,
  type SafetyEventLike,
  type SafetyLoopMark,
  type SafetySummary,
} from "./state/safety-entries.js";
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
export {
  throughputOf,
  throughputOfCalls,
  liveTokensPerSecond,
  formatTokensPerSecond,
  formatFirstToken,
  medianOf,
  MIN_LIVE_RATE_MS,
  type ThroughputSample,
  type Throughput,
} from "./state/throughput.js";
export {
  JUDGMENT_EVENT_TAGS,
  LOW_JUDGMENT_CONFIDENCE,
  foldJudgments,
  judgmentBadgeOf,
  type JudgmentRowKind,
  type JudgmentQuestionKind,
  type JudgmentRow,
  type JudgmentLedger,
  type JudgmentEventLike,
  type JudgmentBadge,
} from "./state/judgment-ledger.js";
export {
  skillActivationVia,
  skillViaLabel,
  runSkillsOf,
  runSkillsRecordOf,
  skillActivationOf,
  foldRunSkills,
  type SkillActivationVia,
  type SkillActivationLike,
  type RunSkillsRecordLike,
  type SkillActivationView,
  type RunSkillsView,
} from "./state/skill-activations.js";
export {
  MAX_RECALLED_MEMORIES,
  memoryRecalledOf,
  foldRecalledMemories,
  type RecalledItemLike,
  type MemoryRecalledLike,
  type RecalledMemoryView,
} from "./state/recalled-memories.js";
export {
  SKILL_CONFIDENCE_TIERS,
  SKILL_LIFECYCLE_TAGS,
  skillConfidenceLabel,
  skillLineDiff,
  skillDiffStats,
  skillLifecycleEntryOf,
  type SkillConfidenceTier,
  type SkillDiffLine,
  type SkillLifecycleEventLike,
  type SkillLifecycleKind,
  type SkillLifecycleEntry,
} from "./state/skill-evolution.js";
export { type UiNode, isUiNode, uiTreeSchema, reconcileUiTree } from "./render/tree.js";
export { type InboxRun, fetchInbox } from "./inbox/controller.js";
export {
  type InteractionResult,
  respondToInteraction,
  decideApproval,
} from "./interaction/controller.js";
export {
  DELIVERABLE_CONTENT_CAP,
  baseNameOf,
  deliverableFileName,
  deliverableText,
  deliverablesOf,
  mediaTypeOfPath,
  type DeclaredDeliverableLike,
  type DeliverableCallLike,
  type DeliverableInputs,
  type DeliverableItem,
  type DeliverableKind,
} from "./state/deliverables.js";
export { calloutKindOf, outlineOf, slugOf, type CalloutKind, type OutlineEntry } from "./state/answer-outline.js";
export {
  ATTACHMENT_CAPS,
  AUDIO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  TEXT_EXTENSIONS,
  classifyAttachment,
  cutToBytes,
  fileContextBlock,
  formatBytes,
  gateAttachmentKind,
  modalityMessage,
  type AttachmentCandidate,
  type AttachmentClass,
  type AttachmentGate,
  type AttachmentKind,
  type AttachmentMeta,
  type InputCapabilitiesLike,
} from "./state/attachments.js";
export { rankPaths, scorePath, type PathMatch } from "./state/path-match.js";
export { deliverableCallsOf, type ToolCallEventLike } from "./state/deliverables.js";

// Voice: speech engines, dictation / read-aloud controllers, voice-mode reducer.
export * from "./voice/index.js";
