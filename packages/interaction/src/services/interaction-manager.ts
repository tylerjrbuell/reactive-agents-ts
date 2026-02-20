import { Context, Effect, Layer } from "effect";
import type { InteractionModeType } from "../types/mode.js";
import type { SessionId } from "../types/mode.js";
import type {
  Notification,
  NotificationChannel,
  NotificationPriority,
} from "../types/notification.js";
import type { Checkpoint } from "../types/checkpoint.js";
import type { CollaborationSession, CollaborationMessage } from "../types/collaboration.js";
import type { UserPreference } from "../types/preference.js";
import type { InteractionErrors, CheckpointError, SessionNotFoundError } from "../errors/errors.js";
import { ModeSwitcher } from "./mode-switcher.js";
import { NotificationService } from "./notification-service.js";
import { CheckpointService } from "./checkpoint-service.js";
import { CollaborationService } from "./collaboration-service.js";
import { PreferenceLearner } from "./preference-learner.js";
import { EventBus } from "@reactive-agents/core";

export class InteractionManager extends Context.Tag("InteractionManager")<
  InteractionManager,
  {
    // ─── Mode management ───
    readonly getMode: (agentId: string) => Effect.Effect<InteractionModeType>;
    readonly switchMode: (
      agentId: string,
      mode: InteractionModeType,
    ) => Effect.Effect<void, InteractionErrors>;
    readonly evaluateTransition: (
      agentId: string,
      context: {
        confidence?: number;
        cost?: number;
        durationMs?: number;
        userActive?: boolean;
        consecutiveApprovals?: number;
      },
    ) => Effect.Effect<InteractionModeType | null>;

    // ─── Notifications ───
    readonly notify: (params: {
      readonly agentId: string;
      readonly channel: NotificationChannel;
      readonly priority: NotificationPriority;
      readonly title: string;
      readonly body: string;
    }) => Effect.Effect<Notification, InteractionErrors>;
    readonly listUnread: () => Effect.Effect<readonly Notification[]>;
    readonly markRead: (notificationId: string) => Effect.Effect<void>;

    // ─── Checkpoints (supervised mode) ───
    readonly createCheckpoint: (params: {
      agentId: string;
      taskId: string;
      milestoneName: string;
      description: string;
    }) => Effect.Effect<Checkpoint>;
    readonly resolveCheckpoint: (
      checkpointId: string,
      status: "approved" | "rejected",
      comment?: string,
    ) => Effect.Effect<Checkpoint, CheckpointError>;
    readonly listPendingCheckpoints: (
      agentId?: string,
    ) => Effect.Effect<readonly Checkpoint[]>;

    // ─── Collaboration (collaborative mode) ───
    readonly startCollaboration: (params: {
      agentId: string;
      taskId: string;
      thinkingVisible?: boolean;
    }) => Effect.Effect<CollaborationSession>;
    readonly endCollaboration: (
      sessionId: SessionId,
    ) => Effect.Effect<void, SessionNotFoundError>;
    readonly sendCollaborationMessage: (params: {
      sessionId: SessionId;
      type: CollaborationMessage["type"];
      sender: "agent" | "user";
      content: string;
    }) => Effect.Effect<CollaborationMessage, SessionNotFoundError>;

    // ─── Preferences ───
    readonly getPreference: (userId: string) => Effect.Effect<UserPreference>;
    readonly shouldAutoApprove: (params: {
      userId: string;
      taskType: string;
      cost?: number;
    }) => Effect.Effect<boolean>;
  }
>() {}

export const InteractionManagerLive = Layer.effect(
  InteractionManager,
  Effect.gen(function* () {
    const modeSwitcher = yield* ModeSwitcher;
    const notifications = yield* NotificationService;
    const checkpoints = yield* CheckpointService;
    const collaboration = yield* CollaborationService;
    const preferences = yield* PreferenceLearner;
    const eventBus = yield* EventBus;

    return {
      // Mode
      getMode: (agentId) => modeSwitcher.getMode(agentId),

      switchMode: (agentId, mode) =>
        Effect.gen(function* () {
          yield* modeSwitcher.setMode(agentId, mode);
          yield* eventBus.publish({
            _tag: "Custom",
            type: "interaction.mode-changed",
            payload: { agentId, mode },
          });
        }),

      evaluateTransition: (agentId, context) =>
        modeSwitcher.evaluateTransition(agentId, context),

      // Notifications
      notify: (params) => notifications.send({ ...params, data: undefined }),
      listUnread: () => notifications.listUnread(),
      markRead: (notificationId) => notifications.markRead(notificationId),

      // Checkpoints
      createCheckpoint: (params) => checkpoints.createCheckpoint(params),
      resolveCheckpoint: (id, status, comment) =>
        checkpoints.resolveCheckpoint(id, status, comment),
      listPendingCheckpoints: (agentId) => checkpoints.listPending(agentId),

      // Collaboration
      startCollaboration: (params) => collaboration.startSession(params),
      endCollaboration: (sessionId) => collaboration.endSession(sessionId),
      sendCollaborationMessage: (params) => collaboration.sendMessage(params),

      // Preferences
      getPreference: (userId) => preferences.getPreference(userId),
      shouldAutoApprove: (params) => preferences.shouldAutoApprove(params),
    };
  }),
);
