import { describe, test, expect } from "bun:test";
import { Schema } from "effect";
import {
  GatewayEventSourceSchema,
  EventPrioritySchema,
  HeartbeatPolicySchema,
  HeartbeatConfigSchema,
  CronEntrySchema,
  WebhookConfigSchema,
  PolicyConfigSchema,
  GatewayConfigSchema,
  initialGatewayState,
} from "../src/types.js";
import {
  GatewayError,
  GatewayConfigError,
  WebhookValidationError,
  WebhookTransformError,
  PolicyViolationError,
  SchedulerError,
  ChannelConnectionError,
} from "../src/errors.js";

// ─── Schema Decoding ─────────────────────────────────────────────────────────

describe("GatewayEventSourceSchema", () => {
  test("decodes 'heartbeat' correctly", () => {
    const result = Schema.decodeSync(GatewayEventSourceSchema)("heartbeat");
    expect(result).toBe("heartbeat");
  });

  test("decodes all valid sources", () => {
    const sources = ["heartbeat", "cron", "webhook", "channel", "a2a", "state-change"] as const;
    for (const source of sources) {
      expect(Schema.decodeSync(GatewayEventSourceSchema)(source)).toBe(source);
    }
  });

  test("rejects invalid source", () => {
    expect(() => Schema.decodeSync(GatewayEventSourceSchema)("invalid")).toThrow();
  });
});

describe("EventPrioritySchema", () => {
  test("decodes 'critical' correctly", () => {
    const result = Schema.decodeSync(EventPrioritySchema)("critical");
    expect(result).toBe("critical");
  });

  test("decodes all valid priorities", () => {
    const priorities = ["low", "normal", "high", "critical"] as const;
    for (const p of priorities) {
      expect(Schema.decodeSync(EventPrioritySchema)(p)).toBe(p);
    }
  });

  test("rejects invalid priority", () => {
    expect(() => Schema.decodeSync(EventPrioritySchema)("urgent")).toThrow();
  });
});

describe("HeartbeatPolicySchema", () => {
  test("decodes all valid policies", () => {
    const policies = ["always", "adaptive", "conservative"] as const;
    for (const p of policies) {
      expect(Schema.decodeSync(HeartbeatPolicySchema)(p)).toBe(p);
    }
  });
});

// ─── Configuration Schemas ───────────────────────────────────────────────────

describe("HeartbeatConfigSchema", () => {
  test("validates with required fields and applies defaults", () => {
    const result = Schema.decodeSync(HeartbeatConfigSchema)({
      intervalMs: 60_000,
    });
    expect(result.intervalMs).toBe(60_000);
    expect(result.policy).toBe("adaptive");
    expect(result.maxConsecutiveSkips).toBe(6);
    expect(result.instruction).toBeUndefined();
  });

  test("validates with all fields", () => {
    const result = Schema.decodeSync(HeartbeatConfigSchema)({
      intervalMs: 30_000,
      policy: "always",
      instruction: "Check inbox",
      maxConsecutiveSkips: 3,
    });
    expect(result.intervalMs).toBe(30_000);
    expect(result.policy).toBe("always");
    expect(result.instruction).toBe("Check inbox");
    expect(result.maxConsecutiveSkips).toBe(3);
  });

  test("rejects missing intervalMs", () => {
    expect(() => Schema.decodeSync(HeartbeatConfigSchema)({})).toThrow();
  });
});

describe("CronEntrySchema", () => {
  test("validates schedule + instruction with defaults", () => {
    const result = Schema.decodeSync(CronEntrySchema)({
      schedule: "0 9 * * *",
      instruction: "Morning report",
    });
    expect(result.schedule).toBe("0 9 * * *");
    expect(result.instruction).toBe("Morning report");
    expect(result.priority).toBe("normal");
    expect(result.enabled).toBe(true);
  });

  test("validates with all optional fields", () => {
    const result = Schema.decodeSync(CronEntrySchema)({
      schedule: "*/5 * * * *",
      instruction: "Health check",
      agentId: "monitor-agent",
      priority: "high",
      timezone: "America/New_York",
      enabled: false,
    });
    expect(result.agentId).toBe("monitor-agent");
    expect(result.priority).toBe("high");
    expect(result.timezone).toBe("America/New_York");
    expect(result.enabled).toBe(false);
  });

  test("rejects missing instruction", () => {
    expect(() => Schema.decodeSync(CronEntrySchema)({ schedule: "0 * * * *" })).toThrow();
  });
});

describe("WebhookConfigSchema", () => {
  test("validates path + adapter", () => {
    const result = Schema.decodeSync(WebhookConfigSchema)({
      path: "/hooks/github",
      adapter: "github",
    });
    expect(result.path).toBe("/hooks/github");
    expect(result.adapter).toBe("github");
    expect(result.secret).toBeUndefined();
    expect(result.events).toBeUndefined();
  });

  test("validates with all optional fields", () => {
    const result = Schema.decodeSync(WebhookConfigSchema)({
      path: "/hooks/stripe",
      adapter: "stripe",
      secret: "whsec_abc123",
      events: ["payment.succeeded", "invoice.paid"],
    });
    expect(result.secret).toBe("whsec_abc123");
    expect(result.events).toEqual(["payment.succeeded", "invoice.paid"]);
  });
});

