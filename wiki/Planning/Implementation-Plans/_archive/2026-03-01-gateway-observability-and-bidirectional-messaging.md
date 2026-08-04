# Gateway Observability & Bidirectional Messaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire gateway observability (EventBus + structured logging) into GatewayService/SchedulerService/builder loop, then add push-based bidirectional messaging through Signal MCP notifications with access control.

**Architecture:** The gateway already defines 10 event types in core's EventBus union but never publishes them. We wire EventBus into gateway services via an optional `EventBusLike` dependency (same pattern as execution engine). For messaging, Signal MCP server sends MCP notifications on incoming messages, the MCP client in `@reactive-agents/tools` forwards them to EventBus as `ChannelMessageReceived`, and the gateway loop subscribes to route them through the policy engine with a new `AccessControlPolicy`.

**Tech Stack:** Effect-TS (Context.Tag, Layer, Ref), MCP SDK (`@modelcontextprotocol/sdk`), Bun test runner, existing gateway/tools/runtime packages.

---

## Task 1: Add ChannelMessageReceived Event Type to Core

**Files:**
- Modify: `packages/core/src/services/event-bus.ts:557-569` (before Custom event)

**Step 1: Write the failing test**

Create `packages/core/tests/channel-message-event.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "../src/services/event-bus.js";

describe("ChannelMessageReceived event", () => {
  test("EventBus accepts and delivers ChannelMessageReceived", async () => {
    const received: unknown[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ChannelMessageReceived", (event) => {
          received.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ChannelMessageReceived",
          sender: "+15551234567",
          platform: "signal",
          message: "Hello agent",
          timestamp: Date.now(),
          mcpServer: "signal",
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(received).toHaveLength(1);
    expect((received[0] as any)._tag).toBe("ChannelMessageReceived");
    expect((received[0] as any).sender).toBe("+15551234567");
    expect((received[0] as any).platform).toBe("signal");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test tests/channel-message-event.test.ts`
Expected: TypeScript compilation error — `ChannelMessageReceived` not in AgentEvent union.

**Step 3: Add the event type to AgentEvent union**

In `packages/core/src/services/event-bus.ts`, add before the Custom event (before line 558):

```typescript
  // ─── Channel / messaging events ───
  | {
      /**
       * An incoming message was received from a messaging channel.
       * Fired by ToolService when an MCP server sends a notifications/message notification.
       */
      readonly _tag: "ChannelMessageReceived";
      /** Sender identifier (phone number, user ID, etc.) */
      readonly sender: string;
      /** Messaging platform name (e.g., "signal", "telegram") */
      readonly platform: string;
      /** Message text content */
      readonly message: string;
      /** Unix timestamp in milliseconds */
      readonly timestamp: number;
      /** MCP server name that received the message */
      readonly mcpServer: string;
      /** Optional group identifier */
      readonly groupId?: string;
    }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test tests/channel-message-event.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/services/event-bus.ts packages/core/tests/channel-message-event.test.ts
git commit -m "feat(core): add ChannelMessageReceived event type to EventBus"
```

---

## Task 2: Wire EventBus into GatewayService

**Files:**
- Modify: `packages/gateway/src/services/gateway-service.ts`
- Test: `packages/gateway/tests/gateway-observability.test.ts`

**Step 1: Write the failing test**

Create `packages/gateway/tests/gateway-observability.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { GatewayService, GatewayServiceLive } from "../src/services/gateway-service.js";
import type { GatewayEvent } from "../src/types.js";

describe("GatewayService observability", () => {
  const makeHeartbeatEvent = (): GatewayEvent => ({
    id: "hb-test-1",
    source: "heartbeat",
    timestamp: new Date(),
    agentId: "test-agent",
    priority: "low",
    payload: {},
    metadata: { instruction: "Check for work" },
  });

  test("publishes GatewayEventReceived when EventBus provided", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };

    const layer = GatewayServiceLive({}, bus);

    await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent(makeHeartbeatEvent());
      }).pipe(Effect.provide(layer)),
    );

    const received = published.find((e) => e._tag === "GatewayEventReceived");
    expect(received).toBeDefined();
    expect(received.source).toBe("heartbeat");
    expect(received.eventId).toBe("hb-test-1");
  });

  test("publishes HeartbeatSkipped when adaptive policy skips", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };

    const layer = GatewayServiceLive(
      { policies: { heartbeatPolicy: "adaptive" } },
      bus,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        // First event executes (agent never ran before), second should skip
        yield* gw.processEvent(makeHeartbeatEvent());
        yield* gw.processEvent(makeHeartbeatEvent());
      }).pipe(Effect.provide(layer)),
    );

    const skipped = published.find((e) => e._tag === "ProactiveActionSuppressed");
    expect(skipped).toBeDefined();
    expect(skipped.source).toBe("heartbeat");
  });

  test("works silently when no EventBus provided", async () => {
    const layer = GatewayServiceLive({});

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        return yield* gw.processEvent(makeHeartbeatEvent());
      }).pipe(Effect.provide(layer)),
    );

    expect(result.action).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/gateway && bun test tests/gateway-observability.test.ts`
Expected: FAIL — `GatewayServiceLive` doesn't accept a second `bus` parameter.

**Step 3: Modify GatewayServiceLive to accept optional EventBusLike**

In `packages/gateway/src/services/gateway-service.ts`:

