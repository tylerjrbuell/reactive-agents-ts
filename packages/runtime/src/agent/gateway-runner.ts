/**
 * Gateway lifecycle helpers (W26-D step 1).
 *
 * Extracted from reactive-agent.ts. `startGateway` runs the persistent
 * gateway loop (heartbeats + crons + channel subscriptions) and returns a
 * GatewayHandle. `queryGatewayStatus` peeks at the current GatewayStatus
 * if the gateway service is available, otherwise returns null.
 *
 * Both functions take a typed view of the ReactiveAgent's internal state
 * via `ReactiveAgentGatewayView` so the methods stay thin wrappers (one-liners).
 */
import { Effect, ManagedRuntime } from "effect";
import type { AgentSession, SessionOptions } from "../chat.js";
import { bootstrapGateway } from "./gateway-bootstrap.js";
import { makeExecuteEvent } from "./execute-event.js";
import { makeGatewayTick } from "./gateway-tick.js";
import {
  subscribeChannelHandler,
  buildGatewayHandle,
} from "./gateway-driver.js";
import { createChatManager } from "./chat-manager-factory.js";
import {
  GatewayChatManager,
  channelOutboundToolGuidance,
} from "../gateway-context-formatting.js";
import type { ChannelsConfig } from "@reactive-agents/channels";
import type { GatewaySummary, GatewayHandle } from "../builder/types.js";

/**
 * Typed view of the ReactiveAgent internals consumed by the gateway runner.
 * Mirrors private fields that were accessed via `self.*` inside the original
 * `start()` method body.
 */
export interface ReactiveAgentGatewayView {
  readonly runtime: ManagedRuntime.ManagedRuntime<any, never>;
  readonly engine: {
    execute: (task: any) => Effect.Effect<any, any>;
  };
  readonly agentId?: string;
  readonly _channelsConfig?: ChannelsConfig;
  readonly _gatewayEnabled?: boolean;
  readonly _gatewayIntervalMs?: number;
  readonly _hasCustomHeartbeatInstruction?: boolean;
  readonly _gatewayPersistMemory?: boolean;
  readonly _sessionPersist?: boolean;
  readonly _gatewayOptions?: {
    accessControl?: { mode?: "chat" | "task"; sessionTtlDays?: number };
  };
  session: (
    options?: SessionOptions & {
      persist?: boolean;
      id?: string;
      maxAgeDays?: number;
    },
  ) => AgentSession;
}

/**
 * Peek at the gateway service status. Returns `null` when the gateway service
 * is not wired or any error occurs (service unavailable, runtime in shutdown,
 * etc.) — callers treat null as "no gateway info available."
 */
export const queryGatewayStatus = async (
  self: ReactiveAgentGatewayView,
): Promise<import("@reactive-agents/gateway").GatewayStatus | null> => {
  try {
    return await self.runtime.runPromise(
      Effect.gen(function* () {
        const gwMod = yield* Effect.promise(
          () => import("@reactive-agents/gateway"),
        );
        const gw = yield* gwMod.GatewayService as any;
        return yield* gw.status();
      }) as Effect.Effect<any>,
    );
  } catch {
    return null;
  }
};

/**
 * Start the persistent gateway loop (heartbeats + crons + channel handlers).
 *
 * Requires `.withGateway()` configured at build time. Throws when not enabled.
 * Returns a GatewayHandle whose `.stop()` ends the loop and `.done` resolves
 * with a GatewaySummary once the loop exits.
 */
