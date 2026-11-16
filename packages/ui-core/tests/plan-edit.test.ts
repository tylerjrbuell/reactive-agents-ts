import { describe, expect, test } from "bun:test";
import {
  addStep,
  moveStep,
  nextStepId,
  planEdited,
  planProgressLine,
  removeStep,
  setStepTitle,
  setStepTool,
  stepStatusLabel,
  type PlanDraftStep,
} from "../src/index.js";

const s = (id: string, title: string, over: Partial<PlanDraftStep> = {}): PlanDraftStep => ({ id, title, status: "pending", ...over });
const abc = [s("1", "a"), s("2", "b"), s("3", "c")];

describe("plan editing rules", () => {
  test("addStep appends a pending step with a fresh id; blank adds nothing", () => {
    const next = addStep(abc, "  d  ", " file-write ");
    expect(next.at(-1)).toEqual({ id: "step-4", title: "d", status: "pending", tool: "file-write" });
    expect(addStep(abc, "   ")).toBe(abc);
  });

  test("nextStepId never reuses an id, even after a removal", () => {
    const steps = [s("1", "a"), s("step-3", "x")];
    expect(nextStepId(steps)).toBe("step-4");
    expect(nextStepId(removeStep(steps, "1"))).toBe("step-2");
  });

  test("removeStep drops one step", () => {
    expect(removeStep(abc, "2").map((x) => x.id)).toEqual(["1", "3"]);
  });

  test("moveStep reorders, clamps at the ends and ignores an unknown id", () => {
    expect(moveStep(abc, "3", -1).map((x) => x.id)).toEqual(["1", "3", "2"]);
    expect(moveStep(abc, "1", 1).map((x) => x.id)).toEqual(["2", "1", "3"]);
    expect(moveStep(abc, "1", -1)).toBe(abc);
    expect(moveStep(abc, "3", 5)).toBe(abc);
    expect(moveStep(abc, "9", 1)).toBe(abc);
  });

  test("setStepTitle rewords; an empty title keeps the old one", () => {
    expect(setStepTitle(abc, "2", " bee ").map((x) => x.title)).toEqual(["a", "bee", "c"]);
    expect(setStepTitle(abc, "2", "  ")).toBe(abc);
  });

  test("setStepTool sets and clears the hint", () => {
    const withTool = setStepTool(abc, "1", " web-search ");
    expect(withTool[0]?.tool).toBe("web-search");
    expect("tool" in (setStepTool(withTool, "1", "")[0] as object)).toBe(false);
  });

  test("planEdited notices order, title, tool, status and length changes", () => {
    expect(planEdited(abc, [...abc])).toBe(false);
    expect(planEdited(abc, moveStep(abc, "3", -1))).toBe(true);
    expect(planEdited(abc, setStepTitle(abc, "1", "z"))).toBe(true);
    expect(planEdited(abc, setStepTool(abc, "1", "t"))).toBe(true);
    expect(planEdited(abc, removeStep(abc, "1"))).toBe(true);
    expect(planEdited(abc, abc.map((x, i) => (i === 0 ? { ...x, status: "done" as const } : x)))).toBe(true);
  });

  test("progress line counts done and skipped; status words", () => {
    expect(planProgressLine([])).toBe("No steps yet");
    expect(planProgressLine([s("1", "a", { status: "done" }), s("2", "b", { status: "skipped" }), s("3", "c")])).toBe("2 of 3 done");
    expect(stepStatusLabel("in-progress")).toBe("in progress");
  });
});
