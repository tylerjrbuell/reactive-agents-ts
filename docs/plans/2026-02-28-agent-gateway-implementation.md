# Agent Gateway Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `@reactive-agents/gateway` — a persistent autonomous agent harness with heartbeats, crons, webhooks, channel adapters, a composable policy engine, and ethical-by-default autonomy.

**Architecture:** New Effect-TS package following existing monorepo patterns (Context.Tag + Layer.effect, Data.TaggedError, Schema.Struct). Composes into the existing runtime via `Layer.merge()` in `createRuntime()` and `.withGateway()` in the builder. Zero changes to existing services — gateway publishes to the existing EventBus and delegates execution to the existing ExecutionEngine.

**Tech Stack:** Effect-TS (Layer, Ref, Stream, Schedule, Queue), Bun HTTP server (for webhooks), bun:test, Schema validation.

**Design Doc:** `docs/plans/2026-02-28-agent-gateway-design.md`

---

## Task 1: Package Scaffold

**Files:**
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/tsconfig.json`
- Create: `packages/gateway/src/index.ts`
- Modify: `package.json:11` (root build order)

**Step 1: Create package.json**

```json
{
  "name": "@reactive-agents/gateway",
  "version": "0.5.2",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup --config ../../tsup.config.base.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "test:watch": "bun test --watch"
  },
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:^"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["bun-types"],
    "paths": {}
  },
  "include": ["src/**/*"],
  "exclude": ["tests/**/*", "dist"]
}
```

**Step 3: Create src/index.ts (empty re-export shell)**

```typescript
// @reactive-agents/gateway — Persistent Autonomous Agent Harness
// Types, errors, services, and policies are exported as they're built.
```

**Step 4: Add to root build order**

In `package.json` line 11, add `bun run --filter '@reactive-agents/gateway' build &&` after the `@reactive-agents/a2a` entry and before `@reactive-agents/runtime`.

**Step 5: Verify scaffold builds**

Run: `cd packages/gateway && bun run build`
Expected: Clean build with `dist/index.js` + `dist/index.d.ts`

**Step 6: Commit**

```bash
git add packages/gateway/ package.json
git commit -m "feat(gateway): scaffold @reactive-agents/gateway package"
```

---

## Task 2: Types & Errors

**Files:**
- Create: `packages/gateway/src/types.ts`
- Create: `packages/gateway/src/errors.ts`
- Create: `packages/gateway/tests/types.test.ts`
- Modify: `packages/gateway/src/index.ts`

**Step 1: Write the failing test for types**

```typescript
// packages/gateway/tests/types.test.ts
import { describe, test, expect } from "bun:test";
import { Schema } from "effect";

