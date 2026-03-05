# Layer 10: Interaction - AI Agent Implementation Spec

## Overview

Multi-modal human-agent interaction system with 5 interaction modes (Autonomous, Supervised, Collaborative, Consultative, Interrogative), rule-based mode switching via escalation/de-escalation rules, user preference learning, and context-preserving transitions. This is a UNIQUE competitive advantage — no other framework offers a variable-autonomy interaction spectrum.

**Package:** `@reactive-agents/interaction`
**Dependencies:** `effect@^3.10`, `@reactive-agents/core`, `@reactive-agents/reasoning`, `@reactive-agents/observability`
**Phase:** 1C (Autonomous mode only, Week 4); Phase 3 (all 5 modes, Weeks 13-14)

> **Design Evolution (v0.4.0):** The original spec proposed 6 modes including an "adaptive" meta-mode
> where the agent would dynamically select its interaction mode via AI. During implementation, "adaptive"
> was dropped as a distinct mode. Instead, adaptive behavior is achieved through the ModeSwitcher's
> `evaluateTransition()` method, which applies configurable escalation/de-escalation rules to switch
> between the 5 concrete modes at runtime. This is simpler, more predictable, and avoids the overhead
> of an LLM call to select interaction modes. The 5 shipped modes are:
> - **autonomous** -- Fire-and-forget: agent runs independently
> - **supervised** -- Checkpoints: agent pauses at milestones for approval
> - **collaborative** -- Real-time: agent and user work together
> - **consultative** -- Advisory: agent observes and suggests
> - **interrogative** -- Drill-down: user explores agent state/reasoning

---

## Package Structure

```
@reactive-agents/interaction/
├── src/
│   ├── index.ts                          # Public API re-exports
│   ├── types/
│   │   ├── mode.ts                       # InteractionMode, InteractionModeType schemas
│   │   ├── interrupt.ts                  # InterruptRule, InterruptEvent schemas
│   │   ├── checkpoint.ts                 # Checkpoint, CheckpointConfig schemas
│   │   ├── notification.ts              # Notification schemas
│   │   ├── collaboration.ts             # CollaborationSession schemas
│   │   ├── preference.ts                # UserPreference, ApprovalPattern schemas
│   │   └── config.ts                    # InteractionConfig schema
│   ├── errors/
│   │   └── errors.ts                    # All Data.TaggedError definitions
│   ├── services/
│   │   ├── interaction-manager.ts       # InteractionManager Context.Tag + Live Layer
│   │   ├── mode-switcher.ts             # ModeSwitcher Context.Tag + Live Layer
│   │   ├── checkpoint-service.ts        # CheckpointService Context.Tag + Live Layer
│   │   ├── notification-service.ts      # NotificationService Context.Tag + Live Layer
│   │   ├── preference-learner.ts        # PreferenceLearner Context.Tag + Live Layer
│   │   └── collaboration-service.ts     # CollaborationService Context.Tag + Live Layer
│   └── runtime.ts                       # createInteractionLayer factory
├── tests/
│   ├── interaction-manager.test.ts
│   ├── mode-switcher.test.ts
│   ├── checkpoint-service.test.ts
│   ├── notification-service.test.ts
│   ├── preference-learner.test.ts
│   └── collaboration-service.test.ts
├── package.json
└── tsconfig.json
```

---

## Build Order

1. `src/types/mode.ts` — InteractionModeType, InteractionMode schemas
2. `src/types/interrupt.ts` — InterruptRule, InterruptEvent schemas
3. `src/types/checkpoint.ts` — Checkpoint, CheckpointConfig schemas
4. `src/types/notification.ts` — Notification schemas
5. `src/types/collaboration.ts` — CollaborationSession schemas
6. `src/types/preference.ts` — UserPreference, ApprovalPattern schemas
7. `src/types/config.ts` — InteractionConfig schema with defaults
8. `src/errors/errors.ts` — All error types
9. `src/services/notification-service.ts` — NotificationService + Live
10. `src/services/checkpoint-service.ts` — CheckpointService + Live
11. `src/services/preference-learner.ts` — PreferenceLearner + Live
12. `src/services/collaboration-service.ts` — CollaborationService + Live
13. `src/services/mode-switcher.ts` — ModeSwitcher + Live
14. `src/services/interaction-manager.ts` — InteractionManager + Live (orchestrates all)
15. `src/runtime.ts` — createInteractionLayer factory
16. `src/index.ts` — Public re-exports
17. Tests for each service

---

## Core Types & Schemas

### File: `src/types/mode.ts`

```typescript
// File: src/types/mode.ts
import { Schema } from "effect";

// ─── Interaction Mode Type ───

export const InteractionModeType = Schema.Literal(
  "autonomous", // Fire-and-forget: agent runs independently
  "supervised", // Checkpoints: agent pauses at milestones for approval
  "collaborative", // Real-time: agent and user work together
  "consultative", // Advisory: agent observes and suggests
  "interrogative", // Drill-down: user explores agent state/reasoning
  // NOTE: "adaptive" was removed as a distinct mode. Adaptive behavior is
  // achieved via ModeSwitcher.evaluateTransition() with escalation/de-escalation rules.
);
export type InteractionModeType = typeof InteractionModeType.Type;

// ─── Session ID ───

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

// ─── Interaction Mode ───

export const InteractionModeSchema = Schema.Struct({
  mode: InteractionModeType,
  agentId: Schema.String,
  sessionId: SessionId,
  startedAt: Schema.DateFromSelf,
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type InteractionMode = typeof InteractionModeSchema.Type;
```

### File: `src/types/interrupt.ts`