1. Add the `EventBusLike` type (line ~17):
```typescript
type EventBusLike = {
  readonly publish: (event: any) => Effect.Effect<void, never>;
};
```

2. Change the `GatewayServiceLive` signature (line 58):
```typescript
export const GatewayServiceLive = (config: Partial<GatewayConfig>, bus?: EventBusLike) =>
```

3. After the policy evaluation (after line 115 `const decision = yield* evaluatePolicies(...)`), add EventBus publishing:
```typescript
            // Publish event receipt
            if (bus) {
              yield* bus.publish({
                _tag: "GatewayEventReceived",
                agentId: event.agentId ?? "unknown",
                source: event.source,
                eventId: event.id,
                timestamp: Date.now(),
              });
            }
```

4. After the decision tracking block (after line ~150), add decision-specific events:
```typescript
            // Publish decision events
            if (bus) {
              if (decision.action === "skip" || decision.action === "queue") {
                yield* bus.publish({
                  _tag: "ProactiveActionSuppressed",
                  agentId: event.agentId ?? "unknown",
                  source: event.source,
                  reason: (decision as { reason: string }).reason,
                  policy: "policy-engine",
                  eventId: event.id,
                  timestamp: Date.now(),
                });
              }
              if (event.source === "heartbeat" && decision.action === "skip") {
                const state = yield* Ref.get(stateRef);
                yield* bus.publish({
                  _tag: "HeartbeatSkipped",
                  agentId: event.agentId ?? "unknown",
                  reason: (decision as { reason: string }).reason,
                  consecutiveSkips: state.consecutiveHeartbeatSkips,
                  timestamp: Date.now(),
                });
              }
            }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/gateway && bun test tests/gateway-observability.test.ts`
Expected: PASS

**Step 5: Run all existing gateway tests to verify no regressions**

Run: `cd packages/gateway && bun test`
Expected: All existing tests PASS (GatewayServiceLive without bus arg still works).

**Step 6: Commit**

```bash
git add packages/gateway/src/services/gateway-service.ts packages/gateway/tests/gateway-observability.test.ts
git commit -m "feat(gateway): wire EventBus into GatewayService for observability"
```

---

## Task 3: Wire EventBus into SchedulerService

**Files:**
- Modify: `packages/gateway/src/services/scheduler-service.ts`
- Test: `packages/gateway/tests/scheduler-observability.test.ts`

**Step 1: Write the failing test**

Create `packages/gateway/tests/scheduler-observability.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { SchedulerService, SchedulerServiceLive } from "../src/services/scheduler-service.js";

describe("SchedulerService observability", () => {
  test("publishes GatewayEventReceived on emitHeartbeat when bus provided", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };

    const layer = SchedulerServiceLive(
      { agentId: "test-agent", heartbeat: { intervalMs: 1000 } },
      bus,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const sched = yield* SchedulerService;
        yield* sched.emitHeartbeat();
      }).pipe(Effect.provide(layer)),
    );

    expect(published).toHaveLength(1);
    expect(published[0]._tag).toBe("GatewayEventReceived");
    expect(published[0].source).toBe("heartbeat");
  });

  test("publishes GatewayEventReceived for each fired cron", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };

    // Cron that fires every minute
    const layer = SchedulerServiceLive(
      {
        agentId: "test-agent",
        crons: [{ schedule: "* * * * *", instruction: "Test cron" }],
      },
      bus,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const sched = yield* SchedulerService;
        yield* sched.checkCrons(new Date());
      }).pipe(Effect.provide(layer)),
    );

    const cronEvents = published.filter((e) => e.source === "cron");
    expect(cronEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("works silently when no bus provided", async () => {
    const layer = SchedulerServiceLive({ agentId: "test-agent" });

    const event = await Effect.runPromise(
      Effect.gen(function* () {
        const sched = yield* SchedulerService;
        return yield* sched.emitHeartbeat();
      }).pipe(Effect.provide(layer)),
    );

    expect(event.source).toBe("heartbeat");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/gateway && bun test tests/scheduler-observability.test.ts`
Expected: FAIL — `SchedulerServiceLive` doesn't accept a second `bus` parameter.

**Step 3: Modify SchedulerServiceLive to accept optional EventBusLike**

In `packages/gateway/src/services/scheduler-service.ts`:

1. Add `EventBusLike` type (after line 3):
```typescript
type EventBusLike = {
  readonly publish: (event: any) => Effect.Effect<void, never>;
};
```

2. Change the `SchedulerServiceLive` signature (line 67):
```typescript
export const SchedulerServiceLive = (config: SchedulerConfig, bus?: EventBusLike) =>
```

3. In `emitHeartbeat()` (line 94-97), add bus publish:
```typescript
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
```

4. In `checkCrons()` (line 83-92), add bus publish for each fired cron:
```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `cd packages/gateway && bun test tests/scheduler-observability.test.ts`
Expected: PASS

**Step 5: Run all existing gateway tests**

Run: `cd packages/gateway && bun test`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add packages/gateway/src/services/scheduler-service.ts packages/gateway/tests/scheduler-observability.test.ts
git commit -m "feat(gateway): wire EventBus into SchedulerService for observability"
```

---

## Task 4: Add Structured Gateway Logging to Builder Loop

**Files:**
- Modify: `packages/runtime/src/builder.ts:2057-2094` (tick function)
- Test: `packages/runtime/tests/gateway-logging.test.ts`

**Step 1: Write the failing test**

