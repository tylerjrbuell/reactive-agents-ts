import { Effect, Context, Layer, Ref } from "effect";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../types.js";

// ─── Policy Interface ───────────────────────────────────────────────────────

export interface SchedulingPolicy {
  readonly _tag: string;
  readonly priority: number;
  readonly evaluate: (
    event: GatewayEvent,
    state: GatewayState,
  ) => Effect.Effect<PolicyDecision | null, never>;
}

// ─── Core Evaluation ────────────────────────────────────────────────────────

/**
 * Evaluate all policies in priority order (lower = earlier).
 * First non-null decision wins. Default: execute.
 */
export const evaluatePolicies = (
  policies: readonly SchedulingPolicy[],
  event: GatewayEvent,
  state: GatewayState,
): Effect.Effect<PolicyDecision, never> => {
  const sorted = [...policies].sort((a, b) => a.priority - b.priority);

  return Effect.gen(function* () {
    for (const policy of sorted) {
      const decision = yield* policy.evaluate(event, state);
      if (decision !== null) {
        return decision;
      }
    }
    // Default: execute
    return {
      action: "execute" as const,
      taskDescription: describeEvent(event),
    };
  });
};

/**
 * Describe an event as a human-readable task description for the execute decision.
 */
const describeEvent = (event: GatewayEvent): string => {
  const source = event.source;
  const payloadStr =
    typeof event.payload === "string"
      ? event.payload
      : typeof event.payload === "object" && event.payload !== null
        ? JSON.stringify(event.payload)
        : String(event.payload ?? "");

  const preview = payloadStr.length > 100 ? payloadStr.slice(0, 100) + "..." : payloadStr;

  return `[${source}] ${preview || `event ${event.id}`}`;
};

// ─── Service Tag + Live Implementation ──────────────────────────────────────

export class PolicyEngine extends Context.Tag("PolicyEngine")<
  PolicyEngine,
  {
    readonly evaluate: (
      event: GatewayEvent,
      state: GatewayState,
    ) => Effect.Effect<PolicyDecision, never>;
    readonly addPolicy: (policy: SchedulingPolicy) => Effect.Effect<void, never>;
    readonly getPolicies: () => Effect.Effect<readonly SchedulingPolicy[], never>;
  }
>() {}

export const PolicyEngineLive = (initialPolicies?: SchedulingPolicy[]) =>
  Layer.effect(
    PolicyEngine,
    Effect.gen(function* () {
      const policiesRef = yield* Ref.make<readonly SchedulingPolicy[]>(
        initialPolicies ?? [],
      );

      return {
        evaluate: (event: GatewayEvent, state: GatewayState) =>
          Effect.gen(function* () {
            const policies = yield* Ref.get(policiesRef);
            return yield* evaluatePolicies(policies, event, state);
          }),

        addPolicy: (policy: SchedulingPolicy) =>
          Ref.update(policiesRef, (current) => [...current, policy]),

        getPolicies: () => Ref.get(policiesRef),
      };
    }),
  );
