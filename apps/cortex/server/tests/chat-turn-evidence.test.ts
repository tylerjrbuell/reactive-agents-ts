import { describe, expect, it } from "bun:test";
import { turnEvidenceOf } from "../services/chat-turn-evidence.js";

const obs = (success?: boolean) => ({ type: "observation", content: "result", ...(success === undefined ? {} : { metadata: { observationResult: { success } } }) });

describe("turnEvidenceOf", () => {
  it("counts successful tool observations only", () => {
    const e = turnEvidenceOf([{ type: "thought", content: "t" }, obs(true), obs(false), obs()], [], []);
    expect(e.toolResults).toBe(2); // success === false is not evidence
  });
  it("counts items newly completed on the checklist, not ones already done", () => {
    const before = [{ id: "a", title: "A", status: "completed" as const }, { id: "b", title: "B", status: "in_progress" as const }];
    const after = [{ id: "a", title: "A", status: "completed" as const }, { id: "b", title: "B", status: "completed" as const }, { id: "c", title: "C", status: "completed" as const }];
    expect(turnEvidenceOf(undefined, before, after)).toEqual({ toolResults: 0, checklistCompleted: 2 });
  });
  it("is zero with nothing to count", () => {
    expect(turnEvidenceOf(undefined, [], [])).toEqual({ toolResults: 0, checklistCompleted: 0 });
  });
});
