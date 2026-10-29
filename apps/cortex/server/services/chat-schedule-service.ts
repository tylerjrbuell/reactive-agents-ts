import type { Database } from "bun:sqlite";
import { parseCron, shouldFireAt, type CronExpression } from "@reactive-agents/gateway";
import { ChatSessionBusyError, type CortexChatResult } from "./chat-session-service.js";
import { generateTaskId } from "@reactive-agents/core";

/** Max live schedules per chat session (design decision 6). */
export const MAX_SCHEDULES_PER_SESSION = 3;
/** Schedule lifetime when the caller gives none: 7 days. */
export const DEFAULT_SCHEDULE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard ceiling on a requested lifetime: 30 days. Expiry is mandatory, never unbounded. */
export const MAX_SCHEDULE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Per-fire cost cap when the caller gives none. */
export const DEFAULT_SCHEDULE_MAX_COST_USD = 0.25;
/** Smallest allowed loop interval. */
export const MIN_INTERVAL_MS = 60_000;

/** Outcome of one tick for one schedule. */
export type ScheduleFireStatus = "ok" | "skipped:busy" | "error" | "cost-capped" | "expired";

/** A persisted loop (fixed interval) or cron schedule that fires a prompt as a chat turn. */
export interface ChatSchedule {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: "loop" | "cron";
  /** Interval like `5m`/`1h` for loops, a 5-field cron expression for cron. */
  readonly spec: string;
  readonly prompt: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly maxCostUsd: number;
  readonly runs: number;
  readonly lastFiredAt: number | null;
  readonly lastStatus: ScheduleFireStatus | null;
  readonly enabled: boolean;
}

/** `ScheduleFired` event, persisted per fire attempt in `chat_schedule_fires`. */
export interface ScheduleFiredEvent {
  readonly _tag: "ScheduleFired";
  readonly scheduleId: string;
  readonly sessionId: string;
  readonly ts: number;
  readonly status: ScheduleFireStatus;
  readonly costUsd?: number;
  readonly detail?: string;
}

/** Input for {@link ChatScheduleService.create}. */
export interface CreateScheduleInput {
  readonly sessionId: string;
  readonly kind: "loop" | "cron";
  readonly spec: string;
  readonly prompt: string;
  readonly ttlMs?: number;
  readonly maxCostUsd?: number;
}

/** Why a schedule could not be created; the router maps it to 400/404/409. */
export type ScheduleCreateFailure = {
  readonly ok: false;
  readonly code: "invalid" | "cap" | "not-found";
  readonly message: string;
};

/** Result of {@link ChatScheduleService.create}. */
export type ScheduleCreateResult = { readonly ok: true; readonly schedule: ChatSchedule } | ScheduleCreateFailure;

const fail = (code: ScheduleCreateFailure["code"], message: string): ScheduleCreateFailure => ({ ok: false, code, message });

type Row = {
  id: string;
  session_id: string;
  kind: string;
  spec: string;
  prompt: string;
  created_at: number;
  expires_at: number;
  max_cost_usd: number;
  runs: number;
  last_fired_at: number | null;
  last_status: string | null;
  enabled: number;
};

const toSchedule = (r: Row): ChatSchedule => ({
  id: r.id,
  sessionId: r.session_id,
  kind: r.kind === "cron" ? "cron" : "loop",
  spec: r.spec,
  prompt: r.prompt,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  maxCostUsd: r.max_cost_usd,
  runs: r.runs,
  lastFiredAt: r.last_fired_at,
  lastStatus: r.last_status as ScheduleFireStatus | null,
  enabled: r.enabled === 1,
});