```typescript
// File: src/types/interrupt.ts
import { Schema } from "effect";

// ─── Interrupt Trigger ───

export const InterruptTrigger = Schema.Literal(
  "error", // Agent encountered an error
  "uncertainty", // Agent confidence below threshold
  "high-cost", // Operation cost exceeds budget
  "critical-decision", // Decision requires human judgment
  "user-requested", // User explicitly requested attention
  "custom", // Custom predicate triggered
);
export type InterruptTrigger = typeof InterruptTrigger.Type;

// ─── Interrupt Severity ───

export const InterruptSeverity = Schema.Literal(
  "low",
  "medium",
  "high",
  "critical",
);
export type InterruptSeverity = typeof InterruptSeverity.Type;

// ─── Interrupt Rule ───

export const InterruptRuleSchema = Schema.Struct({
  trigger: InterruptTrigger,
  severity: InterruptSeverity,
  threshold: Schema.optional(Schema.Number), // For numeric triggers (confidence, cost)
  enabled: Schema.Boolean,
});
export type InterruptRule = typeof InterruptRuleSchema.Type;

// ─── Interrupt Event ───

export const InterruptEventSchema = Schema.Struct({
  id: Schema.String,
  trigger: InterruptTrigger,
  severity: InterruptSeverity,
  agentId: Schema.String,
  taskId: Schema.String,
  message: Schema.String,
  context: Schema.optional(Schema.Unknown),
  timestamp: Schema.DateFromSelf,
  acknowledged: Schema.Boolean,
});
export type InterruptEvent = typeof InterruptEventSchema.Type;
```

### File: `src/types/checkpoint.ts`

```typescript
// File: src/types/checkpoint.ts
import { Schema } from "effect";

// ─── Checkpoint Status ───

export const CheckpointStatus = Schema.Literal(
  "pending", // Waiting for user action
  "approved", // User approved
  "rejected", // User rejected
  "auto-approved", // Auto-approved after timeout
  "expired", // Timed out with no default action
);
export type CheckpointStatus = typeof CheckpointStatus.Type;

// ─── Checkpoint ───

export const CheckpointSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  taskId: Schema.String,
  milestoneName: Schema.String,
  description: Schema.String,
  status: CheckpointStatus,
  createdAt: Schema.DateFromSelf,
  resolvedAt: Schema.optional(Schema.DateFromSelf),
  userComment: Schema.optional(Schema.String),
});
export type Checkpoint = typeof CheckpointSchema.Type;

// ─── Checkpoint Config (for supervised mode) ───

export const CheckpointFrequency = Schema.Literal("milestone", "time-based");
export type CheckpointFrequency = typeof CheckpointFrequency.Type;

export const AutoApproveAction = Schema.Literal("approve", "reject", "pause");
export type AutoApproveAction = typeof AutoApproveAction.Type;

export const CheckpointConfigSchema = Schema.Struct({
  frequency: CheckpointFrequency,
  intervalMs: Schema.optional(Schema.Number), // For time-based
  milestones: Schema.optional(Schema.Array(Schema.String)), // Named checkpoints
  autoApprove: Schema.Struct({
    enabled: Schema.Boolean,
    timeoutMs: Schema.Number,
    defaultAction: AutoApproveAction,
  }),
});
export type CheckpointConfig = typeof CheckpointConfigSchema.Type;
```

### File: `src/types/notification.ts`

```typescript
// File: src/types/notification.ts
import { Schema } from "effect";

// ─── Notification Channel ───

export const NotificationChannel = Schema.Literal(
  "in-app", // Dashboard notification
  "callback", // Programmatic callback
  "event-bus", // EventBus from Layer 1
);
export type NotificationChannel = typeof NotificationChannel.Type;

// ─── Notification Priority ───

export const NotificationPriority = Schema.Literal(
  "low",
  "normal",
  "high",
  "urgent",
);
export type NotificationPriority = typeof NotificationPriority.Type;

// ─── Notification ───

export const NotificationSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  channel: NotificationChannel,
  priority: NotificationPriority,
  title: Schema.String,
  body: Schema.String,
  data: Schema.optional(Schema.Unknown),
  createdAt: Schema.DateFromSelf,
  readAt: Schema.optional(Schema.DateFromSelf),
});
export type Notification = typeof NotificationSchema.Type;

// ─── Reporting Config ───

export const ReportingFrequency = Schema.Literal(
  "realtime",
  "milestone",
  "hourly",
  "daily",
);
export type ReportingFrequency = typeof ReportingFrequency.Type;

export const ReportingDetailLevel = Schema.Literal(
  "minimal",
  "summary",
  "detailed",
);
export type ReportingDetailLevel = typeof ReportingDetailLevel.Type;

export const ReportingConfigSchema = Schema.Struct({
  frequency: ReportingFrequency,
  channel: NotificationChannel,
  detail: ReportingDetailLevel,
  streaming: Schema.Boolean,
});
export type ReportingConfig = typeof ReportingConfigSchema.Type;
```

### File: `src/types/collaboration.ts`

```typescript
// File: src/types/collaboration.ts
import { Schema } from "effect";
import { SessionId } from "./mode.js";

// ─── Collaboration Session Status ───

export const CollaborationStatus = Schema.Literal("active", "paused", "ended");
export type CollaborationStatus = typeof CollaborationStatus.Type;

// ─── Question Style ───

export const QuestionStyle = Schema.Literal("inline", "batch", "separate");
export type QuestionStyle = typeof QuestionStyle.Type;

// ─── Collaboration Session ───

export const CollaborationSessionSchema = Schema.Struct({
  id: SessionId,
  agentId: Schema.String,
  taskId: Schema.String,
  status: CollaborationStatus,
  thinkingVisible: Schema.Boolean, // Show reasoning in real-time
  streamingEnabled: Schema.Boolean, // Stream thoughts
  questionStyle: QuestionStyle,
  rollbackEnabled: Schema.Boolean, // Allow undo
  startedAt: Schema.DateFromSelf,
  endedAt: Schema.optional(Schema.DateFromSelf),
});
export type CollaborationSession = typeof CollaborationSessionSchema.Type;

// ─── Collaboration Message ───

export const CollaborationMessageType = Schema.Literal(
  "thought", // Agent's visible reasoning
  "question", // Agent asking user
  "answer", // User answering agent
  "suggestion", // Agent inline suggestion
  "update", // Progress update
  "action", // Agent/user action
);
export type CollaborationMessageType = typeof CollaborationMessageType.Type;

export const CollaborationMessageSchema = Schema.Struct({
  id: Schema.String,
  sessionId: SessionId,
  type: CollaborationMessageType,
  sender: Schema.Literal("agent", "user"),
  content: Schema.String,
  timestamp: Schema.DateFromSelf,
});
export type CollaborationMessage = typeof CollaborationMessageSchema.Type;
```