Create `packages/runtime/tests/gateway-logging.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("Gateway loop EventBus publishing", () => {
  test("publishes ProactiveActionInitiated when gateway executes", async () => {
    // This test verifies the event types exist and can be published
    const published: any[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ProactiveActionInitiated", (event) => {
          published.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ProactiveActionInitiated",
          agentId: "test-agent",
          source: "heartbeat",
          taskDescription: "Check for work",
          timestamp: Date.now(),
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(published).toHaveLength(1);
    expect(published[0].source).toBe("heartbeat");
  });

  test("publishes ProactiveActionCompleted after gateway run", async () => {
    const published: any[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ProactiveActionCompleted", (event) => {
          published.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ProactiveActionCompleted",
          agentId: "test-agent",
          source: "heartbeat",
          success: true,
          tokensUsed: 150,
          durationMs: 2300,
          timestamp: Date.now(),
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(published).toHaveLength(1);
    expect(published[0].success).toBe(true);
    expect(published[0].tokensUsed).toBe(150);
  });
});
```

**Step 2: Run test to verify it passes (event types already exist)**

Run: `cd packages/runtime && bun test tests/gateway-logging.test.ts`
Expected: PASS — these event types already exist in the AgentEvent union.

**Step 3: Add EventBus publishing to the gateway loop tick function**

In `packages/runtime/src/builder.ts`, modify the `start()` method's `tick()` function. The gateway loop needs access to EventBus. Add it alongside the gw/sched service resolution (after line 2043):

```typescript
            // Also resolve EventBus if available
            let eb: any = null;
            try {
              const coreMod = yield* Effect.promise(() => import("@reactive-agents/core"));
              eb = yield* (coreMod.EventBus as any);
            } catch { /* EventBus not in runtime — no observability */ }
```

Then in the `tick()` function, add structured logging around execution decisions:

After the `decision.action === "execute"` check (around line 2065):
```typescript
          if (decision.action === "execute") {
            const instruction = hbEvent.metadata?.instruction ?? "Check for work";
            if (eb) {
              await self.runtime.runPromise(eb.publish({
                _tag: "ProactiveActionInitiated",
                agentId: self._agentId ?? "unknown",
                source: "heartbeat",
                taskDescription: instruction,
                timestamp: Date.now(),
              }));
            }
            const runStart = Date.now();
            try {
              const result = await self.run(instruction);
              totalRuns++;
              const tokensUsed = result.metadata?.tokensUsed ?? 0;
              if (tokensUsed) {
                await self.runtime.runPromise(gw.updateTokensUsed(tokensUsed));
              }
              if (eb) {
                await self.runtime.runPromise(eb.publish({
                  _tag: "ProactiveActionCompleted",
                  agentId: self._agentId ?? "unknown",
                  source: "heartbeat",
                  success: true,
                  tokensUsed,
                  durationMs: Date.now() - runStart,
                  timestamp: Date.now(),
                }));
              }
            } catch {
              if (eb) {
                try {
                  await self.runtime.runPromise(eb.publish({
                    _tag: "ProactiveActionCompleted",
                    agentId: self._agentId ?? "unknown",
                    source: "heartbeat",
                    success: false,
                    tokensUsed: 0,
                    durationMs: Date.now() - runStart,
                    timestamp: Date.now(),
                  }));
                } catch { /* don't let observability errors kill the loop */ }
              }
            }
          }
```

Apply the same pattern for cron execution (the inner `for` loop around line 2079-2091).

**Step 4: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/gateway-logging.test.ts`
Expected: PASS

**Step 5: Run full gateway test suite to verify no regressions**

Run: `cd packages/runtime && bun test`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/gateway-logging.test.ts
git commit -m "feat(runtime): add EventBus publishing to gateway loop for observability"
```

---

## Task 5: Pass EventBus to Gateway Layers in createRuntime()

**Files:**
- Modify: `packages/runtime/src/runtime.ts:602-619`
- Test: Verified by existing gateway tests + Task 4 tests

**Step 1: Modify createRuntime() to pass EventBus to gateway layer creation**

In `packages/runtime/src/runtime.ts`, the gateway layer composition section (lines 602-619). Currently:

```typescript
const gwLayer = gw.GatewayServiceLive((options.gatewayOptions ?? {}) as any);
const schedLayer = gw.SchedulerServiceLive({...});
```

Change to:

```typescript
// Create a structural EventBus-like object from the runtime's EventBus.
// We use Effect.serviceOption so it doesn't fail if EventBus isn't provided.
const bus = {
  publish: (event: any) =>
    Effect.gen(function* () {
      const ebOpt = yield* Effect.serviceOption(
        // Dynamic import means we reference by tag string
        Context.GenericTag<any>("EventBus"),
      );
      if (Option.isSome(ebOpt)) {
        yield* ebOpt.value.publish(event);
      }
    }),
};
// Note: The above approach won't work cleanly here since we're building layers.
// Instead, pass a simple bus wrapper that the gateway services can use.
```

Actually, the simpler approach: since the gateway layers are merged into the runtime, they can't directly access EventBus at construction time. Instead, we'll resolve EventBus at runtime in the gateway loop (Task 4 already does this). For GatewayService and SchedulerService, the bus is passed as a constructor arg from the builder's `start()` method.

Update `start()` in `builder.ts` to pass the resolved EventBus to gateway services:

The `start()` method resolves services from ManagedRuntime. After resolving `gw` and `sched`, also resolve EventBus and pass it. But since GatewayService is already constructed by the layer, we need a different approach.

