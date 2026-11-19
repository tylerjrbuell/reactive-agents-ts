export type * from "./events.js"
export { isTraceEvent } from "./events.js"
export { TraceRecorderService, TraceRecorderServiceLive } from "./recorder.js"
export type { TraceRecorder, TraceRecorderOptions } from "./recorder.js"
export { resolveTraceDir, defaultTraceDir, effectiveTraceDir } from "./paths.js"
export { pruneTraceDir, planRunPrune, classifyProvenance, retentionPolicyFromEnv } from "./retention.js"
export type { RetentionPolicy, TraceFileInfo, TraceProvenance } from "./retention.js"
export { loadTrace, parseTrace, traceStats } from "./replay.js"
export type { Trace, TraceStats } from "./replay.js"
export {
  analyzeInterventions,
  renderInterventionReport,
  analyzeRun,
  renderRunReport,
} from "./analyze.js"
export type {
  InterventionAnalysis,
  GuardStat,
  OverlapStorm,
  FailureMode,
  AnalyzeOptions,
  RunAnalysis,
  HonestyCheck,
  CostSignal,
  ReasoningTrajectory,
  ToolOutcome,
  InterventionPressure,
  CoverageReport,
} from "./analyze.js"
export { analyzeCause, renderCause, tallyCauses, runSegmentNote, withRunSegment } from "./cause.js"
/** Split a trace file that holds several runs under one runId (a reused runId, e.g. Cortex "Continue"). */
export { runSegments, lastRunSegment } from "./segments.js"
/** Plain words and justified next steps for each failure cause (one vocabulary for every reader). */
export { CAUSE_DESCRIPTIONS, causeDescription, causeNextActions } from "./cause-description.js"
export { gateDecisionFor, guardEndedRun, runEndingGuardEvents } from "./guard-run-end.js"
export type { GuardEventLike } from "./guard-run-end.js"
export type { CauseAnalysis, CauseTally, FailureCause, CauseConfidence, CauseEvidence, RunSegmentRef } from "./cause.js"
/**
 * Zero-token harness-vs-model attribution of a failed run: is it the harness
 * configuration or the model? See {@link attributeFailure}.
 */
export { attributeFailure, renderAttribution, tallyAttributions } from "./attribution.js"
/** Honest-decline check shared by attribution and the benchmark scorer (text + tool provenance). */
export { isHonestDecline, toolProvenanceOf } from "./attribution-decline.js"
export type { ToolProvenance } from "./attribution-decline.js"
/** The one failure taxonomy: every attribution reason, and the owner of each failure cause. */
export { CAUSE_ATTRIBUTION, verdictOf } from "./taxonomy.js"
/** Which harness mechanisms acted in a run, and how that changed between two cohorts. */
export { mechanismActivity, compareActivity, runsWithMechanism } from "./activity.js"
export type { MechanismActivity, ActivityDelta, ActivityComparison } from "./activity.js"
export type {
  Attribution,
  AttributionVerdict,
  AttributionReason,
  AttributionTarget,
  AttributionTally,
  DivergenceTurn,
} from "./attribution.js"
export { aggregateCohort, compareCohorts, renderCohortDelta } from "./cohort.js"
export type { CohortStats, CohortDelta } from "./cohort.js"
export { TraceBridgeLayer } from "./layer.js"
export { toTraceEvent } from "./normalize.js"
export { validateRationale, isRationale } from "./rationale.js"
export type { Rationale } from "./rationale.js"
export { RationaleValidationError, TraceStorageError } from "./errors.js"
