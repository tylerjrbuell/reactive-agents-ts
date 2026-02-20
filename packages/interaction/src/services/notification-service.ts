// File: src/services/notification-service.ts
import { Context, Effect, Layer, Ref } from "effect";
import { ulid } from "ulid";
import type {
  Notification,
  NotificationChannel,
  NotificationPriority,
} from "../types/notification.js";
import type { NotificationError } from "../errors/errors.js";
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
            _tag: "Custom",
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