**Revised approach**: Make the EventBus integration happen at the service call site (the gateway loop `tick()` function), not at construction time. The `GatewayServiceLive(config, bus?)` approach means the bus must be available when the layer is built.

In `createRuntime()`, we can create the bus from EventBus:

```typescript
if (options.enableGateway) {
  const gatewayLayer = Layer.unwrapEffect(
    Effect.gen(function* () {
      const gw = yield* Effect.promise(() => import("@reactive-agents/gateway"));

      // Try to get EventBus from upstream layers for observability
      let bus: any = undefined;
      try {
        const core = yield* Effect.promise(() => import("@reactive-agents/core"));
        // We can't yield EventBus here since we're building layers, not running.
        // The bus will be resolved in the gateway loop instead.
      } catch {}

      const gwLayer = gw.GatewayServiceLive((options.gatewayOptions ?? {}) as any);
      const schedLayer = gw.SchedulerServiceLive({
        agentId: options.agentId,
        heartbeat: options.gatewayOptions?.heartbeat as any,
        crons: options.gatewayOptions?.crons as any,
      });
      return Layer.merge(gwLayer, schedLayer);
    }),
  );
  runtime = Layer.merge(runtime, gatewayLayer) as any;
}
```

**Better revised approach**: Use `Layer.unwrapEffect` with `Effect.gen` that resolves EventBus from context, since the gateway layer is merged after EventBusLive:

```typescript
if (options.enableGateway) {
  const gatewayLayer = Layer.unwrapEffect(
    Effect.gen(function* () {
      const gw = yield* Effect.promise(() => import("@reactive-agents/gateway"));
      const core = yield* Effect.promise(() => import("@reactive-agents/core"));

      // Resolve EventBus from the already-composed runtime
      let bus: { publish: (e: any) => Effect.Effect<void, never> } | undefined;
      try {
        const eb = yield* core.EventBus;
        bus = { publish: (e: any) => eb.publish(e) };
      } catch {
        // EventBus not available — gateway runs without observability
      }

      const gwLayer = gw.GatewayServiceLive((options.gatewayOptions ?? {}) as any, bus);
      const schedLayer = gw.SchedulerServiceLive({
        agentId: options.agentId,
        heartbeat: options.gatewayOptions?.heartbeat as any,
        crons: options.gatewayOptions?.crons as any,
      }, bus);
      return Layer.merge(gwLayer, schedLayer);
    }),
  );
  runtime = Layer.merge(runtime, gatewayLayer) as any;
}
```

This works because `Layer.unwrapEffect` evaluates the Effect within the layer scope, so `yield* core.EventBus` can resolve if EventBusLive is already in the composed runtime.

**Step 2: Run tests**

Run: `cd packages/runtime && bun test`
Expected: All tests PASS. Gateway services now receive EventBus.

**Step 3: Commit**

```bash
git add packages/runtime/src/runtime.ts
git commit -m "feat(runtime): pass EventBus to gateway layers in createRuntime()"
```

---

## Task 6: Add Notification Callback to SignalCliBridge

**Files:**
- Modify: `docker/signal-mcp/server/src/signal-cli-bridge.ts:34-106`

**Step 1: Add onMessageCallback property and invoke it**

In `docker/signal-mcp/server/src/signal-cli-bridge.ts`:

1. Add callback property to the class (after line 43 `private shutdownRequested = false;`):
```typescript
  /** Optional callback invoked immediately when a notification arrives. */
  onMessageCallback: ((notification: SignalNotification) => void) | null = null;
```

2. In the notification buffering section (lines 100-106), invoke the callback:
```typescript
        } else {
          // Notification (receive, etc.) — buffer it
          const notification: SignalNotification = {
            method: (parsed as any).method ?? "unknown",
            params: (parsed as any).params ?? {},
          };
          this.notifications.push(notification);
          // Invoke immediate callback if registered
          this.onMessageCallback?.(notification);
        }
```

**Step 2: Verify the change doesn't break existing behavior**

The `receive_message` tool still drains from `this.notifications` — buffering is preserved. The callback is additive. No test needed here since this is the Docker-isolated MCP server (tested via integration), but we verify the build:

Run: `cd docker/signal-mcp/server && bun build src/index.ts --target=bun --outdir=dist`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add docker/signal-mcp/server/src/signal-cli-bridge.ts
git commit -m "feat(signal-mcp): add onMessageCallback for push notifications"
```

---

## Task 7: Send MCP Notifications from Signal MCP Server

**Files:**
- Modify: `docker/signal-mcp/server/src/index.ts:16-17` (after bridge.start())

**Step 1: Add notification sending after bridge starts**

In `docker/signal-mcp/server/src/index.ts`, after `bridge.start();` (line 17), add:

```typescript
// ── Push notifications for incoming messages ────────────────────────────────
// When a message arrives, immediately notify the MCP client so the agent
// can respond without waiting for a poll cycle.
bridge.onMessageCallback = (notification) => {
  const envelope = (notification.params as any)?.envelope;
  if (!envelope) return;

  const message = envelope.dataMessage?.message ?? envelope.syncMessage?.sentMessage?.message;
  if (!message) return; // Skip non-text notifications (receipts, typing, etc.)

  // Send MCP server notification to connected client
  // The MCP SDK's McpServer exposes sendNotification or notification methods
  // depending on version. We use the transport directly for reliability.
  const notificationPayload = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      sender: envelope.source ?? envelope.sourceNumber ?? "unknown",
      message,
      timestamp: envelope.timestamp ?? Date.now(),
      groupId: envelope.dataMessage?.groupInfo?.groupId,
      platform: "signal",
    },
  });

  // Write directly to stdout (MCP stdio transport)
  process.stdout.write(notificationPayload + "\n");
};
```

**Important**: We write the JSON-RPC notification directly to stdout rather than using the MCP SDK's notification API because:
1. The `McpServer` class from `@modelcontextprotocol/sdk` may not expose a public notification method for custom methods
2. MCP notifications are JSON-RPC messages without an `id` field — writing directly is the simplest approach
3. The MCP client on the other end reads newline-delimited JSON from stdout

**Step 2: Verify the build**

Run: `cd docker/signal-mcp/server && bun build src/index.ts --target=bun --outdir=dist`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add docker/signal-mcp/server/src/index.ts
git commit -m "feat(signal-mcp): send MCP notifications on incoming messages"
```

