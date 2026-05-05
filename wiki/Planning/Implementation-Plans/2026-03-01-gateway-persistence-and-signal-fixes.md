# Gateway Persistence & Signal Registration Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire gateway services into the runtime so `.withGateway()` creates a persistent agent loop, fix the signal registration script container isolation bug, and fix the signal-mcp Dockerfile for correct dependency installation.

**Architecture:** Compose GatewayServiceLive + SchedulerServiceLive into `createRuntime()` when `enableGateway: true`, add `start()` method to `ReactiveAgent` that runs a persistent heartbeat/cron loop driving `agent.run()` for each event, fix signal registration to use a single persistent container.

**Tech Stack:** Effect-TS (Layer, ManagedRuntime, Ref, Schedule), bun:test, signal-cli, Docker

---

## Task 1: Compose gateway layers into createRuntime()

**Files:**
- Modify: `packages/runtime/src/runtime.ts` (around line 600-604)

**Step 1: Write the failing test**

Create `packages/runtime/tests/gateway-runtime.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

describe("Gateway runtime composition", () => {
  test("createRuntime with enableGateway composes GatewayService", async () => {
    const { createRuntime } = await import("../src/runtime.js");

    const runtime = createRuntime({
      agentId: "gw-test",
      provider: "test",
      enableGateway: true,
      gatewayOptions: {
        heartbeat: { intervalMs: 30000, instruction: "Check messages" },
        crons: [{ schedule: "0 9 * * MON", instruction: "Review PRs" }],
        policies: { dailyTokenBudget: 50000 },
      },
    });

    // GatewayService should be resolvable from the composed runtime
    const { GatewayService } = await import("@reactive-agents/gateway");
    const result = await Effect.runPromise(
      GatewayService.pipe(
        Effect.flatMap((gw) => gw.status()),
        Effect.provide(runtime),
      ),
    );
    expect(result.isRunning).toBe(false);
    expect(result.stats.heartbeatsFired).toBe(0);
  });

  test("createRuntime with enableGateway composes SchedulerService", async () => {
    const { createRuntime } = await import("../src/runtime.js");

    const runtime = createRuntime({
      agentId: "sched-test",
      provider: "test",
      enableGateway: true,
      gatewayOptions: {
        heartbeat: { intervalMs: 15000, instruction: "Poll channels" },
      },
    });

    const { SchedulerService } = await import("@reactive-agents/gateway");
    const hb = await Effect.runPromise(
      SchedulerService.pipe(
        Effect.flatMap((s) => s.emitHeartbeat()),
        Effect.provide(runtime),
      ),
    );
    expect(hb.source).toBe("heartbeat");
    expect(hb.metadata.instruction).toBe("Poll channels");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/gateway-runtime.test.ts`
Expected: FAIL — GatewayService not found in layer

**Step 3: Implement gateway layer composition in createRuntime()**

In `packages/runtime/src/runtime.ts`, replace the comment block at lines 602-604 with:

```typescript
if (options.enableGateway) {
  const gw = await import("@reactive-agents/gateway");
  const gatewayLayer = gw.GatewayServiceLive(options.gatewayOptions?.policies ?? {});
  const schedulerLayer = gw.SchedulerServiceLive({
    agentId: options.agentId,
    heartbeat: options.gatewayOptions?.heartbeat as any,
    crons: options.gatewayOptions?.crons as any,
  });
  runtime = Layer.merge(runtime, Layer.merge(gatewayLayer, schedulerLayer)) as any;
}
```

Since `createRuntime` is synchronous, we need to use `Layer.unwrapEffect` for the dynamic import:

```typescript
if (options.enableGateway) {
  const gatewayLayer = Layer.unwrapEffect(
    Effect.promise(async () => {
      const gw = await import("@reactive-agents/gateway");
      const gwLayer = gw.GatewayServiceLive(options.gatewayOptions?.policies ?? {});
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

**Step 4: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/gateway-runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/runtime/tests/gateway-runtime.test.ts packages/runtime/src/runtime.ts
git commit -m "feat(runtime): compose GatewayService + SchedulerService into createRuntime when enableGateway"
```

---

## Task 2: Add `start()` method to ReactiveAgent

**Files:**
- Modify: `packages/runtime/src/builder.ts` (ReactiveAgent class, after `run()` method)

**Step 1: Write the failing test**

