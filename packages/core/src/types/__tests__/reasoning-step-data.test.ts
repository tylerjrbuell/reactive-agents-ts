import { describe, test, expect } from "bun:test";
import { Schema } from "effect";
import { ReasoningStepDataSchema, type ReasoningStepData } from "../reasoning-step-data.js";
import type { AgentEvent } from "../agent-event.js";

type StepEvent = Extract<AgentEvent, { _tag: "ReasoningStepCompleted" }>;

const variants: ReadonlyArray<ReasoningStepData> = [
  { kind: "tot-node", nodeId: "n1", parentId: null, depth: 0, score: 0.7, pruned: false, selected: true, content: "idea" },
  { kind: "tot-node", nodeId: "n2", parentId: "n1", depth: 1, score: 0.2, pruned: true, selected: false, content: "bad" },
  { kind: "tot-path", nodeIds: ["n1", "n2"] },
  { kind: "code-action", code: "print(1)", stdout: "1", stderr: "", verify: { verdict: "pass", summary: "ok" } },
  { kind: "code-action", code: "x" },
  { kind: "reflexion", critique: "missed edge case", accepted: false },
];

describe("ReasoningStepData", () => {
  test("old event without structured still type-checks and has no field", () => {
    const old: StepEvent = { _tag: "ReasoningStepCompleted", taskId: "t", strategy: "reactive", step: 1, totalSteps: 1 };
    expect(old.structured).toBeUndefined();
  });

  test("each variant round-trips through the schema and the event", () => {
    for (const v of variants) {
      const decoded = Schema.decodeUnknownSync(ReasoningStepDataSchema)(JSON.parse(JSON.stringify(v)));
      expect(decoded).toEqual(v);
      const ev: StepEvent = { _tag: "ReasoningStepCompleted", taskId: "t", strategy: "s", step: 1, totalSteps: 1, structured: v };
      expect(ev.structured).toEqual(v);
    }
  });

  test("unknown kind is rejected by the schema", () => {
    expect(() => Schema.decodeUnknownSync(ReasoningStepDataSchema)({ kind: "nope" })).toThrow();
  });

  test("kind switch is exhaustive", () => {
    const label = (d: ReasoningStepData): string => {
      switch (d.kind) {
        case "tot-node": return "node";
        case "tot-path": return "path";
        case "code-action": return "code";
        case "reflexion": return "reflect";
        default: {
          const _never: never = d;
          return _never;
        }
      }
    };
    expect(variants.map(label)).toEqual(["node", "node", "path", "code", "code", "reflect"]);
  });
});
