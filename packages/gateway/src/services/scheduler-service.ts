import { Effect, Context, Layer, Ref } from "effect";
import type {
  EventBusLike,
  GatewayEvent,
  CronEntry,
  HeartbeatConfig,
} from "../types.js";
import type { ScheduleNotFoundError, ScheduleStoreError } from "../errors.js";
import {
  ScheduleRegistry,
  ScheduleRegistryLive,
  type ScheduleRegistryOptions,
} from "../schedule/registry.js";
import type { ScheduleFire } from "../schedule/types.js";

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

/**
 * Create the GatewayEvent for a registry {@link ScheduleFire}. Carries `scheduleId` and `fireId`
 * so the executor can report the outcome with `ScheduleRegistry.completeRun`, plus the optional
 * delivery target.
 */
export const createScheduleEvent = (
  agentId: string,
  fire: ScheduleFire,
): GatewayEvent => ({
  id: `cron-${fire.fireId}`,
  source: "cron",
  timestamp: new Date(fire.firedAt),
  agentId: fire.schedule.agentId ?? agentId,
  priority: fire.schedule.priority,
  payload: {},
  metadata: {
    instruction: fire.schedule.instruction,
    schedule: fire.schedule.cron ?? "once",
    scheduleId: fire.scheduleId,
    fireId: fire.fireId,
    trigger: fire.trigger,
    scheduledFor: fire.scheduledFor,
    ...(fire.schedule.delivery !== undefined ? { delivery: fire.schedule.delivery } : {}),
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
    /** Return all pending events currently queued (manual `runNow` fires not yet collected). */
    readonly pendingEvents: () => Effect.Effect<readonly GatewayEvent[], never>;
    /**
     * Evaluate every enabled schedule against `now` and return the events that fire, including
     * catch-up fires after downtime and queued manual fires. Backed by the durable
     * {@link ScheduleRegistry}.
     */
    readonly checkCrons: (
      now: Date,
    ) => Effect.Effect<readonly GatewayEvent[], ScheduleStoreError>;
    /** Fire a registered schedule now. The event is delivered by the next `checkCrons`. */
    readonly runNow: (
      scheduleId: string,
    ) => Effect.Effect<GatewayEvent, ScheduleNotFoundError | ScheduleStoreError>;
    /** Emit a single heartbeat event using the configured instruction. */
    readonly emitHeartbeat: () => Effect.Effect<GatewayEvent, never>;
  }
>() {}

/**
 * SchedulerService over an existing {@link ScheduleRegistry} (requires it in context).
 * Use {@link SchedulerServiceLive} when the registry should be built from the same config.
 */
export const SchedulerServiceFromRegistry = (
  config: SchedulerConfig,
  bus?: EventBusLike,
) =>
  Layer.effect(
    SchedulerService,
    Effect.gen(function* () {
      const registry = yield* ScheduleRegistry;
      const queueRef = yield* Ref.make<GatewayEvent[]>([]);
      const agentId = config.agentId ?? "default";

      const announce = (event: GatewayEvent) =>
        bus
          ? bus.publish({
              _tag: "GatewayEventReceived",
              agentId: event.agentId ?? agentId,
              source: "cron",
              eventId: event.id,
              timestamp: Date.now(),
            })
          : Effect.void;

      return {
        pendingEvents: () => Ref.get(queueRef),

        checkCrons: (now: Date) =>
          Effect.gen(function* () {
            const fires = yield* registry.collectDue(now.getTime());
            const events = fires.map((f) => createScheduleEvent(agentId, f));
            for (const event of events) {
              yield* Effect.logInfo(`cron fire: ${String(event.metadata["scheduleId"])} (${String(event.metadata["trigger"])})`);
              yield* announce(event);
            }
            const queued = yield* Ref.getAndSet(queueRef, []);
            return [...events, ...queued];
          }),

        runNow: (scheduleId: string) =>
          Effect.gen(function* () {
            const fire = yield* registry.runNow(scheduleId);
            const event = createScheduleEvent(agentId, fire);
            yield* Ref.update(queueRef, (q) => [...q, event]);
            yield* announce(event);
            return event;
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

/**
 * SchedulerService plus the {@link ScheduleRegistry} it runs on. `config.crons` are seeded into
 * the registry with stable ids; pass `registry.path` to make schedules survive restarts.
 */
export const SchedulerServiceLive = (
  config: SchedulerConfig,
  bus?: EventBusLike,
  registry: Pick<ScheduleRegistryOptions, "path" | "store" | "graceMs"> = {},
) =>
  SchedulerServiceFromRegistry(config, bus).pipe(
    Layer.provideMerge(
      ScheduleRegistryLive({
        ...registry,
        ...(config.crons !== undefined ? { crons: config.crons } : {}),
        ...(config.timezone !== undefined ? { timezone: config.timezone } : {}),
      }),
    ),
  );