describe("PolicyConfigSchema", () => {
  test("validates with all defaults", () => {
    const result = Schema.decodeSync(PolicyConfigSchema)({});
    expect(result.dailyTokenBudget).toBe(100_000);
    expect(result.maxActionsPerHour).toBe(30);
    expect(result.heartbeatPolicy).toBe("adaptive");
    expect(result.mergeWindowMs).toBe(300_000);
    expect(result.requireApprovalFor).toBeUndefined();
  });

  test("validates with custom values", () => {
    const result = Schema.decodeSync(PolicyConfigSchema)({
      dailyTokenBudget: 50_000,
      maxActionsPerHour: 10,
      heartbeatPolicy: "conservative",
      mergeWindowMs: 60_000,
      requireApprovalFor: ["deploy", "delete"],
    });
    expect(result.dailyTokenBudget).toBe(50_000);
    expect(result.maxActionsPerHour).toBe(10);
    expect(result.heartbeatPolicy).toBe("conservative");
    expect(result.requireApprovalFor).toEqual(["deploy", "delete"]);
  });
});

describe("GatewayConfigSchema", () => {
  test("validates empty config with port default", () => {
    const result = Schema.decodeSync(GatewayConfigSchema)({});
    expect(result.port).toBe(3000);
    expect(result.heartbeat).toBeUndefined();
    expect(result.crons).toBeUndefined();
    expect(result.webhooks).toBeUndefined();
    expect(result.policies).toBeUndefined();
  });

  test("composes all sub-configs", () => {
    const result = Schema.decodeSync(GatewayConfigSchema)({
      heartbeat: { intervalMs: 60_000 },
      crons: [{ schedule: "0 9 * * *", instruction: "Daily check" }],
      webhooks: [{ path: "/hooks/gh", adapter: "github" }],
      policies: { dailyTokenBudget: 50_000 },
      port: 8080,
    });
    expect(result.heartbeat?.intervalMs).toBe(60_000);
    expect(result.heartbeat?.policy).toBe("adaptive");
    expect(result.crons).toHaveLength(1);
    expect(result.crons![0].schedule).toBe("0 9 * * *");
    expect(result.webhooks).toHaveLength(1);
    expect(result.webhooks![0].adapter).toBe("github");
    expect(result.policies?.dailyTokenBudget).toBe(50_000);
    expect(result.port).toBe(8080);
  });
});

// ─── Gateway State ───────────────────────────────────────────────────────────

describe("initialGatewayState", () => {
  test("returns correct initial state", () => {
    const state = initialGatewayState();
    expect(state.isRunning).toBe(false);
    expect(state.lastExecutionAt).toBeNull();
    expect(state.consecutiveHeartbeatSkips).toBe(0);
    expect(state.tokensUsedToday).toBe(0);
    expect(state.actionsThisHour).toBe(0);
    expect(state.pendingEvents).toEqual([]);
    expect(state.hourWindowStart).toBeInstanceOf(Date);
    expect(state.dayWindowStart).toBeInstanceOf(Date);
  });

  test("each call returns a fresh instance", () => {
    const a = initialGatewayState();
    const b = initialGatewayState();
    expect(a).not.toBe(b);
    expect(a.hourWindowStart).not.toBe(b.hourWindowStart);
  });
});

// ─── Tagged Errors ───────────────────────────────────────────────────────────

describe("Tagged Errors", () => {
  test("GatewayError has correct tag and fields", () => {
    const err = new GatewayError({ message: "boom" });
    expect(err._tag).toBe("GatewayError");
    expect(err.message).toBe("boom");
    expect(err.cause).toBeUndefined();
  });

  test("GatewayError with cause", () => {
    const cause = new Error("underlying");
    const err = new GatewayError({ message: "wrapped", cause });
    expect(err.cause).toBe(cause);
  });

  test("GatewayConfigError has correct tag", () => {
    const err = new GatewayConfigError({ message: "bad config", field: "port" });
    expect(err._tag).toBe("GatewayConfigError");
    expect(err.field).toBe("port");
  });

  test("WebhookValidationError has correct tag and fields", () => {
    const err = new WebhookValidationError({
      message: "invalid signature",
      source: "github",
      statusCode: 401,
    });
    expect(err._tag).toBe("WebhookValidationError");
    expect(err.source).toBe("github");
    expect(err.statusCode).toBe(401);
  });

  test("WebhookTransformError has correct tag", () => {
    const err = new WebhookTransformError({
      message: "transform failed",
      source: "stripe",
      payload: { id: "evt_123" },
    });
    expect(err._tag).toBe("WebhookTransformError");
    expect(err.payload).toEqual({ id: "evt_123" });
  });

  test("PolicyViolationError has correct tag and fields", () => {
    const err = new PolicyViolationError({
      message: "budget exceeded",
      policy: "daily-token-budget",
      eventId: "evt-001",
    });
    expect(err._tag).toBe("PolicyViolationError");
    expect(err.policy).toBe("daily-token-budget");
    expect(err.eventId).toBe("evt-001");
  });

  test("SchedulerError has correct tag", () => {
    const err = new SchedulerError({ message: "bad cron", schedule: "* * *" });
    expect(err._tag).toBe("SchedulerError");
    expect(err.schedule).toBe("* * *");
  });

  test("ChannelConnectionError has correct tag", () => {
    const err = new ChannelConnectionError({ message: "disconnected", platform: "slack" });
    expect(err._tag).toBe("ChannelConnectionError");
    expect(err.platform).toBe("slack");
  });
});