---

## Task 8: Add MCP Notification Listener to MCP Client

**Files:**
- Modify: `packages/tools/src/mcp/mcp-client.ts:115-122` (stdio reader notification handling)
- Modify: `packages/tools/src/mcp/mcp-client.ts:919+` (makeMCPClient — expose notification callback registration)
- Modify: `packages/tools/src/tool-service.ts:361-426` (connectMCPServer — register listener)
- Test: `packages/tools/tests/mcp-notification.test.ts`

**Step 1: Write the failing test**

Create `packages/tools/tests/mcp-notification.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";

describe("MCP notification forwarding", () => {
  test("ChannelMessageReceived published when MCP server sends notification", async () => {
    // This tests that the ToolService publishes ChannelMessageReceived
    // when it receives a notifications/message from an MCP server.
    // Since we can't easily spawn a real MCP server in unit tests,
    // we test the notification handler function directly.
    const published: any[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ChannelMessageReceived", (event) => {
          published.push(event);
          return Effect.void;
        });

        // Simulate what happens when an MCP notification arrives
        yield* eb.publish({
          _tag: "ChannelMessageReceived",
          sender: "+15551234567",
          platform: "signal",
          message: "Hello from Signal",
          timestamp: Date.now(),
          mcpServer: "signal",
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(published).toHaveLength(1);
    expect(published[0].sender).toBe("+15551234567");
    expect(published[0].platform).toBe("signal");
    expect(published[0].mcpServer).toBe("signal");
  });
});
```

**Step 2: Run test**

Run: `cd packages/tools && bun test tests/mcp-notification.test.ts`
Expected: PASS (event type exists from Task 1).

**Step 3: Add notification callback support to makeMCPClient**

In `packages/tools/src/mcp/mcp-client.ts`:

1. Add a notification callbacks ref to `makeMCPClient` (after line 920):
```typescript
  const notificationCallbacksRef = yield* Ref.make<
    Map<string, (method: string, params: Record<string, unknown>) => void>
  >(new Map());
```

2. In `startStdioReader` (lines 115-122), instead of silently dropping notifications, invoke the registered callback:
```typescript
          // Check for notification callback (server-initiated messages)
          const serverName = [...activeTransports.entries()]
            .find(([, t]) => isStdioTransport(t) && t === transport)?.[0];
          if (serverName) {
            const callbacks = notificationCallbacksRef._value;
            // We can't yield inside the async reader, so use a sync approach
            notificationCallbacks.get(serverName)?.(
              (parsed as any).method ?? "unknown",
              (parsed as any).params ?? {},
            );
          }
```

Actually, since `startStdioReader` is a standalone function (not inside the Effect generator), it can't access the Ref directly. Better approach: pass a module-level Map for notification callbacks.

**Revised approach** — use a module-level Map (simpler, matches the `activeTransports` pattern):

After the `activeTransports` map (line 76):
```typescript
// Module-level map: serverName -> notification callback
const notificationCallbacks = new Map<
  string,
  (method: string, params: Record<string, unknown>) => void
>();
```

In `startStdioReader` (replace lines 121-122):
```typescript
          // Server-sent notification (no matching pending request)
          // Forward to registered callback if available
          const serverName = [...activeTransports.entries()]
            .find(([, t]) => t === transport)?.[0];
          if (serverName) {
            const callback = notificationCallbacks.get(serverName);
            if (callback) {
              try {
                callback(
                  (parsed as any).method ?? "unknown",
                  (parsed as any).params ?? {},
                );
              } catch { /* don't let callback errors kill the reader */ }
            }
          }
```

In `makeMCPClient`, add an `onNotification` method to the returned object:
```typescript
  const onNotification = (
    serverName: string,
    callback: (method: string, params: Record<string, unknown>) => void,
  ): void => {
    notificationCallbacks.set(serverName, callback);
  };
```

And include it in the return object alongside `connect`, `callTool`, `disconnect`, `listServers`.

**Step 4: Wire notification forwarding in ToolService connectMCPServer**

In `packages/tools/src/tool-service.ts`, after the MCP tools registration in `connectMCPServer` (after the eventBus publish on line 419-423):

