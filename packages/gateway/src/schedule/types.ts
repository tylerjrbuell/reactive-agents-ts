import type { EventPriority } from "../types.js";

/** What to do with fires that were due more than `graceMs` ago (process down, tick gap). */
export type CatchUpMode = "skip" | "fire-once" | "fire-all";

/**
 * Per-schedule catch-up policy.
 * - `skip`: missed fires are dropped (recorded in `lastRun` as nothing; the next fire is the next slot).
 * - `fire-once`: the most recent missed fire runs once.
 * - `fire-all`: every missed fire runs, newest bounded by `maxFires` (default 10).
 */
export interface CatchUpPolicy {
  readonly mode: CatchUpMode;
  readonly maxFires?: number;
}

/** Where a schedule's result is delivered. Resolved through `ChannelService.deliver`. */
export interface ScheduleDeliveryTarget {
  readonly adapterId: string;
  readonly conversationId: string;
}

export type ScheduleRunStatus = "running" | "succeeded" | "failed" | "skipped";

export type ScheduleTrigger = "schedule" | "catch-up" | "manual";

/** Outcome of the delivery attempt for a run (typed receipt id or error summary, never secrets). */
export interface ScheduleDeliveryRecord {
  readonly status: "delivered" | "failed";
  readonly messageId?: string;
  readonly error?: string;
}

/** The most recent run of a schedule. */
export interface ScheduleRun {
  /** Id of the fire that started this run; stable, used to report completion. */
  readonly fireId: string;
  /** Agent run id once the executor reports it; the fire id until then. */
  readonly runId: string;
  readonly firedAt: number;
  readonly trigger: ScheduleTrigger;
  readonly status: ScheduleRunStatus;
  /** Opaque pointer to the output (trace id, file path, message id). */
  readonly outputRef?: string;
  readonly error?: string;
  readonly delivery?: ScheduleDeliveryRecord;
}

/** A durable schedule. Cron entries recur; `once` schedules fire a single time at `runAt`. */
export interface Schedule {
  readonly id: string;
  readonly name?: string;
  readonly kind: "cron" | "once";
  /** 5-field cron expression (kind `cron`). */
  readonly cron?: string;
  /** Epoch ms (kind `once`). */
  readonly runAt?: number;
  readonly timezone?: string;
  readonly instruction: string;
  readonly agentId?: string;
  readonly priority: EventPriority;
  readonly enabled: boolean;
  readonly catchUp: CatchUpPolicy;
  readonly delivery?: ScheduleDeliveryTarget;
  /** `config` schedules come from `GatewayConfig.crons` and are re-synced on start; `api` ones are user-owned. */
  readonly source: "config" | "api";
  readonly createdAt: number;
  /** Everything up to this instant has been evaluated; catch-up starts here after a restart. */
  readonly lastCheckedAt: number;
  /** Next scheduled fire (epoch ms), null when paused, exhausted or never due within a year. */
  readonly nextFireAt: number | null;
  readonly runCount: number;
  readonly lastRun?: ScheduleRun;
}

/** Input to `create`. Provide `cron` or `runAt`. */
export interface ScheduleInput {
  /** Explicit id; derived from the definition when omitted for config schedules, random for API ones. */
  readonly id?: string;
  readonly name?: string;
  readonly cron?: string;
  readonly runAt?: number;
  readonly timezone?: string;
  readonly instruction: string;
  readonly agentId?: string;
  readonly priority?: EventPriority;
  readonly enabled?: boolean;
  readonly catchUp?: CatchUpPolicy;
  readonly delivery?: ScheduleDeliveryTarget;
  readonly source?: "config" | "api";
}

/** Editable fields. `cron`/`runAt` changes recompute `nextFireAt`. */
export type SchedulePatch = Partial<
  Pick<
    ScheduleInput,
    "name" | "cron" | "runAt" | "timezone" | "instruction" | "agentId" | "priority" | "catchUp" | "delivery"
  >
>;

/** A schedule firing, handed to the executor. */
export interface ScheduleFire {
  readonly scheduleId: string;
  /** Unique per fire; also the initial `lastRun.runId`. */
  readonly fireId: string;
  readonly firedAt: number;
  /** The slot this fire was for (differs from `firedAt` for catch-up fires). */
  readonly scheduledFor: number;
  readonly trigger: ScheduleTrigger;
  readonly schedule: Schedule;
}

/** Reported by the executor when a fired schedule finishes. */
export interface ScheduleRunResult {
  /** Agent run id, replaces the fire id in `lastRun.runId`. */
  readonly runId?: string;
  readonly status: Exclude<ScheduleRunStatus, "running">;
  readonly outputRef?: string;
  readonly error?: string;
}