Create `packages/runtime/tests/gateway-start.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("ReactiveAgent.start() — gateway persistence", () => {
  test("start() runs heartbeats and resolves on stop", async () => {
    const agent = await ReactiveAgents.create()
      .withName("gw-start-test")
      .withProvider("test")
      .withGateway({
        heartbeat: { intervalMs: 100, instruction: "Check for work" },
      })
      .withReasoning()
      .withTestResponses({
        "": "FINAL ANSWER: No work found.",
      })
      .build();

    // start() should return a handle with a stop method
    const handle = agent.start();
    expect(handle).toBeDefined();
    expect(handle.stop).toBeInstanceOf(Function);

    // Let a few heartbeats fire
    await new Promise((r) => setTimeout(r, 350));

    // Stop and get summary
    const summary = await handle.stop();
    expect(summary.heartbeatsFired).toBeGreaterThanOrEqual(2);
    expect(summary.totalRuns).toBeGreaterThanOrEqual(1);

    await agent.dispose();
  });

  test("start() without gateway config throws", async () => {
    const agent = await ReactiveAgents.create()
      .withName("no-gw")
      .withProvider("test")
      .withReasoning()
      .withTestResponses({ "": "FINAL ANSWER: done" })
      .build();

    expect(() => agent.start()).toThrow(/gateway/i);
    await agent.dispose();
  });

  test("start() checks crons", async () => {
    // Cron that fires every minute — won't actually fire in test but should be tracked
    const agent = await ReactiveAgents.create()
      .withName("cron-test")
      .withProvider("test")
      .withGateway({
        heartbeat: { intervalMs: 100 },
        crons: [{ schedule: "* * * * *", instruction: "Run report" }],
      })
      .withReasoning()
      .withTestResponses({ "": "FINAL ANSWER: done" })
      .build();

    const handle = agent.start();
    await new Promise((r) => setTimeout(r, 250));
    const summary = await handle.stop();

    // Crons checked each tick
    expect(summary.cronChecks).toBeGreaterThanOrEqual(1);
    await agent.dispose();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/gateway-start.test.ts`
Expected: FAIL — `agent.start is not a function`

**Step 3: Implement `start()` on ReactiveAgent**

Add to the `ReactiveAgent` class in `packages/runtime/src/builder.ts`:

```typescript
/**
 * Start the persistent gateway loop.
 *
 * Begins the heartbeat/cron event loop that drives autonomous agent behavior.
 * Each heartbeat fires `agent.run(instruction)` through the policy engine.
 * Requires `.withGateway()` to have been called during build.
 *
 * @returns A GatewayHandle with `stop()` to shut down the loop
 * @throws Error if gateway was not configured
 */
start(): GatewayHandle {
  // We need to validate that gateway services are available
  // by checking if the builder configured them
  const self = this;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let heartbeatsFired = 0;
  let totalRuns = 0;
  let cronChecks = 0;
  let resolveStop: ((summary: GatewaySummary) => void) | null = null;

  const stopPromise = new Promise<GatewaySummary>((resolve) => {
    resolveStop = resolve;
  });

  // Start the loop asynchronously
  (async () => {
    try {
      // Resolve gateway services from the ManagedRuntime
      const services = await self.runtime.runPromise(
        Effect.gen(function* () {
          const gwMod = yield* Effect.promise(() => import("@reactive-agents/gateway"));
          const gw = yield* (gwMod.GatewayService as any);
          const sched = yield* (gwMod.SchedulerService as any);
          return { gw, sched };
        }) as Effect.Effect<any>,
      );

      const tick = async () => {
        if (stopped) return;
        try {
          // 1. Emit heartbeat and check policy
          const hbEvent = await self.runtime.runPromise(services.sched.emitHeartbeat());
          const decision = await self.runtime.runPromise(services.gw.processEvent(hbEvent));
          heartbeatsFired++;

          if (decision.action === "execute") {
            const instruction = hbEvent.metadata?.instruction ?? "Check for work";
            try {
              const result = await self.run(instruction);
              totalRuns++;
              // Update token budget
              if (result.metadata?.tokensUsed) {
                await self.runtime.runPromise(
                  services.gw.updateTokensUsed(result.metadata.tokensUsed),
                );
              }
            } catch { /* run errors don't kill the loop */ }
          }

          // 2. Check crons
          const cronEvents = await self.runtime.runPromise(services.sched.checkCrons(new Date()));
          cronChecks++;
          for (const cronEvent of cronEvents) {
            if (stopped) break;
            const cronDecision = await self.runtime.runPromise(services.gw.processEvent(cronEvent));
            if (cronDecision.action === "execute") {
              const cronInstruction = cronEvent.metadata?.instruction ?? "Cron task";
              try {
                const result = await self.run(cronInstruction);
                totalRuns++;
                if (result.metadata?.tokensUsed) {
                  await self.runtime.runPromise(
                    services.gw.updateTokensUsed(result.metadata.tokensUsed),
                  );
                }
              } catch { /* cron errors don't kill the loop */ }
            }
          }
        } catch { /* tick errors don't kill the loop */ }
      };

      // Get interval from gateway config (need to access it)
      // The interval is stored in SchedulerService config, but we can read it from
      // the heartbeat config passed to the builder.
      // For now, we'll need to store it on the ReactiveAgent.
      timer = setInterval(tick, self._gatewayIntervalMs ?? 60000);

      // Run first tick immediately
      await tick();
    } catch (err) {
      // Gateway services not available — stop immediately
      resolveStop?.({ heartbeatsFired, totalRuns, cronChecks, error: String(err) });
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      const summary: GatewaySummary = { heartbeatsFired, totalRuns, cronChecks };
      resolveStop?.(summary);
      return summary;
    },
    done: stopPromise,
  };
}
```