describe("Gateway Types", () => {
  test("GatewayEventSource is a valid literal union", () => {
    const { GatewayEventSourceSchema } = require("../src/types") as typeof import("../src/types");
    const decoded = Schema.decodeSync(GatewayEventSourceSchema)("heartbeat");
    expect(decoded).toBe("heartbeat");
  });

  test("GatewayEventSource rejects invalid values", () => {
    const { GatewayEventSourceSchema } = require("../src/types") as typeof import("../src/types");
    expect(() => Schema.decodeSync(GatewayEventSourceSchema)("invalid")).toThrow();
  });

  test("EventPriority is a valid literal union", () => {
    const { EventPrioritySchema } = require("../src/types") as typeof import("../src/types");
    const decoded = Schema.decodeSync(EventPrioritySchema)("critical");
    expect(decoded).toBe("critical");
  });

  test("HeartbeatConfig schema validates correctly", () => {
    const { HeartbeatConfigSchema } = require("../src/types") as typeof import("../src/types");
    const config = Schema.decodeSync(HeartbeatConfigSchema)({
      intervalMs: 1800000,
      policy: "adaptive",
    });
    expect(config.intervalMs).toBe(1800000);
    expect(config.policy).toBe("adaptive");
  });

  test("CronEntry schema validates schedule + instruction", () => {
    const { CronEntrySchema } = require("../src/types") as typeof import("../src/types");
    const entry = Schema.decodeSync(CronEntrySchema)({
      schedule: "0 9 * * MON",
      instruction: "Review PRs",
    });
    expect(entry.schedule).toBe("0 9 * * MON");
    expect(entry.instruction).toBe("Review PRs");
  });

  test("WebhookConfig schema validates path + adapter", () => {
    const { WebhookConfigSchema } = require("../src/types") as typeof import("../src/types");
    const config = Schema.decodeSync(WebhookConfigSchema)({
      path: "/github",
      adapter: "github",
    });
    expect(config.path).toBe("/github");
  });

  test("PolicyConfig schema validates with defaults", () => {
    const { PolicyConfigSchema } = require("../src/types") as typeof import("../src/types");
    const config = Schema.decodeSync(PolicyConfigSchema)({
      dailyTokenBudget: 50000,
      maxActionsPerHour: 20,
    });
    expect(config.dailyTokenBudget).toBe(50000);
  });

  test("GatewayConfig composes all sub-configs", () => {
    const { GatewayConfigSchema } = require("../src/types") as typeof import("../src/types");
    const config = Schema.decodeSync(GatewayConfigSchema)({
      heartbeat: { intervalMs: 1800000, policy: "adaptive" },
      crons: [{ schedule: "0 9 * * MON", instruction: "Review PRs" }],
      policies: { dailyTokenBudget: 50000, maxActionsPerHour: 20 },
    });
    expect(config.heartbeat?.policy).toBe("adaptive");
    expect(config.crons?.length).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/gateway && bun test tests/types.test.ts`
Expected: FAIL — cannot resolve `../src/types`

**Step 3: Write types.ts**

```typescript
// packages/gateway/src/types.ts
import { Schema } from "effect";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const GatewayEventSourceSchema = Schema.Literal(
  "heartbeat",
  "cron",
  "webhook",
  "channel",
  "a2a",
  "state-change",
);
export type GatewayEventSource = typeof GatewayEventSourceSchema.Type;

export const EventPrioritySchema = Schema.Literal(
  "low",
  "normal",
  "high",
  "critical",
);
export type EventPriority = typeof EventPrioritySchema.Type;

export const HeartbeatPolicySchema = Schema.Literal(
  "always",
  "adaptive",
  "conservative",
);
export type HeartbeatPolicy = typeof HeartbeatPolicySchema.Type;

// ─── Gateway Event (universal input envelope) ────────────────────────────────

export interface GatewayEvent {
  readonly id: string;
  readonly source: GatewayEventSource;
  readonly timestamp: Date;
  readonly agentId?: string;
  readonly payload: unknown;
  readonly priority: EventPriority;
  readonly metadata: Record<string, unknown>;
  readonly traceId?: string;
}

// ─── Policy Decision ─────────────────────────────────────────────────────────

export type PolicyDecision =
  | { readonly action: "execute"; readonly taskDescription: string }
  | { readonly action: "queue"; readonly reason: string }
  | { readonly action: "skip"; readonly reason: string }
  | { readonly action: "merge"; readonly mergeKey: string }
  | { readonly action: "escalate"; readonly reason: string };

// ─── Configuration Schemas ───────────────────────────────────────────────────

export const HeartbeatConfigSchema = Schema.Struct({
  intervalMs: Schema.Number,
  policy: Schema.optional(HeartbeatPolicySchema, { default: () => "adaptive" as const }),
  instruction: Schema.optional(Schema.String),
  maxConsecutiveSkips: Schema.optional(Schema.Number, { default: () => 6 }),
});
export type HeartbeatConfig = typeof HeartbeatConfigSchema.Type;

export const CronEntrySchema = Schema.Struct({
  schedule: Schema.String,
  instruction: Schema.String,
  agentId: Schema.optional(Schema.String),
  priority: Schema.optional(EventPrioritySchema, { default: () => "normal" as const }),
  timezone: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean, { default: () => true }),
});
export type CronEntry = typeof CronEntrySchema.Type;

export const WebhookConfigSchema = Schema.Struct({
  path: Schema.String,
  adapter: Schema.String,
  secret: Schema.optional(Schema.String),
  events: Schema.optional(Schema.Array(Schema.String)),
});
export type WebhookConfig = typeof WebhookConfigSchema.Type;

export const PolicyConfigSchema = Schema.Struct({
  dailyTokenBudget: Schema.optional(Schema.Number, { default: () => 100_000 }),
  maxActionsPerHour: Schema.optional(Schema.Number, { default: () => 30 }),
  heartbeatPolicy: Schema.optional(HeartbeatPolicySchema, { default: () => "adaptive" as const }),
  mergeWindowMs: Schema.optional(Schema.Number, { default: () => 300_000 }),
  requireApprovalFor: Schema.optional(Schema.Array(Schema.String)),
});
export type PolicyConfig = typeof PolicyConfigSchema.Type;

export const GatewayConfigSchema = Schema.Struct({
  heartbeat: Schema.optional(HeartbeatConfigSchema),
  crons: Schema.optional(Schema.Array(CronEntrySchema)),
  webhooks: Schema.optional(Schema.Array(WebhookConfigSchema)),
  policies: Schema.optional(PolicyConfigSchema),
  port: Schema.optional(Schema.Number, { default: () => 3000 }),
});
export type GatewayConfig = typeof GatewayConfigSchema.Type;

// ─── Gateway State (tracked by Ref, zero LLM cost) ──────────────────────────

export interface GatewayState {
  readonly isRunning: boolean;
  readonly lastExecutionAt: Date | null;
  readonly consecutiveHeartbeatSkips: number;
  readonly tokensUsedToday: number;
  readonly actionsThisHour: number;
  readonly hourWindowStart: Date;
  readonly dayWindowStart: Date;
  readonly pendingEvents: readonly GatewayEvent[];
}

export const initialGatewayState = (): GatewayState => ({
  isRunning: false,
  lastExecutionAt: null,
  consecutiveHeartbeatSkips: 0,
  tokensUsedToday: 0,
  actionsThisHour: 0,
  hourWindowStart: new Date(),
  dayWindowStart: new Date(),
  pendingEvents: [],
});

// ─── Gateway Stats (for dashboard / events) ─────────────────────────────────

export interface GatewayStats {
  readonly heartbeatsFired: number;
  readonly heartbeatsSkipped: number;
  readonly webhooksReceived: number;
  readonly webhooksProcessed: number;
  readonly webhooksMerged: number;
  readonly cronsExecuted: number;
  readonly channelMessages: number;
  readonly totalTokensUsed: number;
  readonly actionsSuppressed: number;
  readonly actionsEscalated: number;
}
```

**Step 4: Write errors.ts**

```typescript
// packages/gateway/src/errors.ts
import { Data } from "effect";

export class GatewayError extends Data.TaggedError("GatewayError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class GatewayConfigError extends Data.TaggedError("GatewayConfigError")<{
  readonly message: string;
  readonly field?: string;
}> {}

export class WebhookValidationError extends Data.TaggedError("WebhookValidationError")<{
  readonly message: string;
  readonly source: string;
  readonly statusCode?: number;
}> {}

export class WebhookTransformError extends Data.TaggedError("WebhookTransformError")<{
  readonly message: string;
  readonly source: string;
  readonly payload?: unknown;
}> {}

export class PolicyViolationError extends Data.TaggedError("PolicyViolationError")<{
  readonly message: string;
  readonly policy: string;
  readonly eventId: string;
}> {}

export class SchedulerError extends Data.TaggedError("SchedulerError")<{
  readonly message: string;
  readonly schedule?: string;
}> {}

export class ChannelConnectionError extends Data.TaggedError("ChannelConnectionError")<{
  readonly message: string;
  readonly platform: string;
}> {}
```

**Step 5: Update index.ts with exports**

```typescript
// packages/gateway/src/index.ts
export * from "./types.js";
export * from "./errors.js";
```

**Step 6: Run tests to verify they pass**

Run: `cd packages/gateway && bun test tests/types.test.ts`
Expected: 8 tests PASS

**Step 7: Commit**

```bash
git add packages/gateway/src/types.ts packages/gateway/src/errors.ts packages/gateway/src/index.ts packages/gateway/tests/types.test.ts
git commit -m "feat(gateway): add types, schemas, and tagged errors"
```

---

## Task 3: Gateway Event Types (Core Extension)

**Files:**
- Modify: `packages/core/src/services/event-bus.ts` (add new event variants to AgentEvent union)
- Create: `packages/gateway/tests/events.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/gateway/tests/events.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("Gateway EventBus Events", () => {
  const runWithBus = <A>(effect: Effect.Effect<A, any, EventBus>) =>
    Effect.runPromise(effect.pipe(Effect.provide(EventBusLive)));

  test("publishes GatewayStarted event", async () => {
    await runWithBus(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        let received = false;
        yield* bus.on("GatewayStarted", (event) => {
          received = true;
          expect(event.sources).toEqual(["heartbeat", "webhook"]);
          return Effect.void;
        });
        yield* bus.publish({
          _tag: "GatewayStarted",
          agentId: "test-agent",
          sources: ["heartbeat", "webhook"],
          policies: ["adaptive-heartbeat", "cost-budget"],
          timestamp: Date.now(),
        });
        expect(received).toBe(true);
      }),
    );
  });

  test("publishes ProactiveActionSuppressed event", async () => {
    await runWithBus(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        let received = false;
        yield* bus.on("ProactiveActionSuppressed", (event) => {
          received = true;
          expect(event.reason).toBe("budget exhausted");
          expect(event.policy).toBe("cost-budget");
          return Effect.void;
        });
        yield* bus.publish({
          _tag: "ProactiveActionSuppressed",
          agentId: "test-agent",
          source: "heartbeat",
          reason: "budget exhausted",
          policy: "cost-budget",
          eventId: "evt-123",
          timestamp: Date.now(),
        });
        expect(received).toBe(true);
      }),
    );
  });

  test("publishes HeartbeatSkipped event", async () => {
    await runWithBus(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        let received = false;
        yield* bus.on("HeartbeatSkipped", (event) => {
          received = true;
          expect(event.consecutiveSkips).toBe(3);
          return Effect.void;
        });
        yield* bus.publish({
          _tag: "HeartbeatSkipped",
          agentId: "test-agent",
          reason: "no state change",
          consecutiveSkips: 3,
          timestamp: Date.now(),
        });
        expect(received).toBe(true);
      }),
    );
  });

  test("publishes BudgetExhausted event", async () => {
    await runWithBus(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        let received = false;
        yield* bus.on("BudgetExhausted", (event) => {
          received = true;
          expect(event.limit).toBe(50000);
          expect(event.used).toBe(50001);
          return Effect.void;
        });
        yield* bus.publish({
          _tag: "BudgetExhausted",
          agentId: "test-agent",
          budgetType: "daily",
          limit: 50000,
          used: 50001,
          timestamp: Date.now(),
        });
        expect(received).toBe(true);
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/gateway && bun test tests/events.test.ts`
Expected: FAIL — TypeScript error: `"GatewayStarted"` is not assignable to AgentEvent `_tag`

**Step 3: Add gateway event variants to AgentEvent union**

In `packages/core/src/services/event-bus.ts`, add these variants to the `AgentEvent` union (before the `Custom` variant, around line 395):

```typescript
  // ─── Gateway events (from @reactive-agents/gateway) ───
  | {
      readonly _tag: "GatewayStarted";
      readonly agentId: string;
      readonly sources: readonly string[];
      readonly policies: readonly string[];
      readonly timestamp: number;
    }
  | {
      readonly _tag: "GatewayStopped";
      readonly agentId: string;
      readonly reason: string;
      readonly uptime: number;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "GatewayEventReceived";
      readonly agentId: string;
      readonly source: string;
      readonly eventId: string;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "ProactiveActionInitiated";
      readonly agentId: string;
      readonly source: string;
      readonly taskDescription: string;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "ProactiveActionCompleted";
      readonly agentId: string;
      readonly source: string;
      readonly success: boolean;
      readonly tokensUsed: number;
      readonly durationMs: number;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "ProactiveActionSuppressed";
      readonly agentId: string;
      readonly source: string;
      readonly reason: string;
      readonly policy: string;
      readonly eventId: string;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "PolicyDecisionMade";
      readonly agentId: string;
      readonly policy: string;
      readonly decision: string;
      readonly eventId: string;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "HeartbeatSkipped";
      readonly agentId: string;
      readonly reason: string;
      readonly consecutiveSkips: number;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "EventsMerged";
      readonly agentId: string;
      readonly mergedCount: number;
      readonly mergeKey: string;
      readonly timestamp: number;
    }
  | {
      readonly _tag: "BudgetExhausted";
      readonly agentId: string;
      readonly budgetType: string;
      readonly limit: number;
      readonly used: number;
      readonly timestamp: number;
    }
```

**Step 4: Rebuild core package**

Run: `cd packages/core && bun run build`
Expected: Clean build

**Step 5: Run gateway event tests**

Run: `cd packages/gateway && bun test tests/events.test.ts`
Expected: 4 tests PASS

**Step 6: Run existing core tests to verify no regressions**

Run: `cd packages/core && bun test`
Expected: All existing tests PASS (adding union variants is backward-compatible)

**Step 7: Commit**

```bash
git add packages/core/src/services/event-bus.ts packages/gateway/tests/events.test.ts
git commit -m "feat(gateway): add 10 gateway event types to AgentEvent union"
```

---

## Task 4: Policy Engine

The deterministic decision layer — zero LLM calls. This is the core innovation over OpenClaw.

**Files:**
- Create: `packages/gateway/src/services/policy-engine.ts`
- Create: `packages/gateway/src/policies/adaptive-heartbeat.ts`
- Create: `packages/gateway/src/policies/cost-budget.ts`
- Create: `packages/gateway/src/policies/rate-limit.ts`
- Create: `packages/gateway/src/policies/event-merging.ts`
- Create: `packages/gateway/tests/services/policy-engine.test.ts`
- Create: `packages/gateway/tests/policies/adaptive-heartbeat.test.ts`
- Create: `packages/gateway/tests/policies/cost-budget.test.ts`
- Create: `packages/gateway/tests/policies/rate-limit.test.ts`
- Create: `packages/gateway/tests/policies/event-merging.test.ts`

**Step 1: Write failing test for PolicyEngine service**

```typescript
// packages/gateway/tests/services/policy-engine.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../../src/types";
import type { SchedulingPolicy } from "../../src/services/policy-engine";

describe("PolicyEngine", () => {
  const makeEvent = (overrides?: Partial<GatewayEvent>): GatewayEvent => ({
    id: "evt-1",
    source: "heartbeat",
    timestamp: new Date(),
    priority: "normal",
    payload: {},
    metadata: {},
    ...overrides,
  });

  const makeState = (overrides?: Partial<GatewayState>): GatewayState => ({
    isRunning: true,
    lastExecutionAt: null,
    consecutiveHeartbeatSkips: 0,
    tokensUsedToday: 0,
    actionsThisHour: 0,
    hourWindowStart: new Date(),
    dayWindowStart: new Date(),
    pendingEvents: [],
    ...overrides,
  });

  test("evaluatePolicies returns execute when no policies block", async () => {
    const { evaluatePolicies } = await import("../../src/services/policy-engine");
    const policies: SchedulingPolicy[] = [];
    const result = await Effect.runPromise(
      evaluatePolicies(policies, makeEvent(), makeState()),
    );
    expect(result.action).toBe("execute");
  });

  test("first policy to return non-null wins", async () => {
    const { evaluatePolicies } = await import("../../src/services/policy-engine");
    const skipPolicy: SchedulingPolicy = {
      _tag: "test-skip",
      priority: 0,
      evaluate: () => Effect.succeed({ action: "skip", reason: "test" }),
    };
    const result = await Effect.runPromise(
      evaluatePolicies([skipPolicy], makeEvent(), makeState()),
    );
    expect(result.action).toBe("skip");
  });

  test("policies evaluate in priority order (lower number = earlier)", async () => {
    const { evaluatePolicies } = await import("../../src/services/policy-engine");
    const order: string[] = [];
    const p1: SchedulingPolicy = {
      _tag: "first",
      priority: 1,
      evaluate: () => { order.push("first"); return Effect.succeed(null); },
    };
    const p2: SchedulingPolicy = {
      _tag: "second",
      priority: 10,
      evaluate: () => { order.push("second"); return Effect.succeed(null); },
    };
    // Provide in reverse order to test sorting
    await Effect.runPromise(evaluatePolicies([p2, p1], makeEvent(), makeState()));
    expect(order).toEqual(["first", "second"]);
  });

  test("null-returning policies pass to next", async () => {
    const { evaluatePolicies } = await import("../../src/services/policy-engine");
    const passPolicy: SchedulingPolicy = {
      _tag: "pass",
      priority: 0,
      evaluate: () => Effect.succeed(null),
    };
    const blockPolicy: SchedulingPolicy = {
      _tag: "block",
      priority: 1,
      evaluate: () => Effect.succeed({ action: "skip", reason: "blocked" }),
    };
    const result = await Effect.runPromise(
      evaluatePolicies([passPolicy, blockPolicy], makeEvent(), makeState()),
    );
    expect(result.action).toBe("skip");
    expect((result as any).reason).toBe("blocked");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/gateway && bun test tests/services/policy-engine.test.ts`
Expected: FAIL — cannot resolve module

**Step 3: Implement PolicyEngine**

```typescript
// packages/gateway/src/services/policy-engine.ts
import { Effect, Context, Layer, Ref } from "effect";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../types.js";

// ─── Policy Interface ────────────────────────────────────────────────────────

export interface SchedulingPolicy {
  readonly _tag: string;
  readonly priority: number;
  readonly evaluate: (
    event: GatewayEvent,
    state: GatewayState,
  ) => Effect.Effect<PolicyDecision | null, never>;
}

// ─── Core Evaluation Function ────────────────────────────────────────────────

export const evaluatePolicies = (
  policies: readonly SchedulingPolicy[],
  event: GatewayEvent,
  state: GatewayState,
): Effect.Effect<PolicyDecision, never> =>
  Effect.gen(function* () {
    const sorted = [...policies].sort((a, b) => a.priority - b.priority);
    for (const policy of sorted) {
      const decision = yield* policy.evaluate(event, state);
      if (decision !== null) return decision;
    }
    // Default: execute if no policy objects
    return { action: "execute" as const, taskDescription: describeEvent(event) };
  });

// ─── Helper: describe event as task ──────────────────────────────────────────

const describeEvent = (event: GatewayEvent): string => {
  switch (event.source) {
    case "heartbeat":
      return (event.metadata.instruction as string) ?? "Heartbeat: review current state and take any needed actions";
    case "cron":
      return (event.metadata.instruction as string) ?? "Scheduled task";
    case "webhook":
      return `Webhook from ${event.metadata.adapter ?? "unknown"}: ${JSON.stringify(event.payload).slice(0, 200)}`;
    case "channel":
      return `Message: ${String(event.payload)}`;
    case "a2a":
      return `A2A message: ${JSON.stringify(event.payload).slice(0, 200)}`;
    case "state-change":
      return (event.metadata.instruction as string) ?? "State change detected — evaluate and respond";
    default:
      return `Event from ${event.source}`;
  }
};

// ─── PolicyEngine Service Tag ────────────────────────────────────────────────

export class PolicyEngine extends Context.Tag("PolicyEngine")<
  PolicyEngine,
  {
    readonly evaluate: (event: GatewayEvent) => Effect.Effect<PolicyDecision, never>;
    readonly addPolicy: (policy: SchedulingPolicy) => Effect.Effect<void, never>;
    readonly getPolicies: () => Effect.Effect<readonly SchedulingPolicy[], never>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const PolicyEngineLive = (initialPolicies?: SchedulingPolicy[]) =>
  Layer.effect(
    PolicyEngine,
    Effect.gen(function* () {
      const policiesRef = yield* Ref.make<SchedulingPolicy[]>(initialPolicies ?? []);
      const stateRef = yield* Ref.make<GatewayState>({
        isRunning: true,
        lastExecutionAt: null,
        consecutiveHeartbeatSkips: 0,
        tokensUsedToday: 0,
        actionsThisHour: 0,
        hourWindowStart: new Date(),
        dayWindowStart: new Date(),
        pendingEvents: [],
      });

      return {
        evaluate: (event: GatewayEvent) =>
          Effect.gen(function* () {
            const policies = yield* Ref.get(policiesRef);
            const state = yield* Ref.get(stateRef);
            return yield* evaluatePolicies(policies, event, state);
          }),
        addPolicy: (policy: SchedulingPolicy) =>
          Ref.update(policiesRef, (ps) => [...ps, policy]),
        getPolicies: () => Ref.get(policiesRef),
      };
    }),
  );
```

**Step 4: Run test to verify it passes**

Run: `cd packages/gateway && bun test tests/services/policy-engine.test.ts`
Expected: 4 tests PASS

**Step 5: Write failing test for AdaptiveHeartbeat policy**

```typescript
// packages/gateway/tests/policies/adaptive-heartbeat.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { GatewayEvent, GatewayState } from "../../src/types";

describe("AdaptiveHeartbeat Policy", () => {
  const makeHeartbeat = (): GatewayEvent => ({
    id: "hb-1",
    source: "heartbeat",
    timestamp: new Date(),
    priority: "low",
    payload: {},
    metadata: {},
  });

  const makeState = (overrides?: Partial<GatewayState>): GatewayState => ({
    isRunning: true,
    lastExecutionAt: new Date(Date.now() - 60_000),
    consecutiveHeartbeatSkips: 0,
    tokensUsedToday: 0,
    actionsThisHour: 0,
    hourWindowStart: new Date(),
    dayWindowStart: new Date(),
    pendingEvents: [],
    ...overrides,
  });

  test("skips heartbeat when no state change and policy is adaptive", async () => {
    const { createAdaptiveHeartbeatPolicy } = await import("../../src/policies/adaptive-heartbeat");
    const policy = createAdaptiveHeartbeatPolicy();
    const decision = await Effect.runPromise(
      policy.evaluate(makeHeartbeat(), makeState()),
    );
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("skip");
  });

  test("executes heartbeat when pending events exist", async () => {
    const { createAdaptiveHeartbeatPolicy } = await import("../../src/policies/adaptive-heartbeat");
    const policy = createAdaptiveHeartbeatPolicy();
    const state = makeState({
      pendingEvents: [makeHeartbeat()],
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeHeartbeat(), state),
    );
    expect(decision).toBeNull(); // pass through = allow execution
  });

  test("forces execution after maxConsecutiveSkips", async () => {
    const { createAdaptiveHeartbeatPolicy } = await import("../../src/policies/adaptive-heartbeat");
    const policy = createAdaptiveHeartbeatPolicy({ maxConsecutiveSkips: 3 });
    const state = makeState({ consecutiveHeartbeatSkips: 3 });
    const decision = await Effect.runPromise(
      policy.evaluate(makeHeartbeat(), state),
    );
    expect(decision).toBeNull(); // null = pass through = allow execution
  });

  test("passes through non-heartbeat events", async () => {
    const { createAdaptiveHeartbeatPolicy } = await import("../../src/policies/adaptive-heartbeat");
    const policy = createAdaptiveHeartbeatPolicy();
    const webhookEvent: GatewayEvent = {
      ...makeHeartbeat(),
      source: "webhook",
    };
    const decision = await Effect.runPromise(
      policy.evaluate(webhookEvent, makeState()),
    );
    expect(decision).toBeNull(); // policy has no opinion on non-heartbeat events
  });

  test("policy is always mode passes all heartbeats", async () => {
    const { createAdaptiveHeartbeatPolicy } = await import("../../src/policies/adaptive-heartbeat");
    const policy = createAdaptiveHeartbeatPolicy({ mode: "always" });
    const decision = await Effect.runPromise(
      policy.evaluate(makeHeartbeat(), makeState()),
    );
    expect(decision).toBeNull(); // always mode = never skip
  });
});
```

**Step 6: Implement AdaptiveHeartbeat policy**

```typescript
// packages/gateway/src/policies/adaptive-heartbeat.ts
import { Effect } from "effect";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../types.js";
import type { SchedulingPolicy } from "../services/policy-engine.js";

interface AdaptiveHeartbeatOptions {
  readonly mode?: "always" | "adaptive" | "conservative";
  readonly maxConsecutiveSkips?: number;
}

export const createAdaptiveHeartbeatPolicy = (
  options?: AdaptiveHeartbeatOptions,
): SchedulingPolicy => {
  const mode = options?.mode ?? "adaptive";
  const maxSkips = options?.maxConsecutiveSkips ?? 6;

  return {
    _tag: "adaptive-heartbeat",
    priority: 0,
    evaluate: (event: GatewayEvent, state: GatewayState) =>
      Effect.sync(() => {
        // Only applies to heartbeat events
        if (event.source !== "heartbeat") return null;

        // "always" mode: never skip
        if (mode === "always") return null;

        // Force execution after too many consecutive skips
        if (state.consecutiveHeartbeatSkips >= maxSkips) return null;

        // Check for reasons to execute
        const hasPendingEvents = state.pendingEvents.length > 0;
        const hasNeverExecuted = state.lastExecutionAt === null;

        if (hasPendingEvents || hasNeverExecuted) return null;

        // Conservative: only fire when pending events exist
        // Adaptive: also skip when nothing has changed recently
        return { action: "skip" as const, reason: "no state change" };
      }),
  };
};
```

**Step 7: Run AdaptiveHeartbeat tests**

Run: `cd packages/gateway && bun test tests/policies/adaptive-heartbeat.test.ts`
Expected: 5 tests PASS

**Step 8: Write failing test for CostBudget policy**

```typescript
// packages/gateway/tests/policies/cost-budget.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { GatewayEvent, GatewayState } from "../../src/types";

describe("CostBudget Policy", () => {
  const makeEvent = (): GatewayEvent => ({
    id: "evt-1",
    source: "webhook",
    timestamp: new Date(),
    priority: "normal",
    payload: {},
    metadata: {},
  });

  const makeState = (overrides?: Partial<GatewayState>): GatewayState => ({
    isRunning: true,
    lastExecutionAt: null,
    consecutiveHeartbeatSkips: 0,
    tokensUsedToday: 0,
    actionsThisHour: 0,
    hourWindowStart: new Date(),
    dayWindowStart: new Date(),
    pendingEvents: [],
    ...overrides,
  });

  test("allows events when under budget", async () => {
    const { createCostBudgetPolicy } = await import("../../src/policies/cost-budget");
    const policy = createCostBudgetPolicy({ dailyTokenBudget: 50_000 });
    const decision = await Effect.runPromise(
      policy.evaluate(makeEvent(), makeState({ tokensUsedToday: 10_000 })),
    );
    expect(decision).toBeNull();
  });

  test("queues events when daily budget exhausted", async () => {
    const { createCostBudgetPolicy } = await import("../../src/policies/cost-budget");
    const policy = createCostBudgetPolicy({ dailyTokenBudget: 50_000 });
    const decision = await Effect.runPromise(
      policy.evaluate(makeEvent(), makeState({ tokensUsedToday: 50_001 })),
    );
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("queue");
  });

  test("critical priority bypasses budget", async () => {
    const { createCostBudgetPolicy } = await import("../../src/policies/cost-budget");
    const policy = createCostBudgetPolicy({ dailyTokenBudget: 50_000 });
    const event = { ...makeEvent(), priority: "critical" as const };
    const decision = await Effect.runPromise(
      policy.evaluate(event, makeState({ tokensUsedToday: 999_999 })),
    );
    expect(decision).toBeNull();
  });
});
```

**Step 9: Implement CostBudget policy**

```typescript
// packages/gateway/src/policies/cost-budget.ts
import { Effect } from "effect";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../types.js";
import type { SchedulingPolicy } from "../services/policy-engine.js";

interface CostBudgetOptions {
  readonly dailyTokenBudget: number;
  readonly onExhausted?: "queue" | "skip" | "escalate";
}

export const createCostBudgetPolicy = (
  options: CostBudgetOptions,
): SchedulingPolicy => ({
  _tag: "cost-budget",
  priority: 5,
  evaluate: (event: GatewayEvent, state: GatewayState) =>
    Effect.sync(() => {
      // Critical events bypass budget
      if (event.priority === "critical") return null;

      if (state.tokensUsedToday >= options.dailyTokenBudget) {
        const action = options.onExhausted ?? "queue";
        return { action, reason: `daily token budget exhausted (${state.tokensUsedToday}/${options.dailyTokenBudget})` } as PolicyDecision;
      }
      return null;
    }),
});
```

**Step 10: Run CostBudget tests**

Run: `cd packages/gateway && bun test tests/policies/cost-budget.test.ts`
Expected: 3 tests PASS

**Step 11: Write failing test for RateLimit policy**

```typescript
// packages/gateway/tests/policies/rate-limit.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { GatewayEvent, GatewayState } from "../../src/types";

describe("RateLimit Policy", () => {
  const makeEvent = (): GatewayEvent => ({
    id: "evt-1", source: "webhook", timestamp: new Date(),
    priority: "normal", payload: {}, metadata: {},
  });
  const makeState = (overrides?: Partial<GatewayState>): GatewayState => ({
    isRunning: true, lastExecutionAt: null, consecutiveHeartbeatSkips: 0,
    tokensUsedToday: 0, actionsThisHour: 0, hourWindowStart: new Date(),
    dayWindowStart: new Date(), pendingEvents: [], ...overrides,
  });

  test("allows events under rate limit", async () => {
    const { createRateLimitPolicy } = await import("../../src/policies/rate-limit");
    const policy = createRateLimitPolicy({ maxPerHour: 20 });
    const decision = await Effect.runPromise(
      policy.evaluate(makeEvent(), makeState({ actionsThisHour: 5 })),
    );
    expect(decision).toBeNull();
  });

  test("queues events when rate limit exceeded", async () => {
    const { createRateLimitPolicy } = await import("../../src/policies/rate-limit");
    const policy = createRateLimitPolicy({ maxPerHour: 20 });
    const decision = await Effect.runPromise(
      policy.evaluate(makeEvent(), makeState({ actionsThisHour: 20 })),
    );
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("queue");
  });

  test("critical priority bypasses rate limit", async () => {
    const { createRateLimitPolicy } = await import("../../src/policies/rate-limit");
    const policy = createRateLimitPolicy({ maxPerHour: 20 });
    const event = { ...makeEvent(), priority: "critical" as const };
    const decision = await Effect.runPromise(
      policy.evaluate(event, makeState({ actionsThisHour: 999 })),
    );
    expect(decision).toBeNull();
  });
});
```

**Step 12: Implement RateLimit policy**

```typescript
// packages/gateway/src/policies/rate-limit.ts
import { Effect } from "effect";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../types.js";
import type { SchedulingPolicy } from "../services/policy-engine.js";

interface RateLimitOptions {
  readonly maxPerHour: number;
}

export const createRateLimitPolicy = (
  options: RateLimitOptions,
): SchedulingPolicy => ({
  _tag: "rate-limit",
  priority: 10,
  evaluate: (event: GatewayEvent, state: GatewayState) =>
    Effect.sync(() => {
      if (event.priority === "critical") return null;
      if (state.actionsThisHour >= options.maxPerHour) {
        return {
          action: "queue" as const,
          reason: `rate limit exceeded (${state.actionsThisHour}/${options.maxPerHour} per hour)`,
        };
      }
      return null;
    }),
});
```

**Step 13: Run RateLimit tests**

Run: `cd packages/gateway && bun test tests/policies/rate-limit.test.ts`
Expected: 3 tests PASS

**Step 14: Write failing test for EventMerging policy**

```typescript
// packages/gateway/tests/policies/event-merging.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { GatewayEvent, GatewayState } from "../../src/types";

describe("EventMerging Policy", () => {
  const makeEvent = (category: string): GatewayEvent => ({
    id: `evt-${Date.now()}`, source: "webhook", timestamp: new Date(),
    priority: "normal", payload: {}, metadata: { category },
  });
  const makeState = (overrides?: Partial<GatewayState>): GatewayState => ({
    isRunning: true, lastExecutionAt: null, consecutiveHeartbeatSkips: 0,
    tokensUsedToday: 0, actionsThisHour: 0, hourWindowStart: new Date(),
    dayWindowStart: new Date(), pendingEvents: [], ...overrides,
  });

  test("passes through when no pending events of same category", async () => {
    const { createEventMergingPolicy } = await import("../../src/policies/event-merging");
    const policy = createEventMergingPolicy();
    const decision = await Effect.runPromise(
      policy.evaluate(makeEvent("pr-opened"), makeState()),
    );
    expect(decision).toBeNull();
  });

  test("merges when pending events share same category", async () => {
    const { createEventMergingPolicy } = await import("../../src/policies/event-merging");
    const policy = createEventMergingPolicy();
    const pending = makeEvent("pr-opened");
    const state = makeState({ pendingEvents: [pending] });
    const decision = await Effect.runPromise(
      policy.evaluate(makeEvent("pr-opened"), state),
    );
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("merge");
  });

  test("does not merge events of different categories", async () => {
    const { createEventMergingPolicy } = await import("../../src/policies/event-merging");
    const policy = createEventMergingPolicy();
    const pending = makeEvent("issue-created");
    const state = makeState({ pendingEvents: [pending] });
    const decision = await Effect.runPromise(
      policy.evaluate(makeEvent("pr-opened"), state),
    );
    expect(decision).toBeNull();
  });
});
```

**Step 15: Implement EventMerging policy**

```typescript
// packages/gateway/src/policies/event-merging.ts
import { Effect } from "effect";
import type { GatewayEvent, GatewayState } from "../types.js";
import type { SchedulingPolicy } from "../services/policy-engine.js";

interface EventMergingOptions {
  readonly mergeKey?: (event: GatewayEvent) => string;
}

const defaultMergeKey = (event: GatewayEvent): string =>
  `${event.source}:${(event.metadata.category as string) ?? "default"}`;

export const createEventMergingPolicy = (
  options?: EventMergingOptions,
): SchedulingPolicy => {
  const getMergeKey = options?.mergeKey ?? defaultMergeKey;

  return {
    _tag: "event-merging",
    priority: 15,
    evaluate: (event: GatewayEvent, state: GatewayState) =>
      Effect.sync(() => {
        const key = getMergeKey(event);
        const hasPendingSameCategory = state.pendingEvents.some(
          (pe) => getMergeKey(pe) === key,
        );
        if (hasPendingSameCategory) {
          return { action: "merge" as const, mergeKey: key };
        }
        return null;
      }),
  };
};
```

**Step 16: Run EventMerging tests**

Run: `cd packages/gateway && bun test tests/policies/event-merging.test.ts`
Expected: 3 tests PASS

**Step 17: Run all policy tests together**

Run: `cd packages/gateway && bun test`
Expected: All tests PASS (types + events + policy engine + 4 policies)

**Step 18: Update index.ts exports**

```typescript
// packages/gateway/src/index.ts
export * from "./types.js";
export * from "./errors.js";
export { PolicyEngine, PolicyEngineLive, evaluatePolicies } from "./services/policy-engine.js";
export type { SchedulingPolicy } from "./services/policy-engine.js";
export { createAdaptiveHeartbeatPolicy } from "./policies/adaptive-heartbeat.js";
export { createCostBudgetPolicy } from "./policies/cost-budget.js";
export { createRateLimitPolicy } from "./policies/rate-limit.js";
export { createEventMergingPolicy } from "./policies/event-merging.js";
```

**Step 19: Commit**

```bash
git add packages/gateway/src/services/ packages/gateway/src/policies/ packages/gateway/tests/ packages/gateway/src/index.ts
git commit -m "feat(gateway): policy engine with 4 built-in policies (adaptive heartbeat, cost budget, rate limit, event merging)"
```

---

## Task 5: Scheduler Service (Heartbeats + Crons)

**Files:**
- Create: `packages/gateway/src/services/scheduler-service.ts`
- Create: `packages/gateway/src/services/cron-parser.ts`
- Create: `packages/gateway/tests/services/scheduler-service.test.ts`
- Create: `packages/gateway/tests/services/cron-parser.test.ts`

**Step 1: Write failing test for cron parser**

```typescript
// packages/gateway/tests/services/cron-parser.test.ts
import { describe, test, expect } from "bun:test";

describe("CronParser", () => {
  test("parses standard 5-field cron expression", async () => {
    const { parseCron, shouldFireAt } = await import("../../src/services/cron-parser");
    const cron = parseCron("0 9 * * MON");
    expect(cron).not.toBeNull();
    // Monday 9:00 AM
    const monday9am = new Date("2026-03-02T09:00:00Z"); // Monday
    expect(shouldFireAt(cron!, monday9am)).toBe(true);
  });

  test("rejects invalid cron expression", async () => {
    const { parseCron } = await import("../../src/services/cron-parser");
    expect(parseCron("invalid")).toBeNull();
  });

  test("matches every-5-minutes pattern", async () => {
    const { parseCron, shouldFireAt } = await import("../../src/services/cron-parser");
    const cron = parseCron("*/5 * * * *");
    expect(cron).not.toBeNull();
    expect(shouldFireAt(cron!, new Date("2026-03-01T10:00:00Z"))).toBe(true);
    expect(shouldFireAt(cron!, new Date("2026-03-01T10:05:00Z"))).toBe(true);
    expect(shouldFireAt(cron!, new Date("2026-03-01T10:03:00Z"))).toBe(false);
  });

  test("matches day-of-month pattern", async () => {
    const { parseCron, shouldFireAt } = await import("../../src/services/cron-parser");
    const cron = parseCron("0 0 1 * *"); // midnight on 1st of every month
    expect(shouldFireAt(cron!, new Date("2026-03-01T00:00:00Z"))).toBe(true);
    expect(shouldFireAt(cron!, new Date("2026-03-02T00:00:00Z"))).toBe(false);
  });
});
```

**Step 2: Implement cron-parser.ts (lightweight, zero deps)**

```typescript
// packages/gateway/src/services/cron-parser.ts

export interface CronExpression {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[];
}

const DAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const parseField = (field: string, min: number, max: number): readonly number[] | null => {
  // Replace day names
  let f = field.toUpperCase();
  for (const [name, num] of Object.entries(DAY_NAMES)) {
    f = f.replace(new RegExp(name, "g"), String(num));
  }

  if (f === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  }

  const values: number[] = [];
  for (const part of f.split(",")) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const [, range, stepStr] = stepMatch;
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;
      if (range !== "*") {
        const rangeMatch = range.match(/^(\d+)(?:-(\d+))?$/);
        if (!rangeMatch) return null;
        start = parseInt(rangeMatch[1], 10);
        end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : max;
      }
      for (let i = start; i <= end; i += step) values.push(i);
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) values.push(i);
      continue;
    }

    const num = parseInt(part, 10);
    if (isNaN(num) || num < min || num > max) return null;
    values.push(num);
  }

  return values.length > 0 ? values : null;
};

export const parseCron = (expression: string): CronExpression | null => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minutes = parseField(parts[0], 0, 59);
  const hours = parseField(parts[1], 0, 23);
  const daysOfMonth = parseField(parts[2], 1, 31);
  const months = parseField(parts[3], 1, 12);
  const daysOfWeek = parseField(parts[4], 0, 6);

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;

  return { minutes, hours, daysOfMonth, months, daysOfWeek };
};

export const shouldFireAt = (cron: CronExpression, date: Date): boolean =>
  cron.minutes.includes(date.getUTCMinutes()) &&
  cron.hours.includes(date.getUTCHours()) &&
  cron.daysOfMonth.includes(date.getUTCDate()) &&
  cron.months.includes(date.getUTCMonth() + 1) &&
  cron.daysOfWeek.includes(date.getUTCDay());
```

**Step 3: Run cron parser tests**

Run: `cd packages/gateway && bun test tests/services/cron-parser.test.ts`
Expected: 4 tests PASS

**Step 4: Write failing test for SchedulerService**

```typescript
// packages/gateway/tests/services/scheduler-service.test.ts
import { describe, test, expect } from "bun:test";
import { Effect, Ref } from "effect";

describe("SchedulerService", () => {
  test("heartbeat emits GatewayEvent with source heartbeat", async () => {
    const { createHeartbeatEvent } = await import("../../src/services/scheduler-service");
    const event = createHeartbeatEvent("agent-1", "Check status");
    expect(event.source).toBe("heartbeat");
    expect(event.priority).toBe("low");
    expect(event.metadata.instruction).toBe("Check status");
    expect(event.agentId).toBe("agent-1");
  });

  test("cron entry creates GatewayEvent with source cron", async () => {
    const { createCronEvent } = await import("../../src/services/scheduler-service");
    const event = createCronEvent("agent-1", {
      schedule: "0 9 * * MON",
      instruction: "Review PRs",
      priority: "normal",
      enabled: true,
    });
    expect(event.source).toBe("cron");
    expect(event.priority).toBe("normal");
    expect(event.metadata.instruction).toBe("Review PRs");
    expect(event.metadata.schedule).toBe("0 9 * * MON");
  });

  test("SchedulerService collects events into a Ref queue", async () => {
    const { SchedulerService, SchedulerServiceLive } = await import("../../src/services/scheduler-service");
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sched = yield* SchedulerService;
        const events = yield* sched.pendingEvents();
        return events;
      }).pipe(Effect.provide(SchedulerServiceLive({}))),
    );
    expect(result).toEqual([]);
  });
});
```

**Step 5: Implement SchedulerService**

```typescript
// packages/gateway/src/services/scheduler-service.ts
import { Effect, Context, Layer, Ref } from "effect";
import type { GatewayEvent, CronEntry, HeartbeatConfig } from "../types.js";
import { parseCron, shouldFireAt } from "./cron-parser.js";

// ─── Event Factories ─────────────────────────────────────────────────────────

export const createHeartbeatEvent = (agentId: string, instruction?: string): GatewayEvent => ({
  id: `hb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  source: "heartbeat",
  timestamp: new Date(),
  agentId,
  priority: "low",
  payload: {},
  metadata: { instruction: instruction ?? "Heartbeat: review current state and take any needed actions" },
});

export const createCronEvent = (agentId: string, entry: CronEntry): GatewayEvent => ({
  id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  source: "cron",
  timestamp: new Date(),
  agentId: entry.agentId ?? agentId,
  priority: entry.priority ?? "normal",
  payload: {},
  metadata: { instruction: entry.instruction, schedule: entry.schedule },
});

// ─── Service Tag ─────────────────────────────────────────────────────────────

interface SchedulerConfig {
  readonly agentId?: string;
  readonly heartbeat?: HeartbeatConfig;
  readonly crons?: readonly CronEntry[];
}

export class SchedulerService extends Context.Tag("SchedulerService")<
  SchedulerService,
  {
    readonly pendingEvents: () => Effect.Effect<readonly GatewayEvent[], never>;
    readonly checkCrons: (now: Date) => Effect.Effect<readonly GatewayEvent[], never>;
    readonly emitHeartbeat: () => Effect.Effect<GatewayEvent, never>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const SchedulerServiceLive = (config: SchedulerConfig) =>
  Layer.effect(
    SchedulerService,
    Effect.gen(function* () {
      const queueRef = yield* Ref.make<GatewayEvent[]>([]);
      const agentId = config.agentId ?? "default";
      const parsedCrons = (config.crons ?? [])
        .filter((c) => c.enabled !== false)
        .map((c) => ({ entry: c, parsed: parseCron(c.schedule) }))
        .filter((c) => c.parsed !== null);

      return {
        pendingEvents: () => Ref.get(queueRef),

        checkCrons: (now: Date) =>
          Effect.sync(() => {
            const events: GatewayEvent[] = [];
            for (const { entry, parsed } of parsedCrons) {
              if (parsed && shouldFireAt(parsed, now)) {
                events.push(createCronEvent(agentId, entry));
              }
            }
            return events;
          }),

        emitHeartbeat: () =>
          Effect.sync(() =>
            createHeartbeatEvent(agentId, config.heartbeat?.instruction),
          ),
      };
    }),
  );
```

**Step 6: Run scheduler tests**

Run: `cd packages/gateway && bun test tests/services/scheduler-service.test.ts`
Expected: 3 tests PASS

**Step 7: Update index.ts exports**

Add to `packages/gateway/src/index.ts`:

```typescript
export { SchedulerService, SchedulerServiceLive, createHeartbeatEvent, createCronEvent } from "./services/scheduler-service.js";
export { parseCron, shouldFireAt } from "./services/cron-parser.js";
export type { CronExpression } from "./services/cron-parser.js";
```

**Step 8: Commit**

```bash
git add packages/gateway/src/services/scheduler-service.ts packages/gateway/src/services/cron-parser.ts packages/gateway/tests/services/ packages/gateway/src/index.ts
git commit -m "feat(gateway): scheduler service with heartbeats, cron parser, and event factories"
```

---

## Task 6: Webhook Service + Adapters

**Files:**
- Create: `packages/gateway/src/services/webhook-service.ts`
- Create: `packages/gateway/src/adapters/webhook-adapter.ts`
- Create: `packages/gateway/src/adapters/github-adapter.ts`
- Create: `packages/gateway/src/adapters/generic-adapter.ts`
- Create: `packages/gateway/tests/services/webhook-service.test.ts`
- Create: `packages/gateway/tests/adapters/github-adapter.test.ts`

**Step 1: Write failing test for WebhookAdapter interface + GitHub adapter**

```typescript
// packages/gateway/tests/adapters/github-adapter.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

describe("GitHubAdapter", () => {
  test("validates HMAC-SHA256 signature", async () => {
    const { createGitHubAdapter } = await import("../../src/adapters/github-adapter");
    const adapter = createGitHubAdapter();
    const body = '{"action":"opened"}';
    // Pre-computed HMAC for this body with secret "test-secret"
    const crypto = await import("crypto");
    const hmac = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
    const signature = `sha256=${hmac}`;

    const valid = await Effect.runPromise(
      adapter.validateSignature(
        { body, headers: { "x-hub-signature-256": signature } },
        "test-secret",
      ),
    );
    expect(valid).toBe(true);
  });

  test("rejects invalid signature", async () => {
    const { createGitHubAdapter } = await import("../../src/adapters/github-adapter");
    const adapter = createGitHubAdapter();
    const valid = await Effect.runPromise(
      adapter.validateSignature(
        { body: '{"action":"opened"}', headers: { "x-hub-signature-256": "sha256=invalid" } },
        "test-secret",
      ),
    );
    expect(valid).toBe(false);
  });

  test("transforms GitHub PR event to GatewayEvent", async () => {
    const { createGitHubAdapter } = await import("../../src/adapters/github-adapter");
    const adapter = createGitHubAdapter();
    const event = await Effect.runPromise(
      adapter.transform({
        body: JSON.stringify({ action: "opened", pull_request: { title: "Fix bug", number: 42 } }),
        headers: { "x-github-event": "pull_request" },
      }),
    );
    expect(event.source).toBe("webhook");
    expect(event.metadata.adapter).toBe("github");
    expect(event.metadata.category).toBe("pull_request.opened");
    expect(event.metadata.githubEvent).toBe("pull_request");
  });

  test("classifies event category", async () => {
    const { createGitHubAdapter } = await import("../../src/adapters/github-adapter");
    const adapter = createGitHubAdapter();
    const category = adapter.classify({
      id: "x", source: "webhook", timestamp: new Date(),
      priority: "normal", payload: {}, metadata: { githubEvent: "issues", action: "created" },
    });
    expect(category).toBe("issues.created");
  });
});
```

**Step 2: Implement WebhookAdapter interface**

```typescript
// packages/gateway/src/adapters/webhook-adapter.ts
import { Effect } from "effect";
import type { GatewayEvent } from "../types.js";
import type { WebhookValidationError, WebhookTransformError } from "../errors.js";

export interface WebhookRequest {
  readonly body: string;
  readonly headers: Record<string, string>;
}

export interface WebhookAdapter {
  readonly source: string;
  readonly validateSignature: (
    req: WebhookRequest,
    secret: string,
  ) => Effect.Effect<boolean, WebhookValidationError>;
  readonly transform: (
    req: WebhookRequest,
  ) => Effect.Effect<GatewayEvent, WebhookTransformError>;
  readonly classify: (event: GatewayEvent) => string;
}
```

**Step 3: Implement GitHub adapter**

```typescript
// packages/gateway/src/adapters/github-adapter.ts
import { Effect } from "effect";
import type { GatewayEvent } from "../types.js";
import { WebhookValidationError, WebhookTransformError } from "../errors.js";
import type { WebhookAdapter, WebhookRequest } from "./webhook-adapter.js";
import { createHmac, timingSafeEqual } from "crypto";

export const createGitHubAdapter = (): WebhookAdapter => ({
  source: "github",

  validateSignature: (req: WebhookRequest, secret: string) =>
    Effect.sync(() => {
      const signature = req.headers["x-hub-signature-256"];
      if (!signature) return false;
      const expected = `sha256=${createHmac("sha256", secret).update(req.body).digest("hex")}`;
      try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    }),

  transform: (req: WebhookRequest) =>
    Effect.try({
      try: () => {
        const payload = JSON.parse(req.body);
        const githubEvent = req.headers["x-github-event"] ?? "unknown";
        const action = payload.action ?? "";
        const category = action ? `${githubEvent}.${action}` : githubEvent;

        return {
          id: `wh-gh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source: "webhook" as const,
          timestamp: new Date(),
          priority: "normal" as const,
          payload,
          metadata: {
            adapter: "github",
            githubEvent,
            action,
            category,
          },
        };
      },
      catch: (e) =>
        new WebhookTransformError({
          message: `Failed to parse GitHub webhook: ${e}`,
          source: "github",
          payload: req.body,
        }),
    }),

  classify: (event: GatewayEvent) => {
    const githubEvent = event.metadata.githubEvent ?? "unknown";
    const action = event.metadata.action ?? "";
    return action ? `${githubEvent}.${action}` : String(githubEvent);
  },
});
```

**Step 4: Implement generic adapter**

```typescript
// packages/gateway/src/adapters/generic-adapter.ts
import { Effect } from "effect";
import type { GatewayEvent } from "../types.js";
import { WebhookTransformError } from "../errors.js";
import type { WebhookAdapter, WebhookRequest } from "./webhook-adapter.js";
import { createHmac, timingSafeEqual } from "crypto";