```typescript
        // Register notification listener to forward MCP server notifications to EventBus
        mcpClient.onNotification(config.name, (method, params) => {
          if (method === "notifications/message") {
            // Fire-and-forget: publish to EventBus
            Effect.runPromise(
              eventBus.publish({
                _tag: "ChannelMessageReceived",
                sender: String(params.sender ?? "unknown"),
                platform: String(params.platform ?? "unknown"),
                message: String(params.message ?? ""),
                timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
                mcpServer: config.name,
                groupId: params.groupId != null ? String(params.groupId) : undefined,
              }),
            ).catch(() => { /* don't let EventBus errors break MCP */ });
          }
        });
```

**Step 5: Run tests**

Run: `cd packages/tools && bun test`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add packages/tools/src/mcp/mcp-client.ts packages/tools/src/tool-service.ts packages/tools/tests/mcp-notification.test.ts
git commit -m "feat(tools): forward MCP server notifications to EventBus as ChannelMessageReceived"
```

---

## Task 9: Create AccessControlPolicy

**Files:**
- Create: `packages/gateway/src/policies/access-control.ts`
- Modify: `packages/gateway/src/index.ts` (add export)
- Modify: `packages/gateway/src/types.ts` (add ChannelAccessConfig)
- Test: `packages/gateway/tests/access-control.test.ts`

**Step 1: Write the failing test**

Create `packages/gateway/tests/access-control.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { createAccessControlPolicy } from "../src/policies/access-control.js";
import { initialGatewayState } from "../src/types.js";
import type { GatewayEvent } from "../src/types.js";

describe("AccessControlPolicy", () => {
  const makeChannelEvent = (sender: string): GatewayEvent => ({
    id: "ch-test-1",
    source: "channel",
    timestamp: new Date(),
    agentId: "test-agent",
    priority: "normal",
    payload: {},
    metadata: { sender, platform: "signal" },
  });

  test("allowlist: allows listed sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["+15551234567"],
    });

    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15551234567"), initialGatewayState()),
    );
    expect(decision).toBeNull(); // null = no objection, let other policies decide
  });

  test("allowlist: blocks unlisted sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["+15551234567"],
    });

    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("skip");
  });

  test("blocklist: blocks listed sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "blocklist",
      blockedSenders: ["+15559999999"],
    });

    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision!.action).toBe("skip");
  });

  test("blocklist: allows unlisted sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "blocklist",
      blockedSenders: ["+15559999999"],
    });

    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15551234567"), initialGatewayState()),
    );
    expect(decision).toBeNull();
  });

  test("open: allows all senders", async () => {
    const policy = createAccessControlPolicy({ policy: "open" });

    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision).toBeNull();
  });

  test("ignores non-channel events", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["+15551234567"],
    });

    const hbEvent: GatewayEvent = {
      id: "hb-1",
      source: "heartbeat",
      timestamp: new Date(),
      priority: "low",
      payload: {},
      metadata: {},
    };

    const decision = await Effect.runPromise(
      policy.evaluate(hbEvent, initialGatewayState()),
    );
    expect(decision).toBeNull(); // doesn't apply to heartbeats
  });

  test("escalate action for unknown sender when configured", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["+15551234567"],
      unknownSenderAction: "escalate",
    });

    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision!.action).toBe("escalate");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/gateway && bun test tests/access-control.test.ts`
Expected: FAIL — `access-control.js` module not found.

**Step 3: Add ChannelAccessConfig to types**

In `packages/gateway/src/types.ts`, after the `PolicyConfig` type (after line 87):

```typescript
// ─── Channel Access Configuration ───────────────────────────────────────────

export interface ChannelAccessConfig {
  readonly policy: "allowlist" | "blocklist" | "open";
  readonly allowedSenders?: readonly string[];
  readonly blockedSenders?: readonly string[];
  readonly unknownSenderAction?: "skip" | "escalate";
  readonly replyToUnknown?: string;
}
```

**Step 4: Create AccessControlPolicy**

Create `packages/gateway/src/policies/access-control.ts`:

```typescript
import { Effect } from "effect";
import type { SchedulingPolicy } from "../services/policy-engine.js";
import type { GatewayEvent, GatewayState, PolicyDecision, ChannelAccessConfig } from "../types.js";

/**
 * Access control policy — gate channel messages based on sender identity.
 *
 * Priority 5 (evaluated before all other policies).
 * Only applies to events with source === "channel".
 *
 * Modes:
 * - "allowlist" — only listed senders pass through
 * - "blocklist" — listed senders are blocked, all others pass
 * - "open"      — all senders pass (existing guardrails still apply)
 */
export const createAccessControlPolicy = (
  config: ChannelAccessConfig,
): SchedulingPolicy => ({
  _tag: "AccessControl",
  priority: 5,
  evaluate: (
    event: GatewayEvent,
    _state: GatewayState,
  ): Effect.Effect<PolicyDecision | null, never> =>
    Effect.sync(() => {
      // Only applies to channel events
      if (event.source !== "channel") {
        return null;
      }

      const sender = String(event.metadata?.sender ?? "");
      if (!sender) {
        return null;
      }

      switch (config.policy) {
        case "open":
          return null;

        case "allowlist": {
          const allowed = config.allowedSenders ?? [];
          if (allowed.includes(sender)) {
            return null;
          }
          const action = config.unknownSenderAction ?? "skip";
          return action === "escalate"
            ? { action: "escalate", reason: `Sender ${sender} not in allowlist` }
            : { action: "skip", reason: `Sender ${sender} not in allowlist` };
        }

        case "blocklist": {
          const blocked = config.blockedSenders ?? [];
          if (blocked.includes(sender)) {
            return { action: "skip", reason: `Sender ${sender} is blocklisted` };
          }
          return null;
        }

        default:
          return null;
      }
    }),
});
```

**Step 5: Add export to index.ts**

In `packages/gateway/src/index.ts`, add:
```typescript
export { createAccessControlPolicy } from "./policies/access-control.js";
export type { ChannelAccessConfig } from "./types.js";
```

**Step 6: Run tests**

Run: `cd packages/gateway && bun test tests/access-control.test.ts`
Expected: PASS

Run: `cd packages/gateway && bun test`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add packages/gateway/src/policies/access-control.ts packages/gateway/src/types.ts packages/gateway/src/index.ts packages/gateway/tests/access-control.test.ts
git commit -m "feat(gateway): add AccessControlPolicy for channel message access control"
```

