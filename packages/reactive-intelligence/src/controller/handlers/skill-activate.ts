import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"
import { loadSkillContent } from "./skill-loader.js"

export const skillActivateHandler: InterventionHandler<"skill-activate"> = {
  type: "skill-activate",
  description: "Load and inject a skill SKILL.md into the agent context",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) =>
    Effect.gen(function* () {
      const skillName = decision.skillName
      if (!skillName) {
        return {
          applied: false,
          patches: [],
          cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
          reason: "no-skill-id",
          telemetry: {},
        }
      }

      const activatedSkills = (state as any).activatedSkills as
        | Array<{ id: string; content: string }>
        | undefined
      const already = (activatedSkills ?? []).some((s) => s.id === skillName)
      if (already) {
        return {
          applied: false,
          patches: [],
          cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
          reason: "already-active",
          telemetry: { skillName },
        }
      }

      const content = yield* Effect.promise(() => loadSkillContent(skillName))
      if (!content) {
        return {
          applied: false,
          patches: [],
          cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
          reason: "skill-not-found",
          telemetry: { skillName },
        }
      }

      return {
        applied: true,
        patches: [{ kind: "inject-skill-content" as const, skillId: skillName, content }],
        cost: {
          tokensEstimated: Math.ceil(content.length / 4),
          latencyMsEstimated: 100,
        },
        reason: "fired",
        telemetry: { skillName },
      }
    }),
}
