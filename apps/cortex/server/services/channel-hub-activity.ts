/**
 * The hub's recent-activity feed and per-route counters, folded from the router's typed events.
 *
 * The router publishes `ChannelRouteMatched`, `ChannelRouteDenied`, `ChannelUnrouted`,
 * `ChannelTurnStarted/Completed/Dropped` and `ChannelOwnershipChanged`. None carries message text or
 * a secret, and neither does this feed: it keeps classifications, route ids and counts. Pure, with an
 * injected clock, so a scripted event list pins it.
 */
import type { AgentEvent } from "@reactive-agents/core";
import { failureReasonText } from "./channel-hub-failure.js";

/** One line of the feed, newest first in a snapshot. */
export interface HubActivity {
  readonly at: number;
  readonly kind: "matched" | "denied" | "unrouted" | "answered" | "acknowledged" | "failed" | "dropped" | "conflict" | "edited" | "reset";
  readonly channelId?: string;
  readonly routeId?: string;
  /** Plain-words detail: the role, the drop reason, the failure reason. */
  readonly detail: string;
  /** On `acknowledged`: why canned text was sent although the route asked for a model-written ack. */
  readonly ackFallbackReason?: "timeout" | "empty" | "thinking_only" | "error";
  /** On `acknowledged`: milliseconds the model ack took (or waited before falling back). */
  readonly ackLatencyMs?: number;
  /** True for a simulated message (nothing was sent to the platform). */
  readonly simulated: boolean;
}

/** Counters for one route since the hub started. */
export interface RouteCounters {
  readonly matched: number;
  readonly denied: number;
  readonly answered: number;
  readonly failed: number;
  readonly dropped: number;
  readonly costUsd: number;
}

const LIMIT = 50;
const zero: RouteCounters = { matched: 0, denied: 0, answered: 0, failed: 0, dropped: 0, costUsd: 0 };

/** Plain-words ack line: source, role, latency (seconds, 1 decimal) and why a model ack fell back. */
const ackDetail = (event: {
  readonly source?: string | undefined;
  readonly role: string;
  readonly ackFallbackReason?: string | undefined;
  readonly ackLatencyMs?: number | undefined;
}): string => {
  const parts: string[] = [event.source ?? "canned", event.role];
  const head = parts.join(", ");
  const latency = event.ackLatencyMs !== undefined ? `${(event.ackLatencyMs / 1000).toFixed(1)}s` : undefined;
  const tail = event.ackFallbackReason
    ? `model ack fell back: ${event.ackFallbackReason}${latency ? ` after ${latency}` : ""}`
    : latency;
  return `acknowledged (${head}${tail ? `; ${tail}` : ""})`;
};

/** Folds router events; one instance per hub run. */
export class HubActivityTracker {
  private feed: HubActivity[] = [];
  private readonly counters = new Map<string, RouteCounters>();
  private readonly causes = new Map<string, string>();

  /** `turnTimeoutMsOf` names a route's turn limit so a timeout line can say how long it was. */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly turnTimeoutMsOf: (routeId: string) => number | undefined = () => undefined,
  ) {}

  private note(a: Omit<HubActivity, "at" | "simulated"> & { readonly simulated?: boolean | undefined }): void {
    this.feed.push({ ...a, at: this.now(), simulated: a.simulated === true });
    if (this.feed.length > LIMIT) this.feed.splice(0, this.feed.length - LIMIT);
  }

  private bump(routeId: string, add: Partial<RouteCounters>): void {
    const cur = this.counters.get(routeId) ?? zero;
    this.counters.set(routeId, {
      matched: cur.matched + (add.matched ?? 0),
      denied: cur.denied + (add.denied ?? 0),
      answered: cur.answered + (add.answered ?? 0),
      failed: cur.failed + (add.failed ?? 0),
      dropped: cur.dropped + (add.dropped ?? 0),
      costUsd: cur.costUsd + (add.costUsd ?? 0),
    });
  }

  /** Record a route edit made through the API (not a router event). */
  noteEdit(routeId: string, detail: string): void {
    this.note({ kind: "edited", routeId, detail });
  }

  /**
   * The sanitized cause of the turn that is failing on `routeId`. The resolver reports it before the router
   * emits `ChannelTurnCompleted`, which then carries it into the feed line (the event itself has only a reason).
   */
  noteCause(routeId: string, detail: string): void {
    this.causes.set(routeId, detail);
  }

  /** Fold one router event; every other event is ignored. */
  observe(event: AgentEvent): void {
    switch (event._tag) {
      case "ChannelRouteMatched":
        this.bump(event.routeId, { matched: 1 });
        this.note({ kind: "matched", channelId: event.channelId, routeId: event.routeId, detail: `sender is ${event.role}`, simulated: event.simulated });
        return;
      case "ChannelRouteDenied":
        this.bump(event.routeId, { denied: 1 });
        this.note({ kind: "denied", channelId: event.channelId, routeId: event.routeId, detail: "sender refused by the route", simulated: event.simulated });
        return;
      case "ChannelUnrouted":
        this.note({ kind: "unrouted", channelId: event.channelId, detail: "no enabled route matches", simulated: event.simulated });
        return;
      case "ChannelTurnCompleted":
        this.bump(event.routeId, event.ok ? { answered: 1, costUsd: event.costUsd ?? 0 } : { failed: 1 });
        const cause = this.causes.get(event.routeId);
        this.causes.delete(event.routeId);
        this.note({
          kind: event.ok ? "answered" : "failed",
          routeId: event.routeId,
          detail: event.ok ? `turn completed (${event.role})` : `${failureReasonText(event.reason, this.turnTimeoutMsOf(event.routeId))}${cause ? `: ${cause}` : ""}`,
          simulated: event.simulated,
        });
        return;
      case "ChannelTurnAcknowledged":
        this.note({
          kind: "acknowledged",
          routeId: event.routeId,
          detail: ackDetail(event),
          ...(event.ackFallbackReason ? { ackFallbackReason: event.ackFallbackReason } : {}),
          ...(event.ackLatencyMs !== undefined ? { ackLatencyMs: event.ackLatencyMs } : {}),
          simulated: event.simulated,
        });
        return;
      case "ChannelTurnDropped":
        this.bump(event.routeId, { dropped: 1 });
        this.note({ kind: "dropped", routeId: event.routeId, detail: event.reason, simulated: event.simulated });
        return;
      case "ChannelConversationReset":
        // Classification only: the command text never reaches the event, and neither does any history.
        this.note({
          kind: "reset",
          routeId: event.routeId,
          detail: event.ok ? `conversation reset (${event.role})` : `conversation reset failed (${event.role})${event.reason ? `: ${event.reason}` : ""}`,
          simulated: event.simulated,
        });
        return;
      case "ChannelOwnershipChanged":
        this.note({ kind: "conflict", channelId: event.channelId, detail: "another consumer owns this account; the channel was stopped" });
        return;
      default:
        return;
    }
  }

  /** Counters for one route (zeros before any traffic). */
  countersOf(routeId: string): RouteCounters {
    return this.counters.get(routeId) ?? zero;
  }

  /** Newest first. */
  snapshot(): readonly HubActivity[] {
    return [...this.feed].reverse();
  }
}