### File: `src/types/preference.ts`

```typescript
// File: src/types/preference.ts
import { Schema } from "effect";

// ─── Approval Pattern (learned from user behavior) ───

export const ApprovalAction = Schema.Literal(
  "auto-approve",
  "auto-reject",
  "ask",
);
export type ApprovalAction = typeof ApprovalAction.Type;

export const ApprovalPatternSchema = Schema.Struct({
  id: Schema.String,
  taskType: Schema.String,
  costThreshold: Schema.optional(Schema.Number), // Auto-approve under this cost
  action: ApprovalAction,
  confidence: Schema.Number, // 0-1: how confident in this pattern
  occurrences: Schema.Number, // Times this pattern was observed
  lastSeen: Schema.DateFromSelf,
});
export type ApprovalPattern = typeof ApprovalPatternSchema.Type;

// ─── User Preference ───

export const InterruptionTolerance = Schema.Literal("low", "medium", "high");
export type InterruptionTolerance = typeof InterruptionTolerance.Type;

export const UserPreferenceSchema = Schema.Struct({
  userId: Schema.String,
  learningEnabled: Schema.Boolean,
  interruptionTolerance: InterruptionTolerance,
  preferredMode: Schema.optional(Schema.String),
  approvalPatterns: Schema.Array(ApprovalPatternSchema),
  lastUpdated: Schema.DateFromSelf,
});
export type UserPreference = typeof UserPreferenceSchema.Type;
```

### File: `src/types/config.ts`

```typescript
// File: src/types/config.ts
import { Schema } from "effect";
import { InteractionModeType } from "./mode.js";
import { CheckpointConfigSchema } from "./checkpoint.js";
import { ReportingConfigSchema } from "./notification.js";
import { InterruptRuleSchema } from "./interrupt.js";

// ─── Escalation / De-escalation rules ───

export const EscalationConditionType = Schema.Literal(
  "uncertainty", // confidence below threshold
  "cost", // cost above threshold
  "duration", // running longer than threshold
  "user-active", // user is actively engaged
  "confidence", // agent confidence above threshold (for de-escalation)
  "consecutive-approvals", // user approved N times in a row
);
export type EscalationConditionType = typeof EscalationConditionType.Type;

export const EscalationConditionSchema = Schema.Struct({
  type: EscalationConditionType,
  threshold: Schema.Number,
});
export type EscalationCondition = typeof EscalationConditionSchema.Type;

export const ModeTransitionRuleSchema = Schema.Struct({
  from: InteractionModeType,
  to: InteractionModeType,
  conditions: Schema.Array(EscalationConditionSchema),
});
export type ModeTransitionRule = typeof ModeTransitionRuleSchema.Type;

// ─── Full Interaction Config ───

export const InteractionConfigSchema = Schema.Struct({
  defaultMode: InteractionModeType,
  interruptRules: Schema.Array(InterruptRuleSchema),
  reporting: ReportingConfigSchema,
  checkpoints: Schema.optional(CheckpointConfigSchema),
  escalationRules: Schema.Array(ModeTransitionRuleSchema),
  deescalationRules: Schema.Array(ModeTransitionRuleSchema),
  learningEnabled: Schema.Boolean,
});
export type InteractionConfig = typeof InteractionConfigSchema.Type;

// ─── Default Config ───

export const defaultInteractionConfig: InteractionConfig = {
  defaultMode: "autonomous",
  interruptRules: [
    { trigger: "error", severity: "high", enabled: true },
    {
      trigger: "uncertainty",
      severity: "medium",
      threshold: 0.3,
      enabled: true,
    },
    {
      trigger: "high-cost",
      severity: "medium",
      threshold: 10.0,
      enabled: true,
    },
    { trigger: "critical-decision", severity: "critical", enabled: true },
  ],
  reporting: {
    frequency: "milestone",
    channel: "event-bus",
    detail: "summary",
    streaming: false,
  },
  escalationRules: [
    {
      from: "autonomous",
      to: "supervised",
      conditions: [{ type: "uncertainty", threshold: 0.3 }],
    },
    {
      from: "supervised",
      to: "collaborative",
      conditions: [
        { type: "uncertainty", threshold: 0.5 },
        { type: "user-active", threshold: 1 },
      ],
    },
  ],
  deescalationRules: [
    {
      from: "collaborative",
      to: "autonomous",
      conditions: [
        { type: "confidence", threshold: 0.9 },
        { type: "consecutive-approvals", threshold: 3 },
      ],
    },
  ],
  learningEnabled: true,
};
```

---

## Error Types

### File: `src/errors/errors.ts`

```typescript
// File: src/errors/errors.ts
import { Data } from "effect";

// ─── Base interaction error ───
export class InteractionError extends Data.TaggedError("InteractionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Invalid mode transition ───
export class ModeTransitionError extends Data.TaggedError(
  "ModeTransitionError",
)<{
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}> {}

// ─── Checkpoint operation failed ───
export class CheckpointError extends Data.TaggedError("CheckpointError")<{
  readonly checkpointId: string;
  readonly message: string;
}> {}

// ─── No active session ───
export class SessionNotFoundError extends Data.TaggedError(
  "SessionNotFoundError",
)<{
  readonly sessionId: string;
}> {}

// ─── Notification delivery failed ───
export class NotificationError extends Data.TaggedError("NotificationError")<{
  readonly channel: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── User input timeout ───
export class InputTimeoutError extends Data.TaggedError("InputTimeoutError")<{
  readonly timeoutMs: number;
  readonly message: string;
}> {}

// ─── Union type ───
export type InteractionErrors =
  | InteractionError
  | ModeTransitionError
  | CheckpointError
  | SessionNotFoundError
  | NotificationError
  | InputTimeoutError;
```

---

## Services

### File: `src/services/notification-service.ts`

