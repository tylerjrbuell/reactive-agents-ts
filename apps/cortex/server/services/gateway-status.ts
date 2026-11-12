/**
 * What a running gateway agent has done, folded from its event stream.
 *
 * The framework publishes channel traffic and the inbound queue as events but has no accessor
 * for either (`ChannelService.status()` is private to the gateway loop, and the queue reports
 * only through `ProactiveActionSuppressed`). {@link GatewayEventTracker} folds those events into
 * per-channel counters, a bounded activity list and queue counts. Pure: no clock, no I/O, so a
 * scripted event list pins it (`gateway-status.test.ts`).
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

/** Counters for one channel. */
export interface ChannelCounters {
  readonly received: number;
  readonly sent: number;
  readonly failed: number;
  readonly lastEventAt: number | null;
  /** Failure class of the latest failed delivery (`auth`, `rate_limited`, ...). */
  readonly lastFailure: string | null;
}

/** Inbound queue activity. `waiting` is not reported by the framework, so it is not here. */
export interface QueueCounts {
  readonly queued: number;
  readonly deferred: number;
  readonly dropped: number;
}

/** A point-in-time copy of everything tracked. */
export interface GatewayTrackerSnapshot {
  readonly channels: Readonly<Record<string, ChannelCounters>>;
  readonly queue: QueueCounts;
  readonly denied: number;
  readonly activity: readonly GatewayActivity[];
}

const ACTIVITY_LIMIT = 50;
const EMPTY: ChannelCounters = { received: 0, sent: 0, failed: 0, lastEventAt: null, lastFailure: null };

/** Folds gateway events into counters; events that name only a platform are attributed through the constructor's lookup. */
export class GatewayEventTracker {
  private channels = new Map<string, ChannelCounters>();
  private queue: QueueCounts = { queued: 0, deferred: 0, dropped: 0 };
  private denied = 0;
  private activity: GatewayActivity[] = [];

  /** `platformToChannel`: which channel id owns a platform name (`telegram` to `ch-1a2b3c4d`), for events that carry only a platform. */
  constructor(
    private readonly platformToChannel: (platform: string) => string | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  private bump(channelId: string | undefined, patch: Partial<ChannelCounters>, at: number): void {
    if (!channelId) return;
    const cur = this.channels.get(channelId) ?? EMPTY;
    this.channels.set(channelId, {
      received: cur.received + (patch.received ?? 0),
      sent: cur.sent + (patch.sent ?? 0),
      failed: cur.failed + (patch.failed ?? 0),
      lastEventAt: at,
      lastFailure: patch.lastFailure ?? cur.lastFailure,
    });
  }

  private note(a: GatewayActivity): void {
    this.activity.push(a);
    if (this.activity.length > ACTIVITY_LIMIT) this.activity.splice(0, this.activity.length - ACTIVITY_LIMIT);
  }

  /** Fold one event; events the gateway view does not use are ignored. */
  observe(event: AgentEvent): void {
    const at = this.now();
    switch (event._tag) {
      case "ChannelMessageReceived": {
        const channelId = event.adapterId ?? this.platformToChannel(event.platform);
        this.bump(channelId, { received: 1 }, at);
        this.note({ at: event.timestamp, kind: "received", ...(channelId ? { channelId } : {}), detail: `from ${event.platform}:${event.sender}` });
        return;
      }
      case "ChannelMessageSent": {
        const channelId = this.platformToChannel(event.platform);
        this.bump(channelId, { sent: 1 }, at);
        this.note({ at: event.timestamp, kind: "sent", ...(channelId ? { channelId } : {}), detail: `reply delivered (${event.platform})` });
        return;
      }
      case "ChannelDeliveryFailed": {
        this.bump(event.adapterId, { failed: 1, lastFailure: event.kind }, at);
        this.note({ at, kind: "failed", channelId: event.adapterId, detail: `${event.kind}${event.retryable ? ", retryable" : ""}` });
        return;
      }
      case "ProactiveActionSuppressed": {
        const policy = event.policy;
        if (policy === "inbound-queue:queued") this.queue = { ...this.queue, queued: this.queue.queued + 1 };
        else if (policy === "inbound-queue:deferred") this.queue = { ...this.queue, deferred: this.queue.deferred + 1 };
        else if (policy === "inbound-queue:dropped") this.queue = { ...this.queue, dropped: this.queue.dropped + 1 };
        else {
          this.denied += 1;
          this.note({ at: event.timestamp, kind: "denied", detail: `${event.source}: ${event.reason}` });
          return;
        }
        this.note({ at: event.timestamp, kind: policy === "inbound-queue:queued" ? "queued" : policy === "inbound-queue:deferred" ? "deferred" : "dropped", detail: event.reason });
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
    return {
      channels: Object.fromEntries(this.channels),
      queue: this.queue,
      denied: this.denied,
      activity: [...this.activity].reverse(),
    };
  }
}
