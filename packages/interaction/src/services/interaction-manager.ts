import { Context, Effect, Layer, Ref } from "effect";
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

// ─── Approval Gate Types ───

export interface ApprovalResult {
  readonly approved: boolean;
  readonly reason?: string;
  readonly timedOut?: boolean;
}

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

    // ─── Approval Gate (supervised mode) ───
    readonly approvalGate: (
      action: string,
      timeoutMs?: number,
    ) => Effect.Effect<ApprovalResult, never>;
    readonly resolveApproval: (
      gateId: string,
      approved: boolean,
      reason?: string,
    ) => Effect.Effect<boolean, never>;
  }
>() {}

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export const InteractionManagerLive = Layer.effect(
  InteractionManager,
  Effect.gen(function* () {
    const modeSwitcher = yield* ModeSwitcher;
    const notifications = yield* NotificationService;
    const checkpoints = yield* CheckpointService;
    const collaboration = yield* CollaborationService;
    const preferences = yield* PreferenceLearner;
    const eventBus = yield* EventBus;

    // ─── Approval gate state ───
    const pendingApprovals = yield* Ref.make<Map<string, (result: ApprovalResult) => void>>(
      new Map(),
    );

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

      // ─── Approval Gate ───
      approvalGate: (action: string, timeoutMs: number = DEFAULT_APPROVAL_TIMEOUT_MS) =>
        Effect.gen(function* () {
          const gateId = crypto.randomUUID();

          // Publish the approval-requested event so external systems can react
          yield* eventBus.publish({
            _tag: "Custom",
            type: "approval-requested",
            payload: { gateId, action },
          });

          // Await resolution from an external resolver or timeout
          const approvalEffect = Effect.async<ApprovalResult>((resume) => {
            // Register the resolver synchronously (Effect.runSync is safe here
            // because Ref.update is purely synchronous)
            Effect.runSync(
              Ref.update(pendingApprovals, (m) => {
                const next = new Map(m);
                next.set(gateId, (r) => resume(Effect.succeed(r)));
                return next;
              }),
            );

            // Return cleanup: remove the resolver if the async fiber is interrupted
            return Effect.sync(() => {
              Effect.runSync(
                Ref.update(pendingApprovals, (m) => {
                  const next = new Map(m);
                  next.delete(gateId);
                  return next;
                }),
              );
            });
          });

          const timeoutResult: ApprovalResult = {
            approved: false,
            timedOut: true,
            reason: "Approval timed out",
          };

          const result = yield* approvalEffect.pipe(
            Effect.timeout(timeoutMs),
            Effect.map((opt) =>
              // Effect.timeout wraps in Option when using milliseconds
              opt === undefined ? timeoutResult : opt,
            ),
            Effect.catchAll(() => Effect.succeed(timeoutResult)),
          );

          // Clean up resolver if still present (e.g. after timeout)
          yield* Ref.update(pendingApprovals, (m) => {
            const next = new Map(m);
            next.delete(gateId);
            return next;
          });

          return result;
        }),

      resolveApproval: (gateId: string, approved: boolean, reason?: string) =>
        Effect.gen(function* () {
          const approvals = yield* Ref.get(pendingApprovals);
          const resolver = approvals.get(gateId);
          if (resolver) {
            resolver({ approved, reason });
            yield* Ref.update(pendingApprovals, (m) => {
              const next = new Map(m);
              next.delete(gateId);
              return next;
            });
            return true;
          }
          return false;
        }),
    };
  }),
);