```typescript
// File: src/services/notification-service.ts
import { Context, Effect, Layer, Ref } from "effect";
import { ulid } from "ulid";
import type {
  Notification,
  NotificationChannel,
  NotificationPriority,
} from "../types/notification.js";
import { NotificationError } from "../errors/errors.js";
import { EventBus } from "@reactive-agents/core";

// ─── Service Tag ───

export class NotificationService extends Context.Tag("NotificationService")<
  NotificationService,
  {
    /** Send a notification to user via configured channel. */
    readonly send: (params: {
      readonly agentId: string;
      readonly channel: NotificationChannel;
      readonly priority: NotificationPriority;
      readonly title: string;
      readonly body: string;
      readonly data?: unknown;
    }) => Effect.Effect<Notification, NotificationError>;

    /** List unread notifications. */
    readonly listUnread: () => Effect.Effect<readonly Notification[]>;

    /** Mark a notification as read. */
    readonly markRead: (notificationId: string) => Effect.Effect<void>;
  }
>() {}

// ─── Live Layer ───

export const NotificationServiceLive = Layer.effect(
  NotificationService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const notificationsRef = yield* Ref.make<Map<string, Notification>>(
      new Map(),
    );

    return {
      send: (params) =>
        Effect.gen(function* () {
          const notification: Notification = {
            id: ulid(),
            agentId: params.agentId,
            channel: params.channel,
            priority: params.priority,
            title: params.title,
            body: params.body,
            data: params.data,
            createdAt: new Date(),
            readAt: undefined,
          };

          // Store notification
          yield* Ref.update(notificationsRef, (m) => {
            const next = new Map(m);
            next.set(notification.id, notification);
            return next;
          });

          // Emit via event bus for subscribers
          yield* eventBus.publish({
            type: "interaction.notification",
            payload: notification,
          });

          return notification;
        }),

      listUnread: () =>
        Ref.get(notificationsRef).pipe(
          Effect.map((m) =>
            Array.from(m.values()).filter((n) => n.readAt == null),
          ),
        ),

      markRead: (notificationId) =>
        Ref.update(notificationsRef, (m) => {
          const next = new Map(m);
          const n = next.get(notificationId);
          if (n) {
            next.set(notificationId, { ...n, readAt: new Date() });
          }
          return next;
        }),
    };
  }),
);
```

### File: `src/services/checkpoint-service.ts`

```typescript
// File: src/services/checkpoint-service.ts
import { Context, Effect, Layer, Ref } from "effect";
import { ulid } from "ulid";
import type {
  Checkpoint,
  CheckpointConfig,
  CheckpointStatus,
} from "../types/checkpoint.js";
import { CheckpointError, InputTimeoutError } from "../errors/errors.js";

// ─── Service Tag ───

export class CheckpointService extends Context.Tag("CheckpointService")<
  CheckpointService,
  {
    /** Create a checkpoint and wait for user resolution. */
    readonly create: (params: {
      readonly agentId: string;
      readonly taskId: string;
      readonly milestoneName: string;
      readonly description: string;
      readonly config: CheckpointConfig;
    }) => Effect.Effect<Checkpoint, CheckpointError | InputTimeoutError>;

    /** Resolve a pending checkpoint (approve, reject). */
    readonly resolve: (
      checkpointId: string,
      status: CheckpointStatus,
      comment?: string,
    ) => Effect.Effect<Checkpoint, CheckpointError>;

    /** List pending checkpoints for an agent. */
    readonly listPending: (
      agentId: string,
    ) => Effect.Effect<readonly Checkpoint[]>;
  }
>() {}

// ─── Live Layer ───

export const CheckpointServiceLive = Layer.effect(
  CheckpointService,
  Effect.gen(function* () {
    const checkpointsRef = yield* Ref.make<Map<string, Checkpoint>>(new Map());

    return {
      create: (params) =>
        Effect.gen(function* () {
          const checkpoint: Checkpoint = {
            id: ulid(),
            agentId: params.agentId,
            taskId: params.taskId,
            milestoneName: params.milestoneName,
            description: params.description,
            status: "pending",
            createdAt: new Date(),
            resolvedAt: undefined,
            userComment: undefined,
          };

          yield* Ref.update(checkpointsRef, (m) => {
            const next = new Map(m);
            next.set(checkpoint.id, checkpoint);
            return next;
          });

          // If auto-approve is enabled, schedule auto-resolution
          if (params.config.autoApprove.enabled) {
            // In real implementation, this would use Effect.schedule or a timer.
            // For spec purposes, auto-approve logic handled by ModeSwitcher.
          }

          return checkpoint;
        }),

      resolve: (checkpointId, status, comment) =>
        Effect.gen(function* () {
          const checkpoints = yield* Ref.get(checkpointsRef);
          const checkpoint = checkpoints.get(checkpointId);

          if (!checkpoint) {
            return yield* Effect.fail(
              new CheckpointError({
                checkpointId,
                message: `Checkpoint not found: ${checkpointId}`,
              }),
            );
          }

          const resolved: Checkpoint = {
            ...checkpoint,
            status,
            resolvedAt: new Date(),
            userComment: comment,
          };

          yield* Ref.update(checkpointsRef, (m) => {
            const next = new Map(m);
            next.set(checkpointId, resolved);
            return next;
          });

          return resolved;
        }),

      listPending: (agentId) =>
        Ref.get(checkpointsRef).pipe(
          Effect.map((m) =>
            Array.from(m.values()).filter(
              (c) => c.agentId === agentId && c.status === "pending",
            ),
          ),
        ),
    };
  }),
);
```

### File: `src/services/preference-learner.ts`