Also add the required types and store the interval on ReactiveAgent:

```typescript
export interface GatewaySummary {
  readonly heartbeatsFired: number;
  readonly totalRuns: number;
  readonly cronChecks: number;
  readonly error?: string;
}

export interface GatewayHandle {
  /** Stop the gateway loop and return execution summary. */
  stop(): Promise<GatewaySummary>;
  /** Promise that resolves when the gateway stops (via stop() or error). */
  done: Promise<GatewaySummary>;
}
```

The ReactiveAgent constructor needs a new optional field:

```typescript
constructor(
  private readonly engine: { ... },
  readonly agentId: string,
  private readonly runtime: ManagedRuntime.ManagedRuntime<any, never>,
  private readonly _mcpServerNames: readonly string[] = [],
  /** @internal */ readonly _gatewayIntervalMs?: number,
) {}
```

And in the `build()` method, pass the interval:

```typescript
return new ReactiveAgent(
  engine,
  agentId,
  managedRuntime,
  mcpServerNames,
  gatewayOptions?.heartbeat?.intervalMs,
);
```

**Step 4: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/gateway-start.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/gateway-start.test.ts
git commit -m "feat(runtime): add ReactiveAgent.start() for persistent gateway loop"
```

---

## Task 3: Add gateway status method to ReactiveAgent

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Test: `packages/runtime/tests/gateway-start.test.ts` (add test)

**Step 1: Write the failing test**

Add to `gateway-start.test.ts`:

```typescript
test("gatewayStatus() returns gateway state", async () => {
  const agent = await ReactiveAgents.create()
    .withName("status-test")
    .withProvider("test")
    .withGateway({
      heartbeat: { intervalMs: 100 },
      policies: { dailyTokenBudget: 50000 },
    })
    .withReasoning()
    .withTestResponses({ "": "FINAL ANSWER: done" })
    .build();

  const handle = agent.start();
  await new Promise((r) => setTimeout(r, 250));

  const status = await agent.gatewayStatus();
  expect(status).toBeDefined();
  expect(status!.stats.heartbeatsFired).toBeGreaterThanOrEqual(1);

  await handle.stop();
  await agent.dispose();
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement `gatewayStatus()` on ReactiveAgent**

```typescript
async gatewayStatus(): Promise<GatewayStatus | null> {
  try {
    return await this.runtime.runPromise(
      Effect.gen(function* () {
        const gwMod = yield* Effect.promise(() => import("@reactive-agents/gateway"));
        const gw = yield* (gwMod.GatewayService as any);
        return yield* gw.status();
      }) as Effect.Effect<any>,
    );
  } catch {
    return null;
  }
}
```

Import `GatewayStatus` type from the gateway package.

**Step 4: Run tests**

**Step 5: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/gateway-start.test.ts
git commit -m "feat(runtime): add ReactiveAgent.gatewayStatus() for monitoring"
```

---

## Task 4: Update main.ts to demonstrate persistent gateway

**Files:**
- Modify: `main.ts`

**Step 1: Update main.ts**

Replace the current `agent.run()` call with `agent.start()`:

```typescript
import { ReactiveAgents } from "reactive-agents";

await using agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("cogito:14b")
  .withGateway({
    heartbeat: { intervalMs: 60000, instruction: "Check GitHub for new issues and PRs on tylerjrbuell/reactive-agents-ts" },
    crons: [{ schedule: "0 9 * * SAT", instruction: "Review open PRs for tylerjrbuell/reactive-agents-ts" }],
    policies: { dailyTokenBudget: 100_000 },
  })
  .withMCP({
    name: "github",
    transport: "stdio",
    command: "docker",
    args: ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "" },
  })
  .withTools()
  .withEvents()
  .withName("my-agent")
  .withReasoning({ defaultStrategy: "reactive" })
  .withObservability({ verbosity: "normal", live: true })
  .build();

// Start persistent gateway — runs heartbeats + crons until stopped
const handle = agent.start();
console.log("Gateway started. Press Ctrl+C to stop.\n");

// Graceful shutdown on SIGINT/SIGTERM
const shutdown = async () => {
  console.log("\nStopping gateway...");
  const summary = await handle.stop();
  console.log("Gateway stopped:", summary);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep alive until stopped
await handle.done;
```

**Step 2: Verify it builds**

Run: `bun run build`
Expected: Clean build

**Step 3: Commit**

```bash
git add main.ts
git commit -m "feat: update main.ts to use agent.start() for persistent gateway loop"
```

---

## Task 5: Fix signal registration container isolation bug

**Files:**
- Modify: `scripts/signal-register.sh`

**Problem:** The register and verify commands run in separate `docker run --rm` containers. signal-cli stores the sessionId in memory during registration, and it's lost when the container exits. The verify step starts a fresh container with no sessionId → NullPointerException.

**Step 1: Rewrite the script to use a single container**

Replace the separate docker run commands with a single persistent container:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Signal Registration Helper
# Registers a phone number with signal-cli for agent use.
#
# Usage: ./scripts/signal-register.sh +1234567890 [data-dir]
#
# Signal requires a captcha for registration:
#   1. Open https://signalcaptchas.org/registration/generate.html
#   2. Solve the captcha
#   3. Right-click "Open Signal" link → copy link address
#   4. Paste the signalcaptcha:// URL when prompted
#
# After registration, auth data is stored in the data directory
# and volume-mounted into the Docker container on subsequent runs.

PHONE="${1:?Usage: $0 +1234567890 [data-dir]}"
DATA_DIR="${2:-./signal-data}"
IMAGE="ghcr.io/reactive-agents/signal-mcp"

# Fall back to local build if published image not available
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Published image not found. Building locally..."
  IMAGE="signal-mcp:local"
  docker build -t "$IMAGE" docker/signal-mcp/
fi

mkdir -p "$DATA_DIR"

echo "=== Signal Registration ==="
echo "Phone: $PHONE"
echo "Data:  $DATA_DIR"
echo ""

echo "Step 1: Solve the captcha"
echo "  Open: https://signalcaptchas.org/registration/generate.html"
echo "  Solve the captcha, then right-click 'Open Signal' and copy the link."
echo ""
read -rp "Paste the signalcaptcha:// URL: " CAPTCHA

echo ""
echo "Step 2: Registering and verifying in a single session..."
echo "  (signal-cli will request a verification code, then prompt you to enter it)"
echo ""

# Run register + verify in the SAME container so the session ID persists.
# We use bash -c to chain the two commands with a read in between.
docker run -it --rm \
  -v "$(realpath "$DATA_DIR"):/data:rw" \
  -e SIGNAL_CLI_CONFIG=/data \
  --entrypoint bash \
  "$IMAGE" \
  -c "
    echo 'Requesting verification code...'
    signal-cli -a '$PHONE' register --captcha '$CAPTCHA'
    echo ''
    echo 'Enter the verification code sent to $PHONE:'
    read -r CODE
    signal-cli -a '$PHONE' verify \"\$CODE\"
    echo ''
    echo 'Verification complete.'
  "

echo ""
echo "Registration complete."
echo "Auth data stored in: $DATA_DIR"
echo ""
echo "Add to your .env:"
echo "  SIGNAL_PHONE_NUMBER=$PHONE"
```

**Step 2: Test the script syntax**

Run: `bash -n scripts/signal-register.sh` (syntax check only)
Expected: No errors

**Step 3: Commit**

```bash
git add scripts/signal-register.sh
git commit -m "fix(signal): run register + verify in same container to preserve sessionId"
```

---

## Task 6: Run all tests and verify

**Step 1: Run full test suite**

```bash
bun test
```

Expected: All tests pass (1007+ existing + new gateway tests)

**Step 2: Verify build**

```bash
bun run build
```

Expected: Clean build, no errors

**Step 3: Commit any remaining fixes**

---

## Notes

### Custom Signal MCP Server (Future Consideration)

The user suggested building a custom Signal MCP server instead of relying on `rymurr/signal-mcp`. This is a valid concern — the dependency is a small GitHub repo (26 stars) requiring Python 3.13+. A custom TypeScript MCP server wrapping signal-cli's JSON-RPC daemon mode (`signal-cli -a PHONE jsonRpc`) would:

- Eliminate the Python 3.13+ dependency
- Use signal-cli's native JSON-RPC mode (reads from stdin, writes to stdout)
- Be maintained as part of this project
- Reduce Docker image size (no Python layer needed)

This is tracked as a future enhancement, not blocking the current fixes.
