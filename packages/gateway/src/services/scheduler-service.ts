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
      const parsedCrons = (config.crons ?? [])
        .filter((c) => c.enabled !== false)
        .map((c) => ({ entry: c, parsed: parseCron(c.schedule) }))
        .filter((c) => c.parsed !== null);

      return {
        pendingEvents: () => Ref.get(queueRef),

        checkCrons: (now: Date) =>
          Effect.gen(function* () {
            const events: GatewayEvent[] = [];
            for (const { entry, parsed } of parsedCrons) {
              if (parsed && shouldFireAt(parsed, now)) {
                const event = createCronEvent(agentId, entry);
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