```typescript
// File: src/services/preference-learner.ts
import { Context, Effect, Layer, Ref } from "effect";
import { ulid } from "ulid";
import type {
  UserPreference,
  ApprovalPattern,
  ApprovalAction,
} from "../types/preference.js";

// ─── Service Tag ───

export class PreferenceLearner extends Context.Tag("PreferenceLearner")<
  PreferenceLearner,
  {
    /** Record a user interaction for learning. */
    readonly recordInteraction: (params: {
      readonly userId: string;
      readonly taskType: string;
      readonly cost: number;
      readonly userAction: ApprovalAction;
    }) => Effect.Effect<void>;

    /** Get learned preferences for a user. */
    readonly getPreferences: (
      userId: string,
    ) => Effect.Effect<UserPreference | null>;

    /** Check if a task should be auto-approved based on learned patterns. */
    readonly shouldAutoApprove: (params: {
      readonly userId: string;
      readonly taskType: string;
      readonly cost: number;
    }) => Effect.Effect<boolean>;
  }
>() {}

// ─── Live Layer ───

export const PreferenceLearnerLive = Layer.effect(
  PreferenceLearner,
  Effect.gen(function* () {
    const prefsRef = yield* Ref.make<Map<string, UserPreference>>(new Map());

    return {
      recordInteraction: (params) =>
        Ref.update(prefsRef, (prefs) => {
          const next = new Map(prefs);
          const existing = next.get(params.userId) ?? {
            userId: params.userId,
            learningEnabled: true,
            interruptionTolerance: "medium" as const,
            preferredMode: undefined,
            approvalPatterns: [],
            lastUpdated: new Date(),
          };

          // Find or create pattern for this taskType
          const patternIdx = existing.approvalPatterns.findIndex(
            (p) => p.taskType === params.taskType,
          );

          const updatedPatterns = [...existing.approvalPatterns];

          if (patternIdx >= 0) {
            const old = updatedPatterns[patternIdx];
            const n = old.occurrences;
            // Running average confidence: if user consistently does same action, confidence rises
            const sameAction = old.action === params.userAction;
            updatedPatterns[patternIdx] = {
              ...old,
              action: params.userAction,
              confidence: sameAction
                ? Math.min(1.0, (old.confidence * n + 1.0) / (n + 1))
                : Math.max(0.0, (old.confidence * n) / (n + 1)),
              costThreshold:
                params.userAction === "auto-approve"
                  ? Math.max(old.costThreshold ?? 0, params.cost)
                  : old.costThreshold,
              occurrences: n + 1,
              lastSeen: new Date(),
            };
          } else {
            updatedPatterns.push({
              id: ulid(),
              taskType: params.taskType,
              costThreshold:
                params.userAction === "auto-approve" ? params.cost : undefined,
              action: params.userAction,
              confidence: 0.5,
              occurrences: 1,
              lastSeen: new Date(),
            });
          }

          next.set(params.userId, {
            ...existing,
            approvalPatterns: updatedPatterns,
            lastUpdated: new Date(),
          });

          return next;
        }),

      getPreferences: (userId) =>
        Ref.get(prefsRef).pipe(Effect.map((m) => m.get(userId) ?? null)),

      shouldAutoApprove: (params) =>
        Ref.get(prefsRef).pipe(
          Effect.map((m) => {
            const pref = m.get(params.userId);
            if (!pref || !pref.learningEnabled) return false;

            const pattern = pref.approvalPatterns.find(
              (p) =>
                p.taskType === params.taskType &&
                p.action === "auto-approve" &&
                p.confidence >= 0.8 &&
                p.occurrences >= 3 &&
                (p.costThreshold == null || params.cost <= p.costThreshold),
            );

            return pattern != null;
          }),
        ),
    };
  }),
);
```

### File: `src/services/collaboration-service.ts`

```typescript
// File: src/services/collaboration-service.ts
import { Context, Effect, Layer, Ref } from "effect";
import { ulid } from "ulid";
import type {
  CollaborationSession,
  CollaborationMessage,
  CollaborationMessageType,
} from "../types/collaboration.js";
import type { SessionId } from "../types/mode.js";
import { SessionNotFoundError } from "../errors/errors.js";
import { EventBus } from "@reactive-agents/core";

// ─── Service Tag ───

export class CollaborationService extends Context.Tag("CollaborationService")<
  CollaborationService,
  {
    /** Start a new collaboration session. */
    readonly startSession: (params: {
      readonly agentId: string;
      readonly taskId: string;
      readonly thinkingVisible: boolean;
      readonly streamingEnabled: boolean;
    }) => Effect.Effect<CollaborationSession>;

    /** End a collaboration session. */
    readonly endSession: (
      sessionId: SessionId,
    ) => Effect.Effect<void, SessionNotFoundError>;

    /** Send a message in a collaboration session. */
    readonly sendMessage: (params: {
      readonly sessionId: SessionId;
      readonly type: CollaborationMessageType;
      readonly sender: "agent" | "user";
      readonly content: string;
    }) => Effect.Effect<CollaborationMessage, SessionNotFoundError>;

    /** Get messages for a session. */
    readonly getMessages: (
      sessionId: SessionId,
    ) => Effect.Effect<readonly CollaborationMessage[], SessionNotFoundError>;

    /** Get active session for an agent. */
    readonly getActiveSession: (
      agentId: string,
    ) => Effect.Effect<CollaborationSession | null>;
  }
>() {}

// ─── Live Layer ───

export const CollaborationServiceLive = Layer.effect(
  CollaborationService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const sessionsRef = yield* Ref.make<Map<string, CollaborationSession>>(
      new Map(),
    );
    const messagesRef = yield* Ref.make<Map<string, CollaborationMessage[]>>(
      new Map(),
    );

    return {
      startSession: (params) =>
        Effect.gen(function* () {
          const session: CollaborationSession = {
            id: ulid() as SessionId,
            agentId: params.agentId,
            taskId: params.taskId,
            status: "active",
            thinkingVisible: params.thinkingVisible,
            streamingEnabled: params.streamingEnabled,
            questionStyle: "inline",
            rollbackEnabled: true,
            startedAt: new Date(),
            endedAt: undefined,
          };

          yield* Ref.update(sessionsRef, (m) => {
            const next = new Map(m);
            next.set(session.id, session);
            return next;
          });

          yield* Ref.update(messagesRef, (m) => {
            const next = new Map(m);
            next.set(session.id, []);
            return next;
          });

          yield* eventBus.publish({
            type: "interaction.collaboration.started",
            payload: session,
          });

          return session;
        }),

      endSession: (sessionId) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          if (!sessions.has(sessionId)) {
            return yield* Effect.fail(new SessionNotFoundError({ sessionId }));
          }

          yield* Ref.update(sessionsRef, (m) => {
            const next = new Map(m);
            const session = next.get(sessionId)!;
            next.set(sessionId, {
              ...session,
              status: "ended",
              endedAt: new Date(),
            });
            return next;
          });
        }),

      sendMessage: (params) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          if (!sessions.has(params.sessionId)) {
            return yield* Effect.fail(
              new SessionNotFoundError({ sessionId: params.sessionId }),
            );
          }

          const message: CollaborationMessage = {
            id: ulid(),
            sessionId: params.sessionId,
            type: params.type,
            sender: params.sender,
            content: params.content,
            timestamp: new Date(),
          };

          yield* Ref.update(messagesRef, (m) => {
            const next = new Map(m);
            const existing = next.get(params.sessionId) ?? [];
            next.set(params.sessionId, [...existing, message]);
            return next;
          });

          yield* eventBus.publish({
            type: "interaction.collaboration.message",
            payload: message,
          });

          return message;
        }),

      getMessages: (sessionId) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          if (!sessions.has(sessionId)) {
            return yield* Effect.fail(new SessionNotFoundError({ sessionId }));
          }
          const msgs = yield* Ref.get(messagesRef);
          return msgs.get(sessionId) ?? [];
        }),

      getActiveSession: (agentId) =>
        Ref.get(sessionsRef).pipe(
          Effect.map((m) => {
            for (const session of m.values()) {
              if (session.agentId === agentId && session.status === "active") {
                return session;
              }
            }
            return null;
          }),
        ),
    };
  }),
);
```