/** Parse `30s`-less interval specs: `<n>m`, `<n>h`, `<n>d`. Returns ms or null. */
export function parseIntervalSpec(spec: string): number | null {
  const m = /^(\d+)([mhd])$/.exec(spec.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000;
  const ms = n * unit;
  return n > 0 && ms >= MIN_INTERVAL_MS ? ms : null;
}

/** Runs a chat turn; satisfied by `ChatSessionService.chat`. */
export type ScheduleTurnRunner = (sessionId: string, message: string) => Promise<CortexChatResult>;

/**
 * Fires stored prompts as ordinary chat turns. Never bypasses guards: fires only
 * through the injected turn runner (`ChatSessionService.chat`), and a busy session
 * is skipped, not queued. One unref'd ticker; call {@link dispose} on shutdown.
 */
export class ChatScheduleService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  private readonly now: () => number;
  private readonly tickMs: number;

  constructor(
    private readonly db: Database,
    private readonly runTurn: ScheduleTurnRunner,
    opts?: { readonly now?: () => number; readonly tickMs?: number },
  ) {
    this.now = opts?.now ?? Date.now;
    this.tickMs = opts?.tickMs ?? 60_000;
  }

  /** Start the single ticker. Idempotent; the timer is unref'd so it never holds the process open. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    this.timer.unref();
  }

  /** Stop the ticker. Safe to call repeatedly. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Create a schedule, or return why not (invalid spec, cap reached, unknown session). */
  create(input: CreateScheduleInput): ScheduleCreateResult {
    const prompt = input.prompt.trim();
    if (!prompt) return fail("invalid", "prompt is required");
    if (input.kind === "loop") {
      if (parseIntervalSpec(input.spec) === null) {
        return fail("invalid", `invalid interval "${input.spec}" (use e.g. 5m, 1h; minimum 1m)`);
      }
    } else if (parseCron(input.spec) === null) {
      return fail("invalid", `invalid cron expression "${input.spec}"`);
    }
    const ttl = input.ttlMs ?? DEFAULT_SCHEDULE_TTL_MS;
    if (!(ttl > 0) || ttl > MAX_SCHEDULE_TTL_MS) {
      return fail("invalid", `ttl must be between 1ms and ${MAX_SCHEDULE_TTL_MS}ms`);
    }
    const maxCost = input.maxCostUsd ?? DEFAULT_SCHEDULE_MAX_COST_USD;
    if (!(maxCost > 0)) return fail("invalid", "maxCostUsd must be positive");
    const t = this.now();
    const live = this.list(input.sessionId).filter((s) => s.enabled && s.expiresAt > t).length;
    if (live >= MAX_SCHEDULES_PER_SESSION) {
      return fail("cap", `session already has ${MAX_SCHEDULES_PER_SESSION} active schedules`);
    }
    const id = generateTaskId();
    try {
      this.db
        .prepare(
          `INSERT INTO chat_schedules (id, session_id, kind, spec, prompt, created_at, expires_at, max_cost_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.sessionId, input.kind, input.spec.trim(), prompt, t, t + ttl, maxCost);
    } catch {
      return fail("not-found", `Chat session ${input.sessionId} not found`);
    }
    const schedule = this.get(id);
    return schedule ? { ok: true, schedule } : fail("not-found", "schedule vanished after insert");
  }

  /** One schedule by id, or null. */
  get(id: string): ChatSchedule | null {
    const r = this.db.prepare("SELECT * FROM chat_schedules WHERE id = ?").get(id) as Row | undefined;
    return r ? toSchedule(r) : null;
  }

  /** All schedules of a session, oldest first. */
  list(sessionId: string): ChatSchedule[] {
    return (
      this.db
        .prepare("SELECT * FROM chat_schedules WHERE session_id = ? ORDER BY created_at ASC")
        .all(sessionId) as Row[]
    ).map(toSchedule);
  }

  /** Delete a schedule that belongs to the session. Returns false when absent. */
  remove(sessionId: string, id: string): boolean {
    return this.db.prepare("DELETE FROM chat_schedules WHERE id = ? AND session_id = ?").run(id, sessionId).changes > 0;
  }

  /** Persisted `ScheduleFired` events for a schedule, newest first. */
  fires(scheduleId: string, limit = 50): ScheduleFiredEvent[] {
    return (
      this.db
        .prepare("SELECT * FROM chat_schedule_fires WHERE schedule_id = ? ORDER BY id DESC LIMIT ?")
        .all(scheduleId, limit) as Array<{
        schedule_id: string;
        session_id: string;
        ts: number;
        status: string;
        cost_usd: number | null;
        detail: string | null;
      }>
    ).map((f) => ({
      _tag: "ScheduleFired" as const,
      scheduleId: f.schedule_id,
      sessionId: f.session_id,
      ts: f.ts,
      status: f.status as ScheduleFireStatus,
      ...(f.cost_usd !== null ? { costUsd: f.cost_usd } : {}),
      ...(f.detail !== null ? { detail: f.detail } : {}),
    }));
  }

  private isDue(s: ChatSchedule, cron: CronExpression | null, t: number): boolean {
    if (s.kind === "loop") {
      const ms = parseIntervalSpec(s.spec);
      return ms !== null && t - (s.lastFiredAt ?? s.createdAt) >= ms;
    }
    if (!cron) return false;
    const minute = Math.floor(t / 60_000);
    if (s.lastFiredAt !== null && Math.floor(s.lastFiredAt / 60_000) === minute) return false;
    return shouldFireAt(cron, new Date(t));
  }

  private record(s: ChatSchedule, status: ScheduleFireStatus, t: number, costUsd?: number, detail?: string): void {
    const fired = status === "ok" || status === "cost-capped" || status === "error";
    this.db
      .prepare(
        `UPDATE chat_schedules SET last_status = ?, last_fired_at = ?, runs = runs + ?,
           enabled = CASE WHEN ? IN ('cost-capped','expired') THEN 0 ELSE enabled END WHERE id = ?`,
      )
      .run(status, t, fired ? 1 : 0, status, s.id);
    this.db
      .prepare("INSERT INTO chat_schedule_fires (schedule_id, session_id, ts, status, cost_usd, detail) VALUES (?, ?, ?, ?, ?, ?)")
      .run(s.id, s.sessionId, t, status, costUsd ?? null, detail ?? null);
  }

  /** Evaluate every enabled schedule once; fires due ones sequentially. Re-entrant calls are ignored. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const t = this.now();
      const rows = this.db.prepare("SELECT * FROM chat_schedules WHERE enabled = 1").all() as Row[];
      for (const s of rows.map(toSchedule)) {
        if (s.expiresAt <= t) {
          this.record(s, "expired", t);
          continue;
        }
        if (!this.isDue(s, s.kind === "cron" ? parseCron(s.spec) : null, t)) continue;
        try {
          const result = await this.runTurn(s.sessionId, s.prompt);
          const cost = result.cost ?? 0;
          if (cost > s.maxCostUsd) {
            this.record(s, "cost-capped", t, cost, `turn cost ${cost} exceeded cap ${s.maxCostUsd}; schedule disabled`);
          } else {
            this.record(s, "ok", t, cost);
          }
        } catch (e) {
          if (e instanceof ChatSessionBusyError) this.record(s, "skipped:busy", t);
          else this.record(s, "error", t, undefined, e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
