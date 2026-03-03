import { Effect, Context, Layer, Ref } from "effect";
import type { EventBusLike, GatewayEvent, CronEntry, HeartbeatConfig } from "../types.js";
import { parseCron, shouldFireAt } from "./cron-parser.js";

// ─── Event Factories ─────────────────────────────────────────────────────────

/**
 * Create a heartbeat GatewayEvent.
 */
export const createHeartbeatEvent = (
  agentId: string,
  instruction?: string,
): GatewayEvent => ({
  id: `hb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  source: "heartbeat",
  timestamp: new Date(),
  agentId,
  priority: "low",
  payload: {},
  metadata: {
    instruction:
      instruction ?? "Heartbeat: review current state and take any needed actions",
  },
});

/**
 * Create a cron-triggered GatewayEvent.
 */
export const createCronEvent = (
  agentId: string,
  entry: CronEntry,
): GatewayEvent => ({
  id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  source: "cron",
  timestamp: new Date(),
  agentId: entry.agentId ?? agentId,
  priority: entry.priority ?? "normal",
  payload: {},
  metadata: {
    instruction: entry.instruction,
    schedule: entry.schedule,
  },
});

// ─── Service ─────────────────────────────────────────────────────────────────

interface SchedulerConfig {
  readonly agentId?: string;
  readonly timezone?: string;
  readonly heartbeat?: HeartbeatConfig;
  readonly crons?: readonly CronEntry[];
}

export class SchedulerService extends Context.Tag("SchedulerService")<
  SchedulerService,
  {
    /** Return all pending events currently queued. */
    readonly pendingEvents: () => Effect.Effect<readonly GatewayEvent[], never>;
    /** Check all enabled cron entries against `now` and return any that fire. */
    readonly checkCrons: (
      now: Date,
    ) => Effect.Effect<readonly GatewayEvent[], never>;
    /** Emit a single heartbeat event using the configured instruction. */
    readonly emitHeartbeat: () => Effect.Effect<GatewayEvent, never>;
  }
>() {}

export const SchedulerServiceLive = (config: SchedulerConfig, bus?: EventBusLike) =>
  Layer.effect(
    SchedulerService,
    Effect.gen(function* () {
      const queueRef = yield* Ref.make<GatewayEvent[]>([]);
      const agentId = config.agentId ?? "default";

      // Pre-parse all enabled cron entries once at construction time.
      // Track last-fired minute per cron to prevent double-fire within the same minute
      // (tick interval may be shorter than 60s, so shouldFireAt can match multiple times).
      const parsedCrons = (config.crons ?? [])
        .filter((c) => c.enabled !== false)
        .map((c) => ({ entry: c, parsed: parseCron(c.schedule), lastFiredMinute: -1 }))
        .filter((c) => c.parsed !== null);

      return {
        pendingEvents: () => Ref.get(queueRef),

        checkCrons: (now: Date) =>
          Effect.gen(function* () {
            const events: GatewayEvent[] = [];
            // Unique key for the current minute (changes every 60s)
            const minuteKey = Math.floor(now.getTime() / 60_000);
            for (const cron of parsedCrons) {
              if (cron.parsed) {
                // Use entry-specific timezone or fall back to global config timezone
                const tz = cron.entry.timezone ?? config.timezone;
                const shouldFire = shouldFireAt(cron.parsed, now, tz);
                if (shouldFire && cron.lastFiredMinute !== minuteKey) {
                  cron.lastFiredMinute = minuteKey;
                  const event = createCronEvent(agentId, cron.entry);
                  events.push(event);
                  if (bus) {
                    yield* bus.publish({
                      _tag: "GatewayEventReceived",
                      agentId,
                      source: "cron",
                      eventId: event.id,
                      timestamp: Date.now(),
                    });
                  }
                }
              }
            }
            return events;
          }),

        emitHeartbeat: () =>
          Effect.gen(function* () {
            const event = createHeartbeatEvent(agentId, config.heartbeat?.instruction);
            if (bus) {
              yield* bus.publish({
                _tag: "GatewayEventReceived",
                agentId,
                source: "heartbeat",
                eventId: event.id,
                timestamp: Date.now(),
              });
            }
            return event;
          }),
      };
    }),
  );
