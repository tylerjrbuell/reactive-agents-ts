export type SimEvent =
  | { kind: "agent-moved"; tick: number; agentId: string; from: string; to: string }
  | { kind: "resource-gathered"; tick: number; agentId: string; resourceId: string; amount: number }
  | { kind: "hunted"; tick: number; agentId: string; animalId: string; amount: number }
  | { kind: "built"; tick: number; agentId: string; structureId: string }
  | { kind: "crafted"; tick: number; agentId: string; item: string }
  | { kind: "ate"; tick: number; agentId: string; food: string }
  | { kind: "drank"; tick: number; agentId: string; water: string }
  | { kind: "rested"; tick: number; agentId: string }
  | { kind: "traded"; tick: number; from: string; to: string; item: string }
  | { kind: "shared"; tick: number; from: string; to: string; item: string }
  | { kind: "talked"; tick: number; from: string; to: string; topic: string }
  | { kind: "inspected"; tick: number; agentId: string; target: string }
  | { kind: "action-failed"; tick: number; agentId: string; reason: string }
  | { kind: "weather"; tick: number; condition: string; tempC: number }
  | { kind: "needs-critical"; tick: number; agentId: string; need: string }
  | { kind: "agent-died"; tick: number; agentId: string; cause: string };
