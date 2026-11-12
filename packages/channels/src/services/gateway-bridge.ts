import { Effect } from "effect";
import type {
  IngressChannelRoute,
  ScheduleRegistryService,
  ScheduleDeliveryErrorKind,
  ScheduleDeliveryRecord,
  ScheduleDeliveryTarget,
} from "@reactive-agents/gateway";

/**
 * Compile-time pin: the gateway's delivery error vocabulary and `ChannelErrorKind` are the same
 * set. Adding a kind on either side without the other fails the typecheck here.
 */
type SameSet<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const DELIVERY_KINDS_MATCH: SameSet<ChannelErrorKind, ScheduleDeliveryErrorKind> = true;
import type { ChannelError, ChannelErrorKind } from "../errors.js";
import type { ChannelService } from "./channel-service.js";

/** A canonical adapter that takes inbound updates over HTTP (`TelegramChannelAdapter` in webhook mode). */
export interface WebhookIngestAdapter {
  readonly id: string;
  handleWebhook(req: {
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
  }): Effect.Effect<void, ChannelError>;
}

/**
 * Mount a webhook-capable adapter on the gateway ingress server:
 * `startIngress({ channelRoutes: [channelWebhookRoute("/channels/telegram", adapter)], ... })`.
 * The adapter verifies its own secret and fails closed; ingress adds the body cap and loopback bind.
 */
export const channelWebhookRoute = (path: string, adapter: WebhookIngestAdapter): IngressChannelRoute => ({
  path,
  id: adapter.id,
  handle: (req) => adapter.handleWebhook(req),
});

/**
 * Deliver a schedule run's result through `ChannelService.deliver` and record the typed outcome on
 * the run (`lastRun.delivery`): the platform's real message id on success, the error kind on
 * failure. Returns undefined when the schedule has no delivery target. A failed send is recorded
 * and reported by `ChannelService` (`ChannelDeliveryFailed` event), never thrown away.
 */
export const deliverScheduleResult = (
  channels: Pick<ChannelService, "deliver">,
  registry: Pick<ScheduleRegistryService, "recordDelivery">,
  run: {
    readonly scheduleId: string;
    readonly fireId: string;
    readonly delivery?: ScheduleDeliveryTarget | undefined;
  },
  text: string,
) => {
  const target = run.delivery;
  if (!target) return Effect.succeed<ScheduleDeliveryRecord | undefined>(undefined);
  return channels.deliver(target.adapterId, { conversation: { channelId: target.conversationId }, text }).pipe(
    Effect.map(
      (r): ScheduleDeliveryRecord => ({
        status: "delivered",
        messageId: r.messageId,
        adapterId: r.adapterId,
        receiptStatus: r.status,
      }),
    ),
    Effect.catchAll((e) =>
      Effect.succeed<ScheduleDeliveryRecord>({
        status: "failed",
        error: e.kind,
        adapterId: e.adapter,
        errorKind: e.kind,
        retryable: e.retryable,
      }),
    ),
    Effect.tap((record) => registry.recordDelivery(run.scheduleId, run.fireId, record)),
  );
};