### File: `src/services/mode-switcher.ts`

```typescript
// File: src/services/mode-switcher.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { InteractionModeType, SessionId } from "../types/mode.js";
import type { InteractionConfig } from "../types/config.js";
import { defaultInteractionConfig } from "../types/config.js";
import { ModeTransitionError } from "../errors/errors.js";
import { EventBus } from "@reactive-agents/core";

// ─── Service Tag ───

export class ModeSwitcher extends Context.Tag("ModeSwitcher")<
  ModeSwitcher,
  {
    /** Get the current interaction mode for an agent. */
    readonly getCurrentMode: (
      agentId: string,
    ) => Effect.Effect<InteractionModeType>;

    /** Manually switch interaction mode. */
    readonly switchMode: (
      agentId: string,
      targetMode: InteractionModeType,
    ) => Effect.Effect<void, ModeTransitionError>;

    /** Evaluate escalation/de-escalation rules and switch if warranted. */
    readonly evaluateTransition: (params: {
      readonly agentId: string;
      readonly confidence: number;
      readonly cost: number;
      readonly durationMs: number;
      readonly userActive: boolean;
      readonly consecutiveApprovals: number;
    }) => Effect.Effect<InteractionModeType>;
  }
>() {}

// ─── Live Layer ───

export const ModeSwitcherLive = (
  config: InteractionConfig = defaultInteractionConfig,
) =>
  Layer.effect(
    ModeSwitcher,
    Effect.gen(function* () {
      const eventBus = yield* EventBus;
      // Track current mode per agent
      const modesRef = yield* Ref.make<Map<string, InteractionModeType>>(
        new Map(),
      );

      return {
        getCurrentMode: (agentId) =>
          Ref.get(modesRef).pipe(
            Effect.map((m) => m.get(agentId) ?? config.defaultMode),
          ),

        switchMode: (agentId, targetMode) =>
          Effect.gen(function* () {
            const currentMode = yield* Ref.get(modesRef).pipe(
              Effect.map((m) => m.get(agentId) ?? config.defaultMode),
            );

            if (currentMode === targetMode) return;

            // All 5 modes support direct manual switching.

            yield* Ref.update(modesRef, (m) => {
              const next = new Map(m);
              next.set(agentId, targetMode);
              return next;
            });

            yield* eventBus.publish({
              type: "interaction.mode.switched",
              payload: { agentId, from: currentMode, to: targetMode },
            });
          }),

        evaluateTransition: (params) =>
          Effect.gen(function* () {
            const currentMode = yield* Ref.get(modesRef).pipe(
              Effect.map((m) => m.get(params.agentId) ?? config.defaultMode),
            );

            // Check escalation rules
            for (const rule of config.escalationRules) {
              if (rule.from !== currentMode) continue;

              const allMet = rule.conditions.every((cond) => {
                switch (cond.type) {
                  case "uncertainty":
                    return 1 - params.confidence >= cond.threshold;
                  case "cost":
                    return params.cost >= cond.threshold;
                  case "duration":
                    return params.durationMs >= cond.threshold;
                  case "user-active":
                    return params.userActive === cond.threshold > 0;
                  default:
                    return false;
                }
              });

              if (allMet) {
                yield* Ref.update(modesRef, (m) => {
                  const next = new Map(m);
                  next.set(params.agentId, rule.to);
                  return next;
                });

                yield* eventBus.publish({
                  type: "interaction.mode.escalated",
                  payload: {
                    agentId: params.agentId,
                    from: currentMode,
                    to: rule.to,
                  },
                });

                return rule.to;
              }
            }

            // Check de-escalation rules
            for (const rule of config.deescalationRules) {
              if (rule.from !== currentMode) continue;

              const allMet = rule.conditions.every((cond) => {
                switch (cond.type) {
                  case "confidence":
                    return params.confidence >= cond.threshold;
                  case "consecutive-approvals":
                    return params.consecutiveApprovals >= cond.threshold;
                  case "user-active":
                    return params.userActive === cond.threshold > 0;
                  default:
                    return false;
                }
              });

              if (allMet) {
                yield* Ref.update(modesRef, (m) => {
                  const next = new Map(m);
                  next.set(params.agentId, rule.to);
                  return next;
                });

                yield* eventBus.publish({
                  type: "interaction.mode.deescalated",
                  payload: {
                    agentId: params.agentId,
                    from: currentMode,
                    to: rule.to,
                  },
                });

                return rule.to;
              }
            }

            // No transition triggered
            return currentMode;
          }),
      };
    }),
  );
```

### File: `src/services/interaction-manager.ts`