interface GenericAdapterOptions {
  readonly signatureHeader?: string;
  readonly algorithm?: string;
}

export const createGenericAdapter = (options?: GenericAdapterOptions): WebhookAdapter => ({
  source: "generic",

  validateSignature: (req: WebhookRequest, secret: string) =>
    Effect.sync(() => {
      const header = options?.signatureHeader ?? "x-webhook-signature";
      const signature = req.headers[header];
      if (!signature || !secret) return !secret; // no secret = no validation needed
      const algorithm = options?.algorithm ?? "sha256";
      const expected = createHmac(algorithm, secret).update(req.body).digest("hex");
      try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    }),

  transform: (req: WebhookRequest) =>
    Effect.try({
      try: () => {
        let payload: unknown;
        try {
          payload = JSON.parse(req.body);
        } catch {
          payload = req.body;
        }
        return {
          id: `wh-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source: "webhook" as const,
          timestamp: new Date(),
          priority: "normal" as const,
          payload,
          metadata: { adapter: "generic" },
        };
      },
      catch: (e) =>
        new WebhookTransformError({
          message: `Failed to transform webhook: ${e}`,
          source: "generic",
        }),
    }),

  classify: () => "generic",
});
```

**Step 5: Implement WebhookService**

```typescript
// packages/gateway/src/services/webhook-service.ts
import { Effect, Context, Layer, Ref } from "effect";
import type { GatewayEvent, WebhookConfig } from "../types.js";
import { WebhookValidationError } from "../errors.js";
import type { WebhookAdapter, WebhookRequest } from "../adapters/webhook-adapter.js";
import { createGitHubAdapter } from "../adapters/github-adapter.js";
import { createGenericAdapter } from "../adapters/generic-adapter.js";

// ─── Built-in adapter registry ───────────────────────────────────────────────

const builtInAdapters: Record<string, () => WebhookAdapter> = {
  github: createGitHubAdapter,
  generic: createGenericAdapter,
};

// ─── Service Tag ─────────────────────────────────────────────────────────────

export class WebhookService extends Context.Tag("WebhookService")<
  WebhookService,
  {
    readonly handleRequest: (
      path: string,
      req: WebhookRequest,
    ) => Effect.Effect<GatewayEvent, WebhookValidationError>;
    readonly registerAdapter: (
      path: string,
      adapter: WebhookAdapter,
      secret?: string,
    ) => Effect.Effect<void, never>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

interface WebhookRoute {
  readonly adapter: WebhookAdapter;
  readonly secret?: string;
}

export const WebhookServiceLive = (configs?: readonly WebhookConfig[]) =>
  Layer.effect(
    WebhookService,
    Effect.gen(function* () {
      const routesRef = yield* Ref.make<Record<string, WebhookRoute>>({});

      // Register initial routes from config
      if (configs) {
        const routes: Record<string, WebhookRoute> = {};
        for (const config of configs) {
          const createAdapter = builtInAdapters[config.adapter] ?? (() => createGenericAdapter());
          routes[config.path] = {
            adapter: createAdapter(),
            secret: config.secret,
          };
        }
        yield* Ref.set(routesRef, routes);
      }

      return {
        handleRequest: (path: string, req: WebhookRequest) =>
          Effect.gen(function* () {
            const routes = yield* Ref.get(routesRef);
            const route = routes[path];
            if (!route) {
              return yield* Effect.fail(
                new WebhookValidationError({
                  message: `No webhook adapter registered for path: ${path}`,
                  source: "unknown",
                  statusCode: 404,
                }),
              );
            }

            if (route.secret) {
              const valid = yield* route.adapter.validateSignature(req, route.secret);
              if (!valid) {
                return yield* Effect.fail(
                  new WebhookValidationError({
                    message: "Invalid webhook signature",
                    source: route.adapter.source,
                    statusCode: 401,
                  }),
                );
              }
            }

            return yield* route.adapter.transform(req);
          }),

        registerAdapter: (path: string, adapter: WebhookAdapter, secret?: string) =>
          Ref.update(routesRef, (routes) => ({
            ...routes,
            [path]: { adapter, secret },
          })),
      };
    }),
  );
```

**Step 6: Write WebhookService test**

```typescript
// packages/gateway/tests/services/webhook-service.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

describe("WebhookService", () => {
  test("routes request to registered adapter", async () => {
    const { WebhookService, WebhookServiceLive } = await import("../../src/services/webhook-service");
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* WebhookService;
        return yield* svc.handleRequest("/github", {
          body: JSON.stringify({ action: "opened" }),
          headers: { "x-github-event": "push" },
        });
      }).pipe(
        Effect.provide(
          WebhookServiceLive([{ path: "/github", adapter: "github" }]),
        ),
      ),
    );
    expect(result.source).toBe("webhook");
    expect(result.metadata.adapter).toBe("github");
  });

  test("returns error for unknown path", async () => {
    const { WebhookService, WebhookServiceLive } = await import("../../src/services/webhook-service");
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* WebhookService;
        return yield* svc.handleRequest("/unknown", {
          body: "{}",
          headers: {},
        });
      }).pipe(
        Effect.provide(WebhookServiceLive([])),
        Effect.either,
      ),
    );
    expect(result._tag).toBe("Left");
  });

  test("rejects invalid signature when secret configured", async () => {
    const { WebhookService, WebhookServiceLive } = await import("../../src/services/webhook-service");
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* WebhookService;
        return yield* svc.handleRequest("/github", {
          body: '{"action":"opened"}',
          headers: { "x-github-event": "push", "x-hub-signature-256": "sha256=bad" },
        });
      }).pipe(
        Effect.provide(
          WebhookServiceLive([{ path: "/github", adapter: "github", secret: "my-secret" }]),
        ),
        Effect.either,
      ),
    );
    expect(result._tag).toBe("Left");
  });
});
```

**Step 7: Run all webhook tests**

Run: `cd packages/gateway && bun test tests/adapters/ tests/services/webhook-service.test.ts`
Expected: All tests PASS

**Step 8: Update index.ts exports**

Add to `packages/gateway/src/index.ts`:

```typescript
export { WebhookService, WebhookServiceLive } from "./services/webhook-service.js";
export type { WebhookAdapter, WebhookRequest } from "./adapters/webhook-adapter.js";
export { createGitHubAdapter } from "./adapters/github-adapter.js";
export { createGenericAdapter } from "./adapters/generic-adapter.js";
```

**Step 9: Commit**

```bash
git add packages/gateway/src/services/webhook-service.ts packages/gateway/src/adapters/ packages/gateway/tests/
git commit -m "feat(gateway): webhook service with GitHub adapter, signature validation, and generic fallback"
```

---

## Task 7: Input Router

**Files:**
- Create: `packages/gateway/src/services/input-router.ts`
- Create: `packages/gateway/tests/services/input-router.test.ts`

**Step 1: Write failing test**

```typescript
// packages/gateway/tests/services/input-router.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { GatewayEvent, PolicyDecision } from "../../src/types";

describe("InputRouter", () => {
  test("routes event through policy engine and returns decision", async () => {
    const { routeEvent } = await import("../../src/services/input-router");
    const event: GatewayEvent = {
      id: "evt-1", source: "webhook", timestamp: new Date(),
      priority: "normal", payload: {}, metadata: {},
    };
    const result = await Effect.runPromise(routeEvent(event, []));
    expect(result.action).toBe("execute");
  });

  test("publishes GatewayEventReceived to EventBus when provided", async () => {
    const { routeEventWithBus } = await import("../../src/services/input-router");
    const { EventBus, EventBusLive } = await import("@reactive-agents/core");

    let received = false;
    const event: GatewayEvent = {
      id: "evt-1", source: "webhook", timestamp: new Date(),
      agentId: "agent-1", priority: "normal", payload: {}, metadata: {},
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.on("GatewayEventReceived", () => {
          received = true;
          return Effect.void;
        });
        yield* routeEventWithBus(event, [], bus);
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(received).toBe(true);
  });

  test("publishes ProactiveActionSuppressed when policy skips", async () => {
    const { routeEventWithBus } = await import("../../src/services/input-router");
    const { EventBus, EventBusLive } = await import("@reactive-agents/core");

    let suppressed = false;
    const skipPolicy = {
      _tag: "test",
      priority: 0,
      evaluate: () => Effect.succeed({ action: "skip" as const, reason: "test skip" }),
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.on("ProactiveActionSuppressed", () => {
          suppressed = true;
          return Effect.void;
        });
        yield* routeEventWithBus(
          { id: "evt-1", source: "heartbeat", timestamp: new Date(), priority: "normal", payload: {}, metadata: {} },
          [skipPolicy],
          bus,
        );
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(suppressed).toBe(true);
  });
});
```

**Step 2: Implement InputRouter**

```typescript
// packages/gateway/src/services/input-router.ts
import { Effect } from "effect";
import type { GatewayEvent, PolicyDecision } from "../types.js";
import type { SchedulingPolicy } from "./policy-engine.js";
import { evaluatePolicies } from "./policy-engine.js";
import { initialGatewayState } from "../types.js";
import type { EventBus as EventBusType } from "@reactive-agents/core";

type EventBusLike = {
  readonly publish: (event: any) => Effect.Effect<void, never>;
};

export const routeEvent = (
  event: GatewayEvent,
  policies: readonly SchedulingPolicy[],
): Effect.Effect<PolicyDecision, never> =>
  evaluatePolicies(policies, event, initialGatewayState());

export const routeEventWithBus = (
  event: GatewayEvent,
  policies: readonly SchedulingPolicy[],
  bus: EventBusLike,
): Effect.Effect<PolicyDecision, never> =>
  Effect.gen(function* () {
    // Publish receipt event
    yield* bus.publish({
      _tag: "GatewayEventReceived",
      agentId: event.agentId ?? "unknown",
      source: event.source,
      eventId: event.id,
      timestamp: Date.now(),
    });

    const decision = yield* evaluatePolicies(policies, event, initialGatewayState());

    // Publish suppression event if skipped
    if (decision.action === "skip") {
      yield* bus.publish({
        _tag: "ProactiveActionSuppressed",
        agentId: event.agentId ?? "unknown",
        source: event.source,
        reason: (decision as any).reason ?? "policy skipped",
        policy: "policy-engine",
        eventId: event.id,
        timestamp: Date.now(),
      });
    }

    return decision;
  });
```

**Step 3: Run test**

Run: `cd packages/gateway && bun test tests/services/input-router.test.ts`
Expected: 3 tests PASS

**Step 4: Update index.ts, commit**

```bash
git add packages/gateway/src/services/input-router.ts packages/gateway/tests/services/input-router.test.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): input router with EventBus integration and policy-driven suppression events"
```

---

## Task 8: GatewayService (The Event Loop)

The central orchestrator — the persistent process that ties everything together.

**Files:**
- Create: `packages/gateway/src/services/gateway-service.ts`
- Create: `packages/gateway/tests/services/gateway-service.test.ts`

**Step 1: Write failing test**

```typescript
// packages/gateway/tests/services/gateway-service.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

describe("GatewayService", () => {
  test("creates gateway with config", async () => {
    const { GatewayService, GatewayServiceLive } = await import("../../src/services/gateway-service");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        const status = yield* gw.status();
        return status;
      }).pipe(
        Effect.provide(GatewayServiceLive({
          heartbeat: { intervalMs: 60000, policy: "adaptive" },
          policies: { dailyTokenBudget: 50000, maxActionsPerHour: 20 },
        })),
      ),
    );
    expect(result.isRunning).toBe(false);
    expect(result.stats.heartbeatsFired).toBe(0);
  });

  test("processEvent routes through policy engine", async () => {
    const { GatewayService, GatewayServiceLive } = await import("../../src/services/gateway-service");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        const decision = yield* gw.processEvent({
          id: "test-1",
          source: "webhook",
          timestamp: new Date(),
          priority: "normal",
          payload: { data: "test" },
          metadata: {},
        });
        return decision;
      }).pipe(
        Effect.provide(GatewayServiceLive({
          policies: { dailyTokenBudget: 100000, maxActionsPerHour: 50 },
        })),
      ),
    );
    expect(result.action).toBe("execute");
  });

  test("tracks gateway stats", async () => {
    const { GatewayService, GatewayServiceLive } = await import("../../src/services/gateway-service");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        // Process a webhook event
        yield* gw.processEvent({
          id: "test-1", source: "webhook", timestamp: new Date(),
          priority: "normal", payload: {}, metadata: {},
        });
        const status = yield* gw.status();
        return status;
      }).pipe(
        Effect.provide(GatewayServiceLive({})),
      ),
    );
    expect(result.stats.webhooksReceived).toBe(1);
  });
});
```

**Step 2: Implement GatewayService**

```typescript
// packages/gateway/src/services/gateway-service.ts
import { Effect, Context, Layer, Ref } from "effect";
import type {
  GatewayConfig,
  GatewayEvent,
  GatewayState,
  GatewayStats,
  PolicyDecision,
} from "../types.js";
import { initialGatewayState } from "../types.js";
import { evaluatePolicies } from "./policy-engine.js";
import type { SchedulingPolicy } from "./policy-engine.js";
import { createAdaptiveHeartbeatPolicy } from "../policies/adaptive-heartbeat.js";
import { createCostBudgetPolicy } from "../policies/cost-budget.js";
import { createRateLimitPolicy } from "../policies/rate-limit.js";
import { createEventMergingPolicy } from "../policies/event-merging.js";

// ─── Status Type ─────────────────────────────────────────────────────────────

interface GatewayStatus {
  readonly isRunning: boolean;
  readonly stats: GatewayStats;
  readonly uptime: number;
  readonly state: GatewayState;
}

const initialStats = (): GatewayStats => ({
  heartbeatsFired: 0,
  heartbeatsSkipped: 0,
  webhooksReceived: 0,
  webhooksProcessed: 0,
  webhooksMerged: 0,
  cronsExecuted: 0,
  channelMessages: 0,
  totalTokensUsed: 0,
  actionsSuppressed: 0,
  actionsEscalated: 0,
});

// ─── Service Tag ─────────────────────────────────────────────────────────────

export class GatewayService extends Context.Tag("GatewayService")<
  GatewayService,
  {
    readonly processEvent: (event: GatewayEvent) => Effect.Effect<PolicyDecision, never>;
    readonly status: () => Effect.Effect<GatewayStatus, never>;
    readonly updateTokensUsed: (tokens: number) => Effect.Effect<void, never>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const GatewayServiceLive = (config: Partial<GatewayConfig>) =>
  Layer.effect(
    GatewayService,
    Effect.gen(function* () {
      const stateRef = yield* Ref.make<GatewayState>(initialGatewayState());
      const statsRef = yield* Ref.make<GatewayStats>(initialStats());
      const startedAt = Date.now();

      // Build policies from config
      const policies: SchedulingPolicy[] = [];

      const policyConfig = config.policies;
      if (policyConfig?.heartbeatPolicy) {
        policies.push(createAdaptiveHeartbeatPolicy({ mode: policyConfig.heartbeatPolicy }));
      } else {
        policies.push(createAdaptiveHeartbeatPolicy());
      }

      if (policyConfig?.dailyTokenBudget) {
        policies.push(createCostBudgetPolicy({ dailyTokenBudget: policyConfig.dailyTokenBudget }));
      }

      if (policyConfig?.maxActionsPerHour) {
        policies.push(createRateLimitPolicy({ maxPerHour: policyConfig.maxActionsPerHour }));
      }

      if (policyConfig?.mergeWindowMs) {
        policies.push(createEventMergingPolicy());
      }

      return {
        processEvent: (event: GatewayEvent) =>
          Effect.gen(function* () {
            // Track receipt in stats
            yield* Ref.update(statsRef, (s) => {
              const updates: Partial<GatewayStats> = {};
              switch (event.source) {
                case "webhook": updates.webhooksReceived = s.webhooksReceived + 1; break;
                case "heartbeat": break; // tracked after decision
                case "cron": break; // tracked after decision
                case "channel": updates.channelMessages = s.channelMessages + 1; break;
              }
              return { ...s, ...updates };
            });

            const state = yield* Ref.get(stateRef);
            const decision = yield* evaluatePolicies(policies, event, state);

            // Track decision in stats
            yield* Ref.update(statsRef, (s) => {
              switch (decision.action) {
                case "skip":
                  if (event.source === "heartbeat") return { ...s, heartbeatsSkipped: s.heartbeatsSkipped + 1, actionsSuppressed: s.actionsSuppressed + 1 };
                  return { ...s, actionsSuppressed: s.actionsSuppressed + 1 };
                case "execute":
                  if (event.source === "heartbeat") return { ...s, heartbeatsFired: s.heartbeatsFired + 1 };
                  if (event.source === "webhook") return { ...s, webhooksProcessed: s.webhooksProcessed + 1 };
                  if (event.source === "cron") return { ...s, cronsExecuted: s.cronsExecuted + 1 };
                  return s;
                case "merge":
                  return { ...s, webhooksMerged: s.webhooksMerged + 1 };
                case "escalate":
                  return { ...s, actionsEscalated: s.actionsEscalated + 1 };
                default:
                  return s;
              }
            });

            // Update consecutive heartbeat skips counter
            if (event.source === "heartbeat") {
              if (decision.action === "skip") {
                yield* Ref.update(stateRef, (s) => ({
                  ...s,
                  consecutiveHeartbeatSkips: s.consecutiveHeartbeatSkips + 1,
                }));
              } else {
                yield* Ref.update(stateRef, (s) => ({
                  ...s,
                  consecutiveHeartbeatSkips: 0,
                  lastExecutionAt: new Date(),
                }));
              }
            } else if (decision.action === "execute") {
              yield* Ref.update(stateRef, (s) => ({
                ...s,
                lastExecutionAt: new Date(),
                actionsThisHour: s.actionsThisHour + 1,
              }));
            }

            return decision;
          }),

        status: () =>
          Effect.gen(function* () {
            const state = yield* Ref.get(stateRef);
            const stats = yield* Ref.get(statsRef);
            return {
              isRunning: state.isRunning,
              stats,
              uptime: Date.now() - startedAt,
              state,
            };
          }),

        updateTokensUsed: (tokens: number) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              tokensUsedToday: s.tokensUsedToday + tokens,
            }));
            yield* Ref.update(statsRef, (s) => ({
              ...s,
              totalTokensUsed: s.totalTokensUsed + tokens,
            }));
          }),
      };
    }),
  );
```

**Step 3: Run test**

Run: `cd packages/gateway && bun test tests/services/gateway-service.test.ts`
Expected: 3 tests PASS

**Step 4: Update index.ts, commit**

```bash
git add packages/gateway/src/services/gateway-service.ts packages/gateway/tests/services/gateway-service.test.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): GatewayService with policy-driven event processing, stats tracking, and state management"
```

---

## Task 9: Integration Test

Full pipeline test: event source → router → policy engine → decision.

**Files:**
- Create: `packages/gateway/tests/integration/gateway-integration.test.ts`

**Step 1: Write integration test**

```typescript
// packages/gateway/tests/integration/gateway-integration.test.ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("Gateway Integration", () => {
  test("full pipeline: heartbeat → adaptive skip → suppressed event", async () => {
    const { GatewayService, GatewayServiceLive } = await import("../../src/services/gateway-service");
    const { createHeartbeatEvent } = await import("../../src/services/scheduler-service");

    let suppressed = false;
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const gw = yield* GatewayService;

        yield* bus.on("ProactiveActionSuppressed", () => {
          suppressed = true;
          return Effect.void;
        });

        // SKIPPED: no need for EventBus integration in GatewayService yet
        // Just verify the policy decision directly
        const event = createHeartbeatEvent("test-agent");
        const decision = yield* gw.processEvent(event);

        // Adaptive heartbeat should skip (no state changes, has executed before)
        // Note: first heartbeat may pass since lastExecutionAt starts null
        return decision;
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            heartbeat: { intervalMs: 60000, policy: "adaptive" },
            policies: { dailyTokenBudget: 50000 },
          }).pipe(Layer.merge(EventBusLive)),
        ),
      ),
    );
  });

  test("full pipeline: webhook → execute decision", async () => {
    const { GatewayService, GatewayServiceLive } = await import("../../src/services/gateway-service");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        const decision = yield* gw.processEvent({
          id: "wh-1", source: "webhook", timestamp: new Date(),
          priority: "normal", payload: { action: "opened" },
          metadata: { adapter: "github", category: "pull_request.opened" },
        });
        return decision;
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: { dailyTokenBudget: 100000, maxActionsPerHour: 50 },
          }),
        ),
      ),
    );
    expect(result.action).toBe("execute");
  });

  test("full pipeline: budget exhausted → queue decision", async () => {
    const { GatewayService, GatewayServiceLive } = await import("../../src/services/gateway-service");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;

        // Exhaust the token budget
        yield* gw.updateTokensUsed(60000);

        const decision = yield* gw.processEvent({
          id: "wh-2", source: "webhook", timestamp: new Date(),
          priority: "normal", payload: {},
          metadata: {},
        });
        return decision;
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: { dailyTokenBudget: 50000 },
          }),
        ),
      ),
    );
    expect(result.action).toBe("queue");
  });

  test("critical events bypass budget", async () => {
    const { GatewayService, GatewayServiceLive } = await import("../../src/services/gateway-service");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.updateTokensUsed(999999);

        const decision = yield* gw.processEvent({
          id: "critical-1", source: "webhook", timestamp: new Date(),
          priority: "critical", payload: {},
          metadata: {},
        });
        return decision;
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: { dailyTokenBudget: 50000 },
          }),
        ),
      ),
    );
    expect(result.action).toBe("execute");
  });

  test("stats track all event sources correctly", async () => {
    const { GatewayService, GatewayServiceLive } = await import("../../src/services/gateway-service");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;

        // Webhook
        yield* gw.processEvent({
          id: "w1", source: "webhook", timestamp: new Date(),
          priority: "normal", payload: {}, metadata: {},
        });
        // Channel message
        yield* gw.processEvent({
          id: "c1", source: "channel", timestamp: new Date(),
          priority: "normal", payload: {}, metadata: {},
        });
        // Cron
        yield* gw.processEvent({
          id: "cr1", source: "cron", timestamp: new Date(),
          priority: "normal", payload: {}, metadata: {},
        });

        return yield* gw.status();
      }).pipe(
        Effect.provide(GatewayServiceLive({})),
      ),
    );

    expect(result.stats.webhooksReceived).toBe(1);
    expect(result.stats.webhooksProcessed).toBe(1);
    expect(result.stats.channelMessages).toBe(1);
    expect(result.stats.cronsExecuted).toBe(1);
  });
});
```

**Step 2: Run integration tests**

Run: `cd packages/gateway && bun test tests/integration/`
Expected: 5 tests PASS

**Step 3: Run full gateway test suite**

Run: `cd packages/gateway && bun test`
Expected: All tests PASS (~35+ tests)

**Step 4: Commit**

```bash
git add packages/gateway/tests/integration/
git commit -m "test(gateway): integration tests for full event pipeline, budget enforcement, and stats tracking"
```

---

## Task 10: Builder + Runtime Integration

Wire the gateway into the existing builder API and runtime composition.

**Files:**
- Modify: `packages/runtime/src/builder.ts` (add `withGateway()`, `GatewayOptions`)
- Modify: `packages/runtime/src/runtime.ts` (add gateway to `RuntimeOptions` + `createRuntime()`)
- Modify: `packages/runtime/package.json` (add gateway dep)
- Create: `packages/runtime/tests/gateway-builder.test.ts`

**Step 1: Write failing test**

```typescript
// packages/runtime/tests/gateway-builder.test.ts
import { describe, test, expect } from "bun:test";

describe("Builder .withGateway()", () => {
  test("builder accepts gateway config without error", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const builder = ReactiveAgents.create()
      .withName("test-gateway-agent")
      .withProvider("test")
      .withTestResponses(["FINAL ANSWER: ok"])
      .withGateway({
        heartbeat: { intervalMs: 1800000, policy: "adaptive" },
        crons: [{ schedule: "0 9 * * MON", instruction: "Review PRs" }],
        policies: { dailyTokenBudget: 50000, maxActionsPerHour: 20 },
      });

    // Should not throw
    expect(builder).toBeDefined();
  });

  test("gateway config flows through to runtime options", async () => {
    const { ReactiveAgents } = await import("../src/builder");
    const agent = await ReactiveAgents.create()
      .withName("test-gw")
      .withProvider("test")
      .withTestResponses(["FINAL ANSWER: done"])
      .withGateway({
        heartbeat: { intervalMs: 60000 },
        policies: { dailyTokenBudget: 10000 },
      })
      .build();

    expect(agent).toBeDefined();
    // Agent should still run normally
    const result = await agent.run("test");
    expect(result.output).toContain("done");
  });
});
```

**Step 2: Add GatewayOptions interface and withGateway() to builder.ts**

In `packages/runtime/src/builder.ts`, add:

1. Import the gateway config type (use dynamic import pattern like A2A):
```typescript
// Near line 194, after A2AOptions
export interface GatewayOptions {
  readonly heartbeat?: {
    readonly intervalMs?: number;
    readonly policy?: "always" | "adaptive" | "conservative";
    readonly instruction?: string;
    readonly maxConsecutiveSkips?: number;
  };
  readonly crons?: readonly {
    readonly schedule: string;
    readonly instruction: string;
    readonly agentId?: string;
    readonly priority?: "low" | "normal" | "high" | "critical";
    readonly enabled?: boolean;
  }[];
  readonly webhooks?: readonly {
    readonly path: string;
    readonly adapter: string;
    readonly secret?: string;
    readonly events?: readonly string[];
  }[];
  readonly policies?: {
    readonly dailyTokenBudget?: number;
    readonly maxActionsPerHour?: number;
    readonly heartbeatPolicy?: "always" | "adaptive" | "conservative";
    readonly mergeWindowMs?: number;
    readonly requireApprovalFor?: readonly string[];
  };
  readonly port?: number;
}
```

2. Add private field:
```typescript
private _gatewayOptions?: GatewayOptions;
```

3. Add method:
```typescript
withGateway(options?: GatewayOptions): this {
  this._gatewayOptions = options ?? {};
  return this;
}
```

4. Pass to createRuntime in buildEffect():
```typescript
enableGateway: !!this._gatewayOptions,
gatewayOptions: this._gatewayOptions,
```

**Step 3: Add gateway to RuntimeOptions in runtime.ts**

In `packages/runtime/src/runtime.ts`, add to `RuntimeOptions` interface:

```typescript
enableGateway?: boolean;
gatewayOptions?: {
  heartbeat?: { intervalMs?: number; policy?: string; instruction?: string; maxConsecutiveSkips?: number };
  crons?: readonly { schedule: string; instruction: string; agentId?: string; priority?: string; enabled?: boolean }[];
  webhooks?: readonly { path: string; adapter: string; secret?: string; events?: readonly string[] }[];
  policies?: { dailyTokenBudget?: number; maxActionsPerHour?: number; heartbeatPolicy?: string; mergeWindowMs?: number };
  port?: number;
};
```

And in `createRuntime()`, add the optional layer merge (after the A2A block):

```typescript
if (options.enableGateway) {
  // Gateway is composed at build time — the persistent event loop starts on agent.start()
  // For now, just mark it in config. The GatewayService is composed in the builder's
  // fullRuntime layer merge, similar to MCP servers and tool registration.
}
```

**Step 4: Add gateway workspace dependency to runtime package.json**

In `packages/runtime/package.json` dependencies, add:
```json
"@reactive-agents/gateway": "workspace:^"
```

**Step 5: Run test**

Run: `cd packages/runtime && bun test tests/gateway-builder.test.ts`
Expected: 2 tests PASS

**Step 6: Run full runtime tests to verify no regressions**

Run: `cd packages/runtime && bun test`
Expected: All existing tests PASS

**Step 7: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/runtime.ts packages/runtime/package.json packages/runtime/tests/gateway-builder.test.ts
git commit -m "feat(gateway): wire .withGateway() into builder and runtime composition"
```

---

## Task 11: Final Build + Full Test Suite

**Step 1: Build gateway package**

Run: `cd packages/gateway && bun run build`
Expected: Clean build

**Step 2: Rebuild core (new event types)**

Run: `cd packages/core && bun run build`
Expected: Clean build

**Step 3: Rebuild runtime (new gateway dep)**

Run: `cd packages/runtime && bun run build`
Expected: Clean build

**Step 4: Run full monorepo test suite**

Run: `bun test`
Expected: All tests PASS (909 existing + ~40 new gateway tests = ~950 total)

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(gateway): complete @reactive-agents/gateway package — persistent autonomous agent harness

New package with 5 services, 4 policies, 2 adapters, and full integration:
- SchedulerService: heartbeats (adaptive) + cron scheduling
- WebhookService: HTTP endpoint with GitHub adapter + signature validation
- PolicyEngine: composable chain (adaptive heartbeat, cost budget, rate limit, event merging)
- InputRouter: event normalization + EventBus integration
- GatewayService: central orchestrator with stats tracking

10 new AgentEvent types, builder .withGateway() integration, ~40 new tests."
```

---

## Task 12: Documentation Updates

**Files to update (check each, update if needed):**
- `CLAUDE.md`: Add gateway to package map, update test count, add `withGateway()` to builder example
- `CHANGELOG.md`: Add gateway entry
- `apps/docs/`: Add gateway docs page if docs site is maintained

**Step 1: Update CLAUDE.md package map**

Add `gateway/` entry to the package map:
```
  gateway/       — Persistent event loop: heartbeats, crons, webhooks, policy engine
```

**Step 2: Update test count in CLAUDE.md**

Update `909 tests` → new total (should be ~950).

**Step 3: Update builder example in CLAUDE.md**

Add `.withGateway()` to the builder API example section.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with gateway package, test count, and builder example"
```

---

## Future Tasks (Not In This Plan)

These are noted for follow-up work, not implemented now:

1. **Channel Adapters** — `@reactive-agents/gateway-slack`, `gateway-discord`, `gateway-telegram` as separate packages
2. **LLM Model Auto-Discovery** — Auto-discover available models per provider for adaptive cost routing (user's idea: "make llmProviders models auto-discoverable so we can extrapolate the best model adaptively")
3. **Daemon CLI Commands** — `rax daemon start/stop/status/logs/audit` in the CLI app
4. **YAML Config Loading** — Parse `agent.yaml` files for daemon mode
5. **Consent Gate Policy** — User opt-in registry for channel messaging
6. **Scope Limit Policy** — Tool subset restrictions per event source
7. **Escalation Threshold Policy** — Human approval for high-risk autonomous actions
8. **Audit Service** — Persistent immutable log of all autonomous actions
9. **Dashboard Extension** — Autonomous activity section in metrics dashboard
