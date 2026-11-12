/**
 * The recent-activity feed of a running gateway agent, folded from its event stream.
 *
 * Counters and queue depth are NOT here: the framework reports them (`agent.channelStatus()`,
 * `agent.gatewayStatus().inboundQueue`, read in `gateway-channel-host.ts`). What it has no accessor
 * for is the history, so {@link GatewayEventTracker} keeps a bounded activity list and the number of
 * refused senders from the events. Pure: no I/O, and the clock is injected, so a scripted event
 * list pins it (`gateway-status.test.ts`).
 *
 * Message text is never kept: an inbound message can carry anything its sender typed.
 */
import type { AgentEvent } from "@reactive-agents/core";

/** One line of the recent-activity list. */
export interface GatewayActivity {
  readonly at: number;
  readonly kind: "received" | "sent" | "failed" | "queued" | "deferred" | "dropped" | "denied" | "trigger";
  /** Channel (adapter) id, when the event names one. */
  readonly channelId?: string;
  /** Plain-words detail: the sender key, the failure kind, the policy. Never message text or a credential. */
  readonly detail: string;
}

/** A point-in-time copy of everything tracked. */
export interface GatewayTrackerSnapshot {
  /** Senders the access policy refused since hosting started. */
  readonly denied: number;
  /** Newest first. */
  readonly activity: readonly GatewayActivity[];
}

const ACTIVITY_LIMIT = 50;

/** The suppression policies the framework's inbound queue reports under. */
const QUEUE_KINDS: Readonly<Record<string, GatewayActivity["kind"]>> = {
  "inbound-queue:queued": "queued",
  "inbound-queue:deferred": "deferred",
  "inbound-queue:dropped": "dropped",
};

/** Folds gateway events into an activity list; events that name only a platform are attributed through the constructor's lookup. */
export class GatewayEventTracker {
  private denied = 0;
  private activity: GatewayActivity[] = [];

  /** `platformToChannel`: which channel id owns a platform name (`telegram` to `ch-1a2b3c4d`), for events that carry only a platform. */
  constructor(
    private readonly platformToChannel: (platform: string) => string | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  private note(a: GatewayActivity): void {
    this.activity.push(a);
    if (this.activity.length > ACTIVITY_LIMIT) this.activity.splice(0, this.activity.length - ACTIVITY_LIMIT);
  }

  /** Fold one event; events the gateway view does not use are ignored. */
  observe(event: AgentEvent): void {
    switch (event._tag) {
      case "ChannelMessageReceived": {
        const channelId = event.adapterId ?? this.platformToChannel(event.platform);
        this.note({ at: event.timestamp, kind: "received", ...(channelId ? { channelId } : {}), detail: `from ${event.platform}:${event.sender}` });
        return;
      }
      case "ChannelMessageSent": {
        const channelId = this.platformToChannel(event.platform);
        this.note({ at: event.timestamp, kind: "sent", ...(channelId ? { channelId } : {}), detail: `reply delivered (${event.platform})` });
        return;
      }
      case "ChannelDeliveryFailed": {
        this.note({ at: this.now(), kind: "failed", channelId: event.adapterId, detail: `${event.kind}${event.retryable ? ", retryable" : ""}` });
        return;
      }
      case "ProactiveActionSuppressed": {
        const kind = QUEUE_KINDS[event.policy];
        if (kind) {
          this.note({ at: event.timestamp, kind, detail: event.reason });
          return;
        }
        this.denied += 1;
        this.note({ at: event.timestamp, kind: "denied", detail: `${event.source}: ${event.reason}` });
        return;
      }
      case "TriggerFired": {
        this.note({ at: event.timestamp, kind: "trigger", detail: `${event.triggerName} (${event.platform})` });
        return;
      }
      default:
        return;
    }
  }

  snapshot(): GatewayTrackerSnapshot {
    return { denied: this.denied, activity: [...this.activity].reverse() };
  }
}