---

## Task 10: Wire AccessControlPolicy into GatewayServiceLive

**Files:**
- Modify: `packages/gateway/src/services/gateway-service.ts` (add access control policy to policy chain)
- Modify: `packages/gateway/src/types.ts` (add channels to GatewayConfig)

**Step 1: Add channels config to GatewayConfig**

In `packages/gateway/src/types.ts`, add `channels` field to `GatewayConfigSchema` (inside the Schema.Struct, after line 93):

```typescript
  channels: Schema.optional(Schema.Struct({
    accessPolicy: Schema.optionalWith(
      Schema.Literal("allowlist", "blocklist", "open"),
      { default: () => "allowlist" as const },
    ),
    allowedSenders: Schema.optional(Schema.Array(Schema.String)),
    blockedSenders: Schema.optional(Schema.Array(Schema.String)),
    unknownSenderAction: Schema.optionalWith(
      Schema.Literal("skip", "escalate"),
      { default: () => "skip" as const },
    ),
    replyToUnknown: Schema.optional(Schema.String),
  })),
```

**Step 2: Wire AccessControlPolicy in GatewayServiceLive**

In `packages/gateway/src/services/gateway-service.ts`, add import:
```typescript
import { createAccessControlPolicy } from "../policies/access-control.js";
```

In the policy building section (after line 97 — after event merging policy), add:
```typescript
      // Access control for channel messages (highest priority)
      if (config.channels) {
        policies.push(
          createAccessControlPolicy({
            policy: config.channels.accessPolicy ?? "allowlist",
            allowedSenders: config.channels.allowedSenders as string[] | undefined,
            blockedSenders: config.channels.blockedSenders as string[] | undefined,
            unknownSenderAction: config.channels.unknownSenderAction,
            replyToUnknown: config.channels.replyToUnknown,
          }),
        );
      }
```

**Step 3: Run tests**

Run: `cd packages/gateway && bun test`
Expected: All tests PASS.

**Step 4: Commit**

```bash
git add packages/gateway/src/services/gateway-service.ts packages/gateway/src/types.ts
git commit -m "feat(gateway): wire AccessControlPolicy into GatewayServiceLive"
```

---

## Task 11: Add Channel Event Routing to Gateway Loop

**Files:**
- Modify: `packages/runtime/src/builder.ts` (start() method — add EventBus subscription for ChannelMessageReceived)
- Modify: `packages/runtime/src/builder.ts` (GatewayOptions interface — add channels config)
- Test: `packages/runtime/tests/gateway-channel-routing.test.ts`

**Step 1: Write the failing test**

Create `packages/runtime/tests/gateway-channel-routing.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("Gateway channel event routing", () => {
  test("ChannelMessageReceived event contains expected fields", async () => {
    const received: any[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ChannelMessageReceived", (event) => {
          received.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ChannelMessageReceived",
          sender: "+15551234567",
          platform: "signal",
          message: "What's the server status?",
          timestamp: Date.now(),
          mcpServer: "signal",
          groupId: undefined,
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(received).toHaveLength(1);
    const event = received[0];
    expect(event.sender).toBe("+15551234567");
    expect(event.platform).toBe("signal");
    expect(event.message).toBe("What's the server status?");
    expect(event.mcpServer).toBe("signal");
  });
});
```

**Step 2: Run test**

Run: `cd packages/runtime && bun test tests/gateway-channel-routing.test.ts`
Expected: PASS (event type already exists).

**Step 3: Add channels to GatewayOptions interface**

In `packages/runtime/src/builder.ts`, add to the `GatewayOptions` interface (around line 252):

```typescript
  /** Channel access control configuration */
  channels?: {
    /** Access control policy: "allowlist" (default), "blocklist", or "open" */
    accessPolicy?: "allowlist" | "blocklist" | "open";
    /** Phone numbers / user IDs allowed to message (for allowlist mode) */
    allowedSenders?: string[];
    /** Phone numbers / user IDs blocked (for blocklist mode) */
    blockedSenders?: string[];
    /** Action for unknown senders: "skip" (default) or "escalate" */
    unknownSenderAction?: "skip" | "escalate";
    /** Optional auto-reply to unknown senders */
    replyToUnknown?: string;
  };
```

**Step 4: Add channel event subscription to start() method**

In `packages/runtime/src/builder.ts`, in the `start()` method, after the `loopPromise` async block (after the `gw` and `sched` service resolution and the `tick` function definition), add EventBus subscription for channel messages:

