import type { Perception } from "../engine/perceive.js";

const MAX_TARGET_CHOICES = 26;
const RESERVED_CHOICES = 2;

type Candidate = {
  key: string;
  label: string;
  target: string;
  priority: number;
  distance: number;
  category: string;
};

function tileDistance(left: string, right: string): number {
  return Math.max(
    Math.abs(left.charCodeAt(0) - right.charCodeAt(0)),
    Math.abs(Number(left.slice(1)) - Number(right.slice(1))),
  );
}

/** Build stable, provider-bounded choice criteria from only the agent's perception. */
export function buildTargetChoices(perception: Perception): {
  criteria: Record<string, string>;
  targets: Record<string, string | undefined>;
} {
  const { self } = perception;
  const candidates: Candidate[] = [];
  for (const resource of perception.visibleResources) {
    if (resource.quantity <= 0) continue;
    const priority = resource.kind === "water" && self.needs.thirst >= 7
      ? 120
      : ["berries", "fish", "meat"].includes(resource.kind) && self.needs.hunger >= 7
        ? 110
        : 20;
    candidates.push({
      key: `resource:${resource.id}`,
      label: `${resource.kind} at ${resource.tile}`,
      target: resource.id,
      priority,
      distance: tileDistance(self.location, resource.tile),
      category: resource.kind === "water" ? "resource-water" : ["berries", "fish", "meat"].includes(resource.kind) ? "resource-food" : "resource-other",
    });
  }
  for (const agent of perception.visibleAgents) {
    const range = tileDistance(self.location, agent.location);
    if (range > 1) continue;
    candidates.push({
      key: `agent:${agent.id}`,
      label: `person ${agent.name}`,
      target: agent.id,
      priority: 60,
      distance: range,
      category: "agent",
    });
  }
  for (const item of self.inventory) {
    if (item.qty <= 0) continue;
    const priority = item.kind === "water" && self.needs.thirst >= 7
      ? 105
      : ["berries", "fish", "meat"].includes(item.kind) && self.needs.hunger >= 7
        ? 100
        : 30;
    candidates.push({
      key: `item:${item.kind}`,
      label: `${item.kind} in inventory`,
      target: item.kind,
      priority,
      distance: 0,
      category: item.kind === "water" ? "item-water" : ["berries", "fish", "meat"].includes(item.kind) ? "item-food" : "item-other",
    });
  }
  for (const tile of perception.visibleTiles) {
    if (tile.biome === "ocean" || tile.tile === self.location) continue;
    const distance = tileDistance(self.location, tile.tile);
    candidates.push({
      key: `tile:${tile.tile}`,
      label: `move to ${tile.tile}`,
      target: tile.tile,
      priority: distance === 1 ? 50 : 10,
      distance,
      category: distance === 1 ? "tile-adjacent" : "tile-other",
    });
  }

  const compareCandidates = (left: Candidate, right: Candidate) =>
    right.priority - left.priority ||
    left.distance - right.distance ||
    left.key.localeCompare(right.key);
  candidates.sort(compareCandidates);
  const selected: Candidate[] = [];
  const selectedKeys = new Set<string>();
  for (const category of ["resource-water", "resource-food", "agent", "tile-adjacent", "item-water", "item-food"]) {
    const candidate = candidates.find((item) => item.category === category && !selectedKeys.has(item.key));
    if (candidate) {
      selected.push(candidate);
      selectedKeys.add(candidate.key);
    }
  }
  for (const candidate of candidates) {
    if (selected.length >= MAX_TARGET_CHOICES - RESERVED_CHOICES) break;
    if (selectedKeys.has(candidate.key)) continue;
    selected.push(candidate);
    selectedKeys.add(candidate.key);
  }

  const criteria: Record<string, string> = {
    none: "no target needed",
    here: `current location ${self.location}`,
  };
  const targets: Record<string, string | undefined> = {
    none: undefined,
    here: self.location,
  };
  for (const candidate of selected.slice(0, MAX_TARGET_CHOICES - RESERVED_CHOICES)) {
    criteria[candidate.key] = candidate.label;
    targets[candidate.key] = candidate.target;
  }
  return { criteria, targets };
}
