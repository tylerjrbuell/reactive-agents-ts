import { Context, Effect, Layer, Ref } from "effect";
import type { InteractionModeType } from "../types/mode.js";
import type { InteractionConfig, ModeTransitionRule } from "../types/config.js";
import { defaultInteractionConfig } from "../types/config.js";
import type { ModeError } from "../errors/errors.js";
import { EventBus } from "@reactive-agents/core";

export class ModeSwitcher extends Context.Tag("ModeSwitcher")<
  ModeSwitcher,
  {
    readonly getMode: (agentId: string) => Effect.Effect<InteractionModeType>;

    readonly setMode: (
      agentId: string,
      targetMode: InteractionModeType,
    ) => Effect.Effect<void, ModeError>;

    readonly evaluateTransition: (
      agentId: string,
      context: {
        confidence?: number;
        cost?: number;
        durationMs?: number;
        userActive?: boolean;
        consecutiveApprovals?: number;
      },
    ) => Effect.Effect<InteractionModeType | null>;
  }
>() {}

export const ModeSwitcherLive = (
  config: InteractionConfig = defaultInteractionConfig,
) =>
  Layer.effect(
    ModeSwitcher,
    Effect.gen(function* () {
      const eventBus = yield* EventBus;
      const modesRef = yield* Ref.make<Map<string, InteractionModeType>>(new Map());

      const checkConditions = (
        rule: ModeTransitionRule,
        context: {
          confidence?: number;
          cost?: number;
          durationMs?: number;
          userActive?: boolean;
          consecutiveApprovals?: number;
        },
      ): boolean => {
        return rule.conditions.every((condition) => {
          switch (condition.type) {
            case "uncertainty":
              return context.confidence !== undefined && context.confidence < condition.threshold;
            case "cost":
              return context.cost !== undefined && context.cost > condition.threshold;
            case "duration":
              return context.durationMs !== undefined && context.durationMs > condition.threshold;
            case "user-active":
              return context.userActive === true;
            case "confidence":
              return context.confidence !== undefined && context.confidence >= condition.threshold;
            case "consecutive-approvals":
              return (
                context.consecutiveApprovals !== undefined &&
                context.consecutiveApprovals >= condition.threshold
              );
            default:
              return false;
          }
        });
      };

      return {
        getMode: (agentId) =>
          Ref.get(modesRef).pipe(
            Effect.map((m) => m.get(agentId) ?? config.defaultMode),
          ),

        setMode: (agentId, targetMode) =>
          Effect.gen(function* () {
            const currentMode = yield* Ref.get(modesRef).pipe(
              Effect.map((m) => m.get(agentId) ?? config.defaultMode),
            );

            if (currentMode === targetMode) return;

            yield* Ref.update(modesRef, (m) => {
              const next = new Map(m);
              next.set(agentId, targetMode);
              return next;
            });

            yield* eventBus.publish({
              _tag: "Custom",
              type: "interaction.mode-changed",
              payload: { agentId, from: currentMode, to: targetMode },
            });
          }),

        evaluateTransition: (agentId, context) =>
          Effect.gen(function* () {
            const currentMode = yield* Ref.get(modesRef).pipe(
              Effect.map((m) => m.get(agentId) ?? config.defaultMode),
            );

            // Check escalation rules first
            for (const rule of config.escalationRules) {
              if (rule.from === currentMode && checkConditions(rule, context)) {
                return rule.to;
              }
            }

            // Then check de-escalation rules
            for (const rule of config.deescalationRules) {
              if (rule.from === currentMode && checkConditions(rule, context)) {
                return rule.to;
              }
            }

            return null;
          }),
      };
    }),
  );
