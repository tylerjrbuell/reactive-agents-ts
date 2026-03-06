import { Effect, Context, Layer, Ref } from "effect";
import type {
  EventBusLike,
  GatewayEvent,
  CronEntry,
  HeartbeatConfig,
} from "../types.js";
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
      instruction ??
      "Heartbeat: review current state and take any needed actions",
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

export const SchedulerServiceLive = (
  config: SchedulerConfig,
  bus?: EventBusLike,
) =>
  Layer.effect(
    SchedulerService,
    Effect.gen(function* () {
      const queueRef = yield* Ref.make<GatewayEvent[]>([]);
      const agentId = config.agentId ?? "default";

      // Pre-parse all enabled cron entries once at construction time.
      // Track last-checked minute per cron to detect and fire missed crons between beats
      // (if heartbeat interval doesn't align with cron times).
      const parsedCrons = (config.crons ?? [])
        .filter((c) => c.enabled !== false)
        .map((c) => ({
          entry: c,
          parsed: parseCron(c.schedule),
          lastCheckedMinute: -1,
        }))
        .filter((c) => c.parsed !== null);

      return {
        pendingEvents: () => Ref.get(queueRef),

        checkCrons: (now: Date) =>
          Effect.gen(function* () {
            const events: GatewayEvent[] = [];
            const currentMinute = Math.floor(now.getTime() / 60_000);
            const currentDate = now;

            for (const cron of parsedCrons) {
              if (cron.parsed) {
                // Always resolve a concrete timezone for cron evaluation and logging.
                // Without this fallback, logs can show "(undefined)" and local-time drift.
                const tz = cron.entry.timezone ?? config.timezone ?? "UTC";

                // On first call, initialize lastCheckedMinute to currentMinute - 1
                // so we only check the current minute, not back to epoch (which would be millions of iterations).
                if (cron.lastCheckedMinute === -1) {
                  cron.lastCheckedMinute = currentMinute - 1;
                }

                // Check all minutes from lastCheckedMinute+1 to now (inclusive).
                // This buffers missed crons that should have fired between heartbeats.
                const startMinute = cron.lastCheckedMinute + 1;
                for (
                  let minuteKey = startMinute;
                  minuteKey <= currentMinute;
                  minuteKey++
                ) {
                  // Calculate minutes offset from current (in minutes)
                  const minutesOffset = currentMinute - minuteKey;

                  // Create a date for this minute by going backward from now
                  // (e.g., if currentMinute is now, offset=0; if checking 1 minute ago, offset=1)
                  const checkTime = new Date(
                    currentDate.getTime() - minutesOffset * 60_000,
                  );

                  // Check if cron should fire at this minute
                  const shouldFire = shouldFireAt(cron.parsed, checkTime, tz);

                  // Only log when checking the current or recent minute
                  if (minuteKey >= currentMinute - 2) {
                    const dateStr = checkTime.toLocaleString("en-US", {
                      timeZone: tz,
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                    console.log(
                      `[CRON-CHECK] "${cron.entry.schedule}" at ${dateStr} (${tz}) → ${shouldFire ? "✓ MATCHED" : "✗ no match"}`,
                    );
                  }

                  if (shouldFire) {
                    const event = createCronEvent(agentId, cron.entry);
                    events.push(event);
                    const dateStr = checkTime.toLocaleString();
                    console.log(
                      `  ▶️  FIRING: "${cron.entry.schedule}" at ${dateStr}`,
                    );

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

                // Update lastCheckedMinute to current so we don't re-check these minutes
                cron.lastCheckedMinute = currentMinute;
              }
            }
            return events;
          }),

        emitHeartbeat: () =>
          Effect.gen(function* () {
            const event = createHeartbeatEvent(
              agentId,
              config.heartbeat?.instruction,
            );
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