```typescript
// File: src/services/interaction-manager.ts
import { Context, Effect, Layer } from "effect";
import type { InteractionModeType, SessionId } from "../types/mode.js";
import type { InteractionConfig } from "../types/config.js";
import { defaultInteractionConfig } from "../types/config.js";
import type {
  Notification,
  NotificationChannel,
  NotificationPriority,
} from "../types/notification.js";
import type {
  Checkpoint,
  CheckpointConfig,
  CheckpointStatus,
} from "../types/checkpoint.js";
import type { CollaborationSession } from "../types/collaboration.js";
import type { InteractionErrors } from "../errors/errors.js";
import { ModeSwitcher } from "./mode-switcher.js";
import { NotificationService } from "./notification-service.js";
import { CheckpointService } from "./checkpoint-service.js";
import { CollaborationService } from "./collaboration-service.js";
import { PreferenceLearner } from "./preference-learner.js";

// ─── Service Tag ───

export class InteractionManager extends Context.Tag("InteractionManager")<
  InteractionManager,
  {
    /** Get current interaction mode for an agent. */
    readonly getMode: (agentId: string) => Effect.Effect<InteractionModeType>;

    /** Switch mode manually. */
    readonly switchMode: (
      agentId: string,
      mode: InteractionModeType,
    ) => Effect.Effect<void, InteractionErrors>;

    /** Notify the user. */
    readonly notify: (params: {
      readonly agentId: string;
      readonly channel: NotificationChannel;
      readonly priority: NotificationPriority;
      readonly title: string;
      readonly body: string;
    }) => Effect.Effect<Notification, InteractionErrors>;

    /** Create a checkpoint (supervised mode). */
    readonly checkpoint: (params: {
      readonly agentId: string;
      readonly taskId: string;
      readonly milestoneName: string;
      readonly description: string;
    }) => Effect.Effect<Checkpoint, InteractionErrors>;

    /** Resolve a checkpoint. */
    readonly resolveCheckpoint: (
      checkpointId: string,
      status: CheckpointStatus,
      comment?: string,
    ) => Effect.Effect<Checkpoint, InteractionErrors>;

    /** Start a collaboration session. */
    readonly startCollaboration: (params: {
      readonly agentId: string;
      readonly taskId: string;
    }) => Effect.Effect<CollaborationSession, InteractionErrors>;

    /** Evaluate whether mode should change based on current context. */
    readonly evaluateMode: (params: {
      readonly agentId: string;
      readonly confidence: number;
      readonly cost: number;
      readonly durationMs: number;
      readonly userActive: boolean;
      readonly consecutiveApprovals: number;
    }) => Effect.Effect<InteractionModeType>;
  }
>() {}

// ─── Live Layer ───

export const InteractionManagerLive = (
  config: InteractionConfig = defaultInteractionConfig,
) =>
  Layer.effect(
    InteractionManager,
    Effect.gen(function* () {
      const modeSwitcher = yield* ModeSwitcher;
      const notifications = yield* NotificationService;
      const checkpoints = yield* CheckpointService;
      const collaboration = yield* CollaborationService;
      const learner = yield* PreferenceLearner;

      return {
        getMode: (agentId) => modeSwitcher.getCurrentMode(agentId),

        switchMode: (agentId, mode) => modeSwitcher.switchMode(agentId, mode),

        notify: (params) => notifications.send({ ...params, data: undefined }),

        checkpoint: (params) =>
          checkpoints.create({
            ...params,
            config: config.checkpoints ?? {
              frequency: "milestone",
              autoApprove: {
                enabled: true,
                timeoutMs: 3600000,
                defaultAction: "approve",
              },
            },
          }),

        resolveCheckpoint: (checkpointId, status, comment) =>
          checkpoints.resolve(checkpointId, status, comment),

        startCollaboration: (params) =>
          collaboration.startSession({
            ...params,
            thinkingVisible: true,
            streamingEnabled: config.reporting.streaming,
          }),

        evaluateMode: (params) => modeSwitcher.evaluateTransition(params),
      };
    }),
  );
```

---

## Runtime Layer

### File: `src/runtime.ts`

```typescript
// File: src/runtime.ts
import { Layer } from "effect";
import type { InteractionConfig } from "./types/config.js";
import { defaultInteractionConfig } from "./types/config.js";
import { NotificationServiceLive } from "./services/notification-service.js";
import { CheckpointServiceLive } from "./services/checkpoint-service.js";
import { PreferenceLearnerLive } from "./services/preference-learner.js";
import { CollaborationServiceLive } from "./services/collaboration-service.js";
import { ModeSwitcherLive } from "./services/mode-switcher.js";
import { InteractionManagerLive } from "./services/interaction-manager.js";

/**
 * Create the full Interaction layer.
 *
 * Provides: InteractionManager, ModeSwitcher, NotificationService,
 *           CheckpointService, CollaborationService, PreferenceLearner
 * Requires: EventBus (from Layer 1 Core)
 *
 * Usage:
 *   const InteractionLive = createInteractionLayer();
 *   const program = myEffect.pipe(
 *     Effect.provide(InteractionLive),
 *     Effect.provide(CoreServicesLive)
 *   );
 */
export const createInteractionLayer = (
  config: InteractionConfig = defaultInteractionConfig,
) => {
  // Leaf services (depend only on EventBus from L1 Core)
  const NotificationLayer = NotificationServiceLive;
  const CheckpointLayer = CheckpointServiceLive;
  const PreferenceLayer = PreferenceLearnerLive;
  const CollaborationLayer = CollaborationServiceLive;

  // ModeSwitcher depends on EventBus
  const SwitcherLayer = ModeSwitcherLive(config);

  // InteractionManager orchestrates everything
  const ManagerLayer = InteractionManagerLive(config).pipe(
    Layer.provide(
      Layer.mergeAll(
        SwitcherLayer,
        NotificationLayer,
        CheckpointLayer,
        CollaborationLayer,
        PreferenceLayer,
      ),
    ),
  );

  return Layer.mergeAll(
    ManagerLayer,
    SwitcherLayer,
    NotificationLayer,
    CheckpointLayer,
    CollaborationLayer,
    PreferenceLayer,
  );
};
```

---

## Public API

### File: `src/index.ts`

