// ─── Types (type-only) ───
export type { InteractionMode } from "./types/mode.js";
export type { Notification, ReportingConfig } from "./types/notification.js";
export type { InteractionConfig, ModeTransitionRule, EscalationCondition } from "./types/config.js";
export type { Checkpoint, CheckpointConfig } from "./types/checkpoint.js";
export type { InterruptRule, InterruptEvent } from "./types/interrupt.js";
export type {
  CollaborationSession,
  CollaborationMessage,
} from "./types/collaboration.js";
export type {
  ApprovalPattern,
  UserPreference,
} from "./types/preference.js";

// ─── Schemas (value exports) ───
export {
  InteractionModeType,
  SessionId,
  InteractionModeSchema,
} from "./types/mode.js";

export {
  CheckpointStatus,
  CheckpointSchema,
  CheckpointFrequency,
  AutoApproveAction,
  CheckpointConfigSchema,
} from "./types/checkpoint.js";

export {
  NotificationChannel,
  NotificationPriority,
  NotificationSchema,
  ReportingFrequency,
  ReportingDetailLevel,
  ReportingConfigSchema,
} from "./types/notification.js";

export {
  InterruptTrigger,
  InterruptSeverity,
  InterruptRuleSchema,
  InterruptEventSchema,
} from "./types/interrupt.js";

export {
  CollaborationStatus,
  QuestionStyle,
  CollaborationSessionSchema,
  CollaborationMessageType,
  CollaborationMessageSchema,
} from "./types/collaboration.js";

export {
  ApprovalAction,
  ApprovalPatternSchema,
  InterruptionTolerance,
  UserPreferenceSchema,
} from "./types/preference.js";

export {
  EscalationConditionType,
  EscalationConditionSchema,
  ModeTransitionRuleSchema,
  InteractionConfigSchema,
  defaultInteractionConfig,
} from "./types/config.js";

// ─── Errors ───
export {
  InteractionError,
  ModeError,
  CheckpointError,
  SessionNotFoundError,
  NotificationError,
  InputTimeoutError,
  type InteractionErrors,
} from "./errors/errors.js";

// ─── Services ───
export {
  InteractionManager,
  InteractionManagerLive,
} from "./services/interaction-manager.js";
export { ModeSwitcher, ModeSwitcherLive } from "./services/mode-switcher.js";
export {
  NotificationService,
  NotificationServiceLive,
} from "./services/notification-service.js";
export {
  CheckpointService,
  CheckpointServiceLive,
} from "./services/checkpoint-service.js";
export {
  CollaborationService,
  CollaborationServiceLive,
} from "./services/collaboration-service.js";
export {
  PreferenceLearner,
  PreferenceLearnerLive,
} from "./services/preference-learner.js";

// ─── Runtime ───
export { createInteractionLayer } from "./runtime.js";
