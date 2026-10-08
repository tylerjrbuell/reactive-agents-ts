import type { ActionRequest, WorldState } from "../world/schema.js";
import type { Perception } from "../engine/perceive.js";
import type { Decision, DecisionMaker } from "./types.js";
import { renderPerception } from "../engine/perceive.js";
import { applyAction } from "../engine/actions.js";
import { INVENTORY_CAPACITY, inventoryUnits } from "../engine/inventory.js";
import { makeRng } from "../engine/rng.js";
import { ALL_ACTION_TYPES } from "./judgment.js";

function tileDistance(left: string, right: string): number {
  return Math.max(
    Math.abs(left.charCodeAt(0) - right.charCodeAt(0)),
    Math.abs(Number(left.slice(1)) - Number(right.slice(1))),
  );
}

/** Engine ids the model must quote verbatim: resources, survivors, walkable tiles, carried items. */
function engineIdBlock(world: WorldState, agentId: string, perception: Perception): string {
  const self = perception.self;
  const resources = perception.visibleResources
    .filter((resource) => resource.quantity > 0)
    .map((resource) => `${resource.id} ${resource.kind}x${resource.quantity}@${resource.tile}${resource.tile === self.location ? " (here)" : ""}`)
    .join("; ") || "none in sight";
  const survivors = perception.visibleAgents
    .filter((agent) => tileDistance(self.location, agent.location) <= 1)
    .map((agent) => `${agent.name} (${agent.id}@${agent.location})`)
    .join("; ") || "none nearby";
  const steps = perception.visibleTiles
    .filter((tile) => tile.biome !== "ocean" && tile.tile !== self.location && tileDistance(self.location, tile.tile) === 1)
    .map((tile) => tile.tile)
    .sort()
    .join(", ") || "none";
  const carried = self.inventory.filter((item) => item.qty > 0).map((item) => `${item.kind}x${item.qty}`).join(", ") || "empty";
  const camp = world.structures.find((structure) => structure.kind === "camp")?.tile ?? world.structures[0]?.tile ?? "?";
  return [
    `Resources (gather needs the id, only at your tile): ${resources}.`,
    `Nearby survivors (social actions need the id in parentheses): ${survivors}.`,
    `Walkable adjacent tiles (move needs one): ${steps}. Camp: ${camp}.`,
    `Carrying ${inventoryUnits(self.inventory)}/${INVENTORY_CAPACITY}: ${carried}.`,
    `Target formats: gather=<resource id at your tile>, move=<adjacent tile>, eat/drink=<carried kind>, hunt needs no target (forest/grass, or a snare at your tile; craft a snare first with {"type":"craft","target":"snare"}), help/share/talk/trade/steal=<survivor id within 1 tile>, build=signal-fire (needs 2 wood), inspect=<tile>, play=<idol id>, gift needs target=<ally id> plus item=<idol id>.`,
    `Survive first: drink at thirst 6+, eat at hunger 8+, rest at energy 8+, heal when hurt. Quote ids exactly; never invent one.`,
  ].join("\n");
}

/** Dry-run a model choice against a cloned world so only legal moves leave this maker. */
function choiceIsLegal(world: WorldState, agentId: string, action: ActionRequest): boolean {
  const index = Math.max(0, world.agents.findIndex((agent) => agent.id === agentId));
  const probe = makeRng(world.seed * 31 + world.clock.tick * 7 + index);
  try {
    return applyAction(world, agentId, action, probe).ok;
  } catch {
    return false;
  }
}

/**
 * Decision maker backed by a ReactiveAgents structured-output model.
 * The model sees engine ids it must quote verbatim, and every choice is
 * dry-run against a cloned world: only legal moves leave this maker, while
 * provider failures and illegal choices degrade to the scripted maker.
 */
export function makeLlmDecisionMaker(
  agent: { run(input: string): Promise<{ object?: unknown; objectError?: string }> },
  fallback: () => DecisionMaker = () => { throw new Error("no fallback decision maker configured"); },
): DecisionMaker {
  return {
    async decide({ world, agentId, perception }: { world: WorldState; agentId: string; perception: Perception }): Promise<Decision> {
      const held = world.gameplay?.idols?.filter((idol) => idol.holderId === agentId && !idol.played) ?? [];
      const prompt = [
        `You control ${perception.self.name} on an island at hour ${perception.tick}.`,
        renderPerception(perception),
        engineIdBlock(world, agentId, perception),
        held.length > 0
          ? `Held advantages: ${held.map((idol) => `${idol.kind} (${idol.id}, ${idol.scope}, expires tick ${idol.expiresAtTick})`).join("; ")}. Play with {"type":"play","target":"<idol-id>"} when exposed or hurt; gift shareable edges with {"type":"gift","target":"<ally-id>","item":"<idol-id>"}.`
          : "No advantages held.",
        `Choose exactly one island action. Allowed types: ${ALL_ACTION_TYPES.join(", ")}.`,
        `Return JSON {"type": string, "target"?: string, "item"?: string} using the target formats above.`,
      ].join("\n\n");
      const scripted = () => fallback();
      try {
        const result = await agent.run(prompt);
        const object = result.objectError ? undefined : (result.object as { type?: unknown; target?: unknown; item?: unknown } | undefined);
        const type = object?.type;
        if (typeof type === "string" && (ALL_ACTION_TYPES as readonly string[]).includes(type)) {
          const action: ActionRequest = {
            type: type as ActionRequest["type"],
            ...(typeof object?.target === "string" && object.target.length > 0 ? { target: object.target } : {}),
            ...(typeof object?.item === "string" && object.item.length > 0 ? { item: object.item } : {}),
          };
          if (choiceIsLegal(world, agentId, action)) {
            return {
              goal: "Act on model judgment",
              reasoningSummary: "The model chose from live perception",
              plan: [action.type, ...(action.target ? [action.target] : [])],
              action,
              confidence: 0.7,
              probabilities: { [action.type]: 0.7 },
              calibrated: true,
            };
          }
        }
      } catch {
        // provider failure: degrade below
      }
      return scripted().decide({ world, agentId, perception });
    },
  };
}