```typescript
// File: src/index.ts

// ─── Types ───
export type {
  InteractionModeType,
  SessionId,
  InteractionMode,
} from "./types/mode.js";

export type {
  InterruptTrigger,
  InterruptSeverity,
  InterruptRule,
  InterruptEvent,
} from "./types/interrupt.js";

export type {
  CheckpointStatus,
  Checkpoint,
  CheckpointFrequency,
  AutoApproveAction,
  CheckpointConfig,
} from "./types/checkpoint.js";

export type {
  NotificationChannel,
  NotificationPriority,
  Notification,
  ReportingFrequency,
  ReportingDetailLevel,
  ReportingConfig,
} from "./types/notification.js";

export type {
  CollaborationStatus,
  QuestionStyle,
  CollaborationSession,
  CollaborationMessageType,
  CollaborationMessage,
} from "./types/collaboration.js";

export type {
  ApprovalAction,
  ApprovalPattern,
  InterruptionTolerance,
  UserPreference,
} from "./types/preference.js";

export type {
  InteractionConfig,
  EscalationConditionType,
  EscalationCondition,
  ModeTransitionRule,
} from "./types/config.js";

// ─── Schemas ───
export {
  InteractionModeType,
  SessionId,
  InteractionModeSchema,
} from "./types/mode.js";

export {
  InterruptTrigger,
  InterruptSeverity,
  InterruptRuleSchema,
  InterruptEventSchema,
} from "./types/interrupt.js";

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
  InteractionConfigSchema,
  EscalationConditionType,
  EscalationConditionSchema,
  ModeTransitionRuleSchema,
  defaultInteractionConfig,
} from "./types/config.js";

// ─── Errors ───
export {
  InteractionError,
  ModeTransitionError,
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
```

---

## Testing

### File: `tests/mode-switcher.test.ts`

```typescript
// File: tests/mode-switcher.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ModeSwitcher,
  ModeSwitcherLive,
} from "../src/services/mode-switcher.js";
import { EventBus } from "@reactive-agents/core";
import { defaultInteractionConfig } from "../src/types/config.js";

// ─── Mock EventBus ───
const MockEventBus = Layer.succeed(EventBus, {
  publish: () => Effect.void,
  subscribe: () => Effect.void,
} as any);

const TestLayer = ModeSwitcherLive(defaultInteractionConfig).pipe(
  Layer.provide(MockEventBus),
);

describe("ModeSwitcher", () => {
  it("should return default mode for unknown agent", async () => {
    const program = Effect.gen(function* () {
      const switcher = yield* ModeSwitcher;
      const mode = yield* switcher.getCurrentMode("agent-1");
      expect(mode).toBe("autonomous");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should switch mode manually", async () => {
    const program = Effect.gen(function* () {
      const switcher = yield* ModeSwitcher;
      yield* switcher.switchMode("agent-1", "collaborative");
      const mode = yield* switcher.getCurrentMode("agent-1");
      expect(mode).toBe("collaborative");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should escalate when uncertainty is high", async () => {
    const program = Effect.gen(function* () {
      const switcher = yield* ModeSwitcher;
      const newMode = yield* switcher.evaluateTransition({
        agentId: "agent-1",
        confidence: 0.5, // uncertainty = 0.5 >= threshold 0.3
        cost: 0,
        durationMs: 0,
        userActive: false,
        consecutiveApprovals: 0,
      });
      expect(newMode).toBe("supervised");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });
});
```

### File: `tests/preference-learner.test.ts`

```typescript
// File: tests/preference-learner.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  PreferenceLearner,
  PreferenceLearnerLive,
} from "../src/services/preference-learner.js";

describe("PreferenceLearner", () => {
  it("should learn auto-approve patterns after repeated approvals", async () => {
    const program = Effect.gen(function* () {
      const learner = yield* PreferenceLearner;

      // Record 4 auto-approvals for research tasks under $10
      for (let i = 0; i < 4; i++) {
        yield* learner.recordInteraction({
          userId: "user-1",
          taskType: "research",
          cost: 5.0,
          userAction: "auto-approve",
        });
      }

      // Should auto-approve a new research task under $10
      const shouldApprove = yield* learner.shouldAutoApprove({
        userId: "user-1",
        taskType: "research",
        cost: 8.0,
      });
      expect(shouldApprove).toBe(true);

      // Should NOT auto-approve a different task type
      const shouldApproveDiff = yield* learner.shouldAutoApprove({
        userId: "user-1",
        taskType: "deployment",
        cost: 5.0,
      });
      expect(shouldApproveDiff).toBe(false);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(PreferenceLearnerLive)),
    );
  });
});
```

---

## Package Configuration

### File: `package.json`

```json
{
  "name": "@reactive-agents/interaction",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/bun": "latest"
  },
  "scripts": {
    "test": "bun test",
    "build": "bun build src/index.ts --outdir dist",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## Performance Targets

| Operation             | Target | Notes            |
| --------------------- | ------ | ---------------- |
| Mode switch           | <5ms   | Ref.update       |
| Notification send     | <10ms  | EventBus publish |
| Checkpoint create     | <5ms   | Ref.update       |
| Checkpoint resolve    | <5ms   | Ref.update       |
| Preference lookup     | <2ms   | In-memory Ref    |
| Escalation evaluation | <5ms   | Rule matching    |
| Collaboration message | <10ms  | Ref + EventBus   |

---

## Success Criteria

- [x] All 5 interaction modes (autonomous, supervised, collaborative, consultative, interrogative) represented with proper schema types
- [ ] InteractionManager, ModeSwitcher, CheckpointService, NotificationService, CollaborationService, PreferenceLearner as Context.Tag + Layer.effect
- [ ] Adaptive mode switching evaluates escalation/de-escalation rules correctly
- [ ] PreferenceLearner accumulates patterns and auto-approves after sufficient confidence
- [ ] Context preserved across mode transitions via Ref state
- [ ] EventBus integration for real-time notifications
- [ ] All types defined with Schema (not plain interfaces)
- [ ] All errors defined with Data.TaggedError
- [ ] All tests pass with >80% coverage

---

## Dependencies

**Requires:**

- Layer 1 (Core): EventBus, AgentId, TaskId
- Layer 3 (Reasoning): ReasoningResult metadata for confidence-based escalation
- Layer 9 (Observability): Trace context for interaction events

**Provides to:**

- Layer 7 (Orchestration): Interaction mode awareness for multi-agent coordination
- External consumers: SDK users configure interaction modes per agent

---

**Status: Implementation-Ready**
**Phase 1C:** Autonomous mode only (Week 4)
**Phase 3:** All 5 modes + adaptive switching (Weeks 13-14)