export const startGateway = (self: ReactiveAgentGatewayView): GatewayHandle => {
  if (!self._gatewayEnabled) {
    throw new Error(
      "Gateway not configured. Call .withGateway() before .start()",
    );
  }

  let stopped = false;
  let isExecuting = false; // concurrency guard — prevents overlapping agent runs
  let timer: ReturnType<typeof setInterval> | null = null;
  let heartbeatsFired = 0;
  let totalRuns = 0;
  let cronChecks = 0;
  let chatTurns = 0;
  let lastCompactionAt = 0;
  let resolveStop: ((summary: GatewaySummary) => void) | null = null;
  let unsubChannel: (() => void) | null = null;
  let chatManagerRef: GatewayChatManager | null = null;
  let channelAdaptersCleanup: (() => Promise<void>) | null = null;

  const stopPromise = new Promise<GatewaySummary>((resolve) => {
    resolveStop = resolve;
  });

  const gatewayIntervalMs = self._gatewayIntervalMs ?? 60_000;

  // Start the loop asynchronously
  const loopPromise = (async () => {
    const channelsCfg = self._channelsConfig;
    const bootstrap = await bootstrapGateway({
      runtime: self.runtime,
      channelsConfig: channelsCfg,
      gatewayIntervalMs,
      createSession: (sessionId) =>
        self.session({
          id: sessionId,
          persist: self._sessionPersist,
        }),
    });

    if (!bootstrap.ok) {
      const summary: GatewaySummary = {
        heartbeatsFired,
        totalRuns,
        cronChecks,
        chatTurns,
        error: bootstrap.error.message,
      };
      (resolveStop as ((s: GatewaySummary) => void) | null)?.(summary);
      throw bootstrap.error;
    }

    const { gw, sched, eb, glog } = bootstrap;
    channelAdaptersCleanup = bootstrap.channelAdaptersCleanup;

    // Helper to publish events safely
    const publish = async (event: any) => {
      if (!eb) return;
      try {
        await self.runtime.runPromise(eb.publish(event));
      } catch {
        /* observability errors don't kill the loop */
      }
    };

    // Helper to run an event through the gateway and execute if approved.
    // Guarded by `isExecuting` to prevent overlapping agent runs.
    // Each execution uses a unique agentId suffix so it bootstraps with empty
    // memory — gateway runs are stateless and don't carry context from prior runs.
    const executeEvent = makeExecuteEvent({
      publish,
      glog,
      engine: self.engine,
      runtime: self.runtime,
      gw,
      agentId: self.agentId ?? "unknown",
      persistMemory: self._gatewayPersistMemory ?? false,
      getIsExecuting: () => isExecuting,
      setIsExecuting: (v) => {
        isExecuting = v;
      },
      incrementTotalRuns: () => {
        totalRuns++;
      },
    });

    // ─── Gateway chat mode ────────────────────────────────────────
    const gwOpts = self._gatewayOptions;
    const channelMode = gwOpts?.accessControl?.mode ?? "chat";
    const sessionTtlDays: number =
      gwOpts?.accessControl?.sessionTtlDays ?? 30;

    const chatManager = createChatManager({
      agentId: self.agentId ?? "gateway",
      gatewayOptions: gwOpts,
      runtime: self.runtime as ManagedRuntime.ManagedRuntime<unknown, unknown>,
      executeEvent,
    });
    chatManagerRef = chatManager;

    const tick = makeGatewayTick({
      runtime: self.runtime,
      agentId: self.agentId ?? "gateway",
      hasCustomHeartbeatInstruction:
        self._hasCustomHeartbeatInstruction ?? false,
      sessionTtlDays,
      gw,
      sched,
      glog,
      executeEvent,
      chatManager,
      getStopped: () => stopped,
      incrementHeartbeats: () => ++heartbeatsFired,
      incrementCronChecks: () => ++cronChecks,
      getLastCompactionAt: () => lastCompactionAt,
      setLastCompactionAt: (v) => {
        lastCompactionAt = v;
      },
    });

    // Subscribe to channel messages from MCP servers for push-based messaging
    unsubChannel = await subscribeChannelHandler({
      eb,
      gw,
      glog,
      channelMode,
      channelOutboundToolGuidance,
      executeEvent,
      chatManager,
      runtime: self.runtime as ManagedRuntime.ManagedRuntime<any, never>,
      agentId: self.agentId ?? "unknown",
      getStopped: () => stopped,
      incrementChatTurns: () => {
        chatTurns++;
      },
    });

    timer = setInterval(tick, gatewayIntervalMs);

    // Run first tick — skip immediate execution when using default heartbeat
    // instruction (avoids confused first run with no context)
    const hasCustomInstruction = self._hasCustomHeartbeatInstruction;
    if (hasCustomInstruction) {
      await tick();
    }
  })();

  // If loopPromise rejects (gateway not configured), propagate
  loopPromise.catch(() => {});

  return buildGatewayHandle({
    setStopped: (v) => {
      stopped = v;
    },
    getTimer: () => timer,
    getUnsubChannel: () => unsubChannel,
    getChannelAdaptersCleanup: () => channelAdaptersCleanup,
    getChatManager: () => chatManagerRef,
    resolveStop: (s) => {
      resolveStop?.(s);
    },
    stopPromise,
    getCounters: () => ({
      heartbeatsFired,
      totalRuns,
      cronChecks,
      chatTurns,
    }),
  });
};
