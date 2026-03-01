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

// ─── Status Snapshot ────────────────────────────────────────────────────────

export interface GatewayStatus {
  readonly isRunning: boolean;
  readonly stats: GatewayStats;
  readonly uptime: number;
  readonly state: GatewayState;
}

// ─── Initial Stats ──────────────────────────────────────────────────────────

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

// ─── Service Tag ────────────────────────────────────────────────────────────

export class GatewayService extends Context.Tag("GatewayService")<
  GatewayService,
  {
    readonly processEvent: (
      event: GatewayEvent,
    ) => Effect.Effect<PolicyDecision, never>;
    readonly status: () => Effect.Effect<GatewayStatus, never>;
    readonly updateTokensUsed: (
      tokens: number,
    ) => Effect.Effect<void, never>;
  }
>() {}

// ─── Live Implementation ────────────────────────────────────────────────────

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

      // Always add adaptive heartbeat
      if (policyConfig?.heartbeatPolicy) {
        policies.push(
          createAdaptiveHeartbeatPolicy({ mode: policyConfig.heartbeatPolicy }),
        );
      } else {
        policies.push(createAdaptiveHeartbeatPolicy());
      }

      if (policyConfig?.dailyTokenBudget) {
        policies.push(
          createCostBudgetPolicy({
            dailyTokenBudget: policyConfig.dailyTokenBudget,
          }),
        );
      }

      if (policyConfig?.maxActionsPerHour) {
        policies.push(
          createRateLimitPolicy({
            maxPerHour: policyConfig.maxActionsPerHour,
          }),
        );
      }

      if (policyConfig?.mergeWindowMs) {
        policies.push(createEventMergingPolicy());
      }

      return {
        processEvent: (event: GatewayEvent) =>
          Effect.gen(function* () {
            // Track receipt in stats by source
            yield* Ref.update(statsRef, (s) => {
              switch (event.source) {
                case "webhook":
                  return { ...s, webhooksReceived: s.webhooksReceived + 1 };
                case "channel":
                  return { ...s, channelMessages: s.channelMessages + 1 };
                default:
                  return s;
              }
            });

            const state = yield* Ref.get(stateRef);
            const decision = yield* evaluatePolicies(policies, event, state);

            // Track decision in stats
            yield* Ref.update(statsRef, (s) => {
              switch (decision.action) {
                case "skip":
                  if (event.source === "heartbeat") {
                    return {
                      ...s,
                      heartbeatsSkipped: s.heartbeatsSkipped + 1,
                      actionsSuppressed: s.actionsSuppressed + 1,
                    };
                  }
                  return { ...s, actionsSuppressed: s.actionsSuppressed + 1 };
                case "execute":
                  if (event.source === "heartbeat") {
                    return { ...s, heartbeatsFired: s.heartbeatsFired + 1 };
                  }
                  if (event.source === "webhook") {
                    return {
                      ...s,
                      webhooksProcessed: s.webhooksProcessed + 1,
                    };
                  }
                  if (event.source === "cron") {
                    return { ...s, cronsExecuted: s.cronsExecuted + 1 };
                  }
                  return s;
                case "merge":
                  return { ...s, webhooksMerged: s.webhooksMerged + 1 };
                case "escalate":
                  return { ...s, actionsEscalated: s.actionsEscalated + 1 };
                default:
                  return s;
              }
            });

            // Update gateway state based on event + decision
            if (event.source === "heartbeat") {
              if (decision.action === "skip") {
                yield* Ref.update(stateRef, (s) => ({
                  ...s,
                  consecutiveHeartbeatSkips:
                    s.consecutiveHeartbeatSkips + 1,
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
