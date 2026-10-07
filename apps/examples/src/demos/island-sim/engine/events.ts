export type SimEvent =
  | { kind: "agent-moved"; tick: number; agentId: string; from: string; to: string }
  | { kind: "resource-gathered"; tick: number; agentId: string; resourceId: string; amount: number }
  | { kind: "hunted"; tick: number; agentId: string; animalId: string; amount: number }
  | { kind: "built"; tick: number; agentId: string; structureId: string; structureKind?: string }
  | { kind: "crafted"; tick: number; agentId: string; item: string }
  | { kind: "ate"; tick: number; agentId: string; food: string }
  | { kind: "drank"; tick: number; agentId: string; water: string }
  | { kind: "rested"; tick: number; agentId: string }
  | { kind: "traded"; tick: number; from: string; to: string; given: string; received: string; trustDelta: number }
  | { kind: "shared"; tick: number; from: string; to: string; item: string; amount: number; trustDelta: number }
  | { kind: "helped"; tick: number; from: string; to: string; item: string; need: string; amount: number; trustDelta: number }
  | { kind: "talked"; tick: number; from: string; to: string; topic: string; trustDelta: number }
  | { kind: "stolen"; tick: number; from: string; to: string; item: string; amount: number; detected: boolean; trustDelta: number }
  | { kind: "sabotaged"; tick: number; from: string; to: string; item: string; amount: number; trustDelta: number }
  | { kind: "inventory-stored"; tick: number; agentId: string; item: string; amount: number; cache: "camp" | "alliance" }
  | { kind: "inventory-retrieved"; tick: number; agentId: string; item: string; amount: number; cache: "camp" | "alliance" }
  | { kind: "objective-progress"; tick: number; agentId: string; objectiveId: string; title: string; progress: number; target: number }
  | { kind: "objective-completed"; tick: number; agentId: string; objectiveId: string; title: string }
  | { kind: "alliance-formed"; tick: number; allianceId: string; name: string; members: string[] }
  | { kind: "alliance-dissolved"; tick: number; allianceId: string; name: string; members: string[] }
  | { kind: "exile-started"; tick: number; agentId: string; location: string; returnAtTick: number; reason: string }
  | { kind: "exile-returned"; tick: number; agentId: string; location: string }
  | { kind: "island-twist"; tick: number; twist: "cache-found" | "rescue-signal" | "weather-front"; description: string }
  | { kind: "inspected"; tick: number; agentId: string; target: string }
  | { kind: "action-failed"; tick: number; agentId: string; reason: string }
  | { kind: "weather"; tick: number; condition: string; tempC: number }
  | { kind: "needs-critical"; tick: number; agentId: string; need: string }
  | { kind: "agent-died"; tick: number; agentId: string; cause: string };
