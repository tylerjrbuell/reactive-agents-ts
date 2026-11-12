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

/**
 * Why a delivery failed. Mirrors the channels package's `ChannelErrorKind` (channels depends on
 * gateway, so the vocabulary is declared here and pinned equal by a type-level check in channels).
 */
export type ScheduleDeliveryErrorKind =
  | "auth"
  | "rate_limited"
  | "not_found"
  | "forbidden"
  | "too_large"
  | "unsupported"
  | "network"
  | "unknown";

/**
 * Outcome of the delivery attempt for a run (typed receipt id or error summary, never secrets).
 * `status`, `messageId` and `error` are the original shape; the remaining fields carry the
 * channels `DeliveryReceipt` / `ChannelError` vocabulary and are additive, so rows persisted
 * before they existed stay readable.
 */
export interface ScheduleDeliveryRecord {
  readonly status: "delivered" | "failed";
  readonly messageId?: string;
  /** Error kind as text (kept for compatibility; equals `errorKind` when set). */
  readonly error?: string;
  /** The adapter that was asked to deliver. */
  readonly adapterId?: string;
  /** `DeliveryReceipt.status` on success. */
  readonly receiptStatus?: "sent" | "queued" | "delivered";
  /** `ChannelError.kind` on failure. */
  readonly errorKind?: ScheduleDeliveryErrorKind;
  /** `ChannelError.retryable` on failure. */
  readonly retryable?: boolean;
}

/** The most recent run of a schedule. */
export interface ScheduleRun {
  /** Id of the fire that started this run; stable, used to report completion. */
  readonly fireId: string;
  /** Agent run id once the executor reports it; the fire id until then. */
  readonly runId: string;
  readonly firedAt: number;
  /** The slot this run was for (differs from `firedAt` for catch-up runs). */
  readonly scheduledFor?: number;
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
  /** Bounded history of recent runs, oldest first; the last entry is `lastRun`. */
  readonly runs?: readonly ScheduleRun[];
  /**
   * Config schedules only: the `enabled` value the config declared when last synced. A runtime
   * pause survives a restart; a changed config value wins.
   */
  readonly configEnabled?: boolean;
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