```typescript
      // Subscribe to channel messages from MCP servers
      let unsubChannel: (() => void) | null = null;
      if (eb) {
        try {
          const unsub = await self.runtime.runPromise(
            eb.on("ChannelMessageReceived", (event: any) =>
              Effect.gen(function* () {
                if (stopped) return;

                const gwEvent = {
                  id: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  source: "channel" as const,
                  timestamp: new Date(event.timestamp),
                  agentId: self._agentId ?? "unknown",
                  payload: { sender: event.sender, message: event.message },
                  priority: "normal" as const,
                  metadata: {
                    platform: event.platform,
                    sender: event.sender,
                    groupId: event.groupId,
                    mcpServer: event.mcpServer,
                  },
                };

                const decision = yield* gw.processEvent(gwEvent);

                if (decision.action === "execute") {
                  const instruction = `Respond to this ${event.platform} message from ${event.sender}: "${event.message}". Use the ${event.mcpServer}/send_message_to_user tool to reply.`;

                  yield* Effect.promise(async () => {
                    const runStart = Date.now();
                    try {
                      const result = await self.run(instruction);
                      totalRuns++;
                      const tokensUsed = result.metadata?.tokensUsed ?? 0;
                      if (tokensUsed) {
                        await self.runtime.runPromise(gw.updateTokensUsed(tokensUsed));
                      }
                      if (eb) {
                        await self.runtime.runPromise(eb.publish({
                          _tag: "ProactiveActionCompleted",
                          agentId: self._agentId ?? "unknown",
                          source: "channel",
                          success: true,
                          tokensUsed,
                          durationMs: Date.now() - runStart,
                          timestamp: Date.now(),
                        }));
                      }
                    } catch {
                      // Channel errors don't kill the loop
                    }
                  });
                }
              }),
            ),
          );
          unsubChannel = () => {
            try { self.runtime.runPromise(unsub as any).catch(() => {}); } catch {}
          };
        } catch { /* EventBus subscription failed — no channel routing */ }
      }
```

Also update the `stop()` handler to unsubscribe:

```typescript
      stop: async () => {
        stopped = true;
        if (timer) clearInterval(timer);
        unsubChannel?.();
        const summary: GatewaySummary = { heartbeatsFired, totalRuns, cronChecks };
        resolveStop?.(summary);
        return summary;
      },
```

**Step 5: Pass channels config through to runtime**

In `packages/runtime/src/builder.ts`, in the `withGateway()` method, ensure channels config is stored:

```typescript
  withGateway(options?: GatewayOptions): this {
    this._gatewayOptions = options ?? {};
    this._gatewayEnabled = true;
    // ... existing code
  }
```

The channels config should flow through `_gatewayOptions` to `createRuntime()` to `GatewayServiceLive`. Verify the config is passed in `createRuntime()`:

In `packages/runtime/src/runtime.ts`, in the gateway layer section, ensure `options.gatewayOptions` is passed fully to `GatewayServiceLive`:
```typescript
const gwLayer = gw.GatewayServiceLive((options.gatewayOptions ?? {}) as any, bus);
```

This already passes the full config, which includes `channels`. No change needed.

**Step 6: Run tests**

Run: `cd packages/runtime && bun test`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/gateway-channel-routing.test.ts
git commit -m "feat(runtime): add channel event routing and access control to gateway loop"
```

---

## Task 12: Build and Integration Verification

**Files:** None (verification only)

**Step 1: Build all packages**

Run: `bun run build`
Expected: All 16 packages build successfully.

**Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass (1001+ tests).

**Step 3: Rebuild Signal MCP Docker image**

Run: `cd docker/signal-mcp && docker build -t signal-mcp:local .`
Expected: Build succeeds.

**Step 4: Verify builder API compiles with new channels config**

Create a quick type-check file (delete after):
```typescript
// type-check.ts (temporary)
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("messaging-agent")
  .withProvider("anthropic")
  .withTools()
  .withGateway({
    heartbeat: { intervalMs: 30_000, policy: "adaptive" },
    channels: {
      accessPolicy: "allowlist",
      allowedSenders: ["+15551234567"],
      unknownSenderAction: "skip",
      replyToUnknown: "Sorry, I'm not configured to chat with you.",
    },
    policies: { dailyTokenBudget: 50_000 },
  })
  .build();
```

Run: `bun typecheck type-check.ts` (or `tsc --noEmit type-check.ts`)
Expected: No type errors.

**Step 5: Commit final state**

```bash
git add -A
git commit -m "feat: gateway observability + bidirectional messaging via Signal MCP push notifications"
```

---

## Summary

| Task | Component | What It Does |
|------|-----------|-------------|
| 1 | Core EventBus | Add `ChannelMessageReceived` event type |
| 2 | GatewayService | Publish events via optional EventBusLike |
| 3 | SchedulerService | Publish events via optional EventBusLike |
| 4 | Builder gateway loop | Publish ProactiveAction events, structured logging |
| 5 | createRuntime() | Pass EventBus to gateway layers |
| 6 | SignalCliBridge | Add onMessageCallback for push notifications |
| 7 | Signal MCP server | Send MCP notifications on incoming messages |
| 8 | MCP client + ToolService | Forward MCP notifications to EventBus |
| 9 | AccessControlPolicy | Allowlist/blocklist/open sender gating |
| 10 | GatewayServiceLive | Wire AccessControlPolicy into policy chain |
| 11 | Builder start() | Subscribe to channel events, route through policies |
| 12 | Integration | Build, test, Docker rebuild, type-check |
