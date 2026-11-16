// Run: bun test packages/reasoning/tests/kernel/seam-plan-steps.test.ts --timeout 20000
//
// Plan/execute posture pair, pure seams (spec 2026-11-16-plan-execute-posture-robustness.md):
//   derivePlanSteps       — checklist items hidden in a plan reply (deterministic);
//   derivePlanChecklist   — the terminal step's pure core (ledger + outcome);
//   planToolCatalogLine   — the opt-in capped catalog line;
//   followPlanLine        — the execute-side advisory line for a seeded list.
//
//   planStepTool / proposeDoneLine — tool hints and the propose-done advisory;
//   frameGoalForPosture   — plan-only goal framing.
//
// RED-ON-CUT: return [] from derivePlanSteps, drop the `origin: "harness-derived"`
// write or the tool hint in plan-checklist-step.ts, return the line unconditionally
// in followPlanLine/proposeDoneLine, or drop the plan branch of frameGoalForPosture
// and the pins below fail.
import { describe, expect, it } from "bun:test";
import {
  FOLLOW_PLAN_GUIDANCE,
  MAX_CATALOG_TOOLS,
  MAX_DERIVED_STEPS,
  MAX_DERIVED_STEP_CHARS,
  derivePlanSteps,
  planStepTool,
  planToolCatalogLine,
} from "../../src/kernel/policy/plan-steps.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { derivePlanChecklist } from "../../src/kernel/loop/plan-checklist-step.js";
import { followPlanLine, applyFollowPlanGuidance, proposeDoneLine } from "../../src/kernel/loop/iterate-follow-plan-seam.js";
import { frameGoalForPosture, PLAN_TASK_FRAME } from "../../src/kernel/policy/plan-task-frame.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { seedInitialAdvisory } from "../../src/kernel/state/checklist-seed.js";
import { recordChecklistItems } from "../../src/kernel/ledger/emit.js";
import { initialKernelState, transitionState, type KernelInput, type KernelState } from "../../src/kernel/state/kernel-state.js";

const fresh = (): KernelState => initialKernelState({ maxIterations: 4, strategy: "reactive", kernelType: "react" });
const withOutput = (output: string): KernelState => transitionState(fresh(), { output });

describe("derivePlanSteps", () => {
  it("numbered lines become steps; markers, emphasis and trailing punctuation are stripped; prose ignored", () => {
    const reply = [
      "Here is my plan for the task.",
      "1. **Fetch** the BTC price with `crypto-price`;",
      "2) Write it to prices.txt (tool: file-write).",
      "   3: Summarize the result",
      "That should cover it.",
    ].join("\n");
    expect(derivePlanSteps(reply)).toEqual([
      "Fetch the BTC price with crypto-price",
      "Write it to prices.txt (tool: file-write)",
      "Summarize the result",
    ]);
  });

  it("bulleted lines are used when nothing is numbered; numbered wins over nested bullets", () => {
    expect(derivePlanSteps("Plan:\n- read the file\n* count the rows\n• report")).toEqual([
      "read the file",
      "count the rows",
      "report",
    ]);
    expect(derivePlanSteps("1. read the file\n   - open it\n   - parse it\n2. report")).toEqual(["read the file", "report"]);
  });

  it("an inline `1) a 2) b` run is split when no line structure exists; trailing prose is not a step", () => {
    expect(derivePlanSteps("Plan: 1) fetch the price 2) write it to a file. Say go to start.")).toEqual([
      "fetch the price",
      "write it to a file",
    ]);
    // A lone inline marker is not a plan.
    expect(derivePlanSteps("I found 1) one thing worth noting.")).toEqual([]);
  });

  it("prose only, empty and whitespace replies derive nothing", () => {
    expect(derivePlanSteps("I will think about it and get back to you.")).toEqual([]);
    expect(derivePlanSteps("")).toEqual([]);
    expect(derivePlanSteps("  \n \n")).toEqual([]);
  });

  it("caps count and title length, and drops duplicates", () => {
    const many = Array.from({ length: 30 }, (_, i) => `${i + 1}. step number ${i + 1}`).join("\n");
    expect(derivePlanSteps(many).length).toBe(MAX_DERIVED_STEPS);
    const long = derivePlanSteps(`1. ${"x".repeat(500)}`);
    expect(long[0]?.length).toBe(MAX_DERIVED_STEP_CHARS);
    expect(long[0]?.endsWith("…")).toBe(true);
    expect(derivePlanSteps("1. same\n2. same\n3. other")).toEqual(["same", "other"]);
  });
});

describe("derivePlanChecklist (terminal step core)", () => {
  it("empty list + step lines: records ONE add batch with origin harness-derived and ids 1..n", () => {
    const { state, outcome } = derivePlanChecklist(withOutput("1. fetch\n2. write"));
    expect(outcome).toEqual({ planSteps: 2, planSource: "harness-derived" });
    const facts = (state.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []));
    expect(facts.length).toBe(1);
    expect(facts[0]?.origin).toBe("harness-derived");
    expect(facts[0]?.change).toEqual({ op: "add", items: [{ id: "1", title: "fetch" }, { id: "2", title: "write" }] });
  });

  it("a step naming `tool: x` carries x as the add-op tool hint; unnamed steps carry none", () => {
    const { state } = derivePlanChecklist(withOutput("1. Fetch the price (tool: crypto-price)\n2. Summarize it\n3. Save it, tool: file-write."));
    const fact = (state.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []))[0];
    expect(fact?.change).toEqual({
      op: "add",
      items: [
        { id: "1", title: "Fetch the price (tool: crypto-price)", tool: "crypto-price" },
        { id: "2", title: "Summarize it" },
        { id: "3", title: "Save it, tool: file-write", tool: "file-write" },
      ],
    });
  });

  it("a list the model already recorded is left untouched (same state identity), nothing derived", () => {
    const recorded = transitionState(withOutput("1. other\n2. steps"), {
      ledger: recordChecklistItems(undefined, [{ iteration: 0, change: { op: "add", items: [{ id: "1", title: "mine" }] } }]),
    });
    const { state, outcome } = derivePlanChecklist(recorded);
    expect(state).toBe(recorded);
    expect(outcome).toEqual({ planSteps: 1, planSource: "recorded" });
  });

  it("nothing derivable: no ledger write, explicit plan-no-steps outcome", () => {
    const s = withOutput("Let me think about that.");
    const { state, outcome } = derivePlanChecklist(s);
    expect(state).toBe(s);
    expect(outcome).toEqual({ planSteps: 0, planNoSteps: true });
    expect(derivePlanChecklist(fresh()).outcome).toEqual({ planSteps: 0, planNoSteps: true });
  });
});

describe("planToolCatalogLine", () => {
  const tool = (name: string, description: string) => ({ name, description });
  it("one capped line: names + first sentence, planning/meta tools left out, `tool: name` instruction", () => {
    const line = planToolCatalogLine([
      tool("web-search", "Search the web. Returns ranked results."),
      tool("file-write", "Write a file"),
      tool("todo", "checklist"),
      tool("final-answer", "done"),
    ]);
    expect(line).toBe(
      "Execute-phase tools: web-search (Search the web.); file-write (Write a file). You cannot call these now; reference them in steps as `tool: name`.",
    );
    expect(line).not.toContain("\n");
  });

  it("caps the tool count with a remainder note; nothing to list is undefined", () => {
    const many = Array.from({ length: MAX_CATALOG_TOOLS + 5 }, (_, i) => tool(`tool-${i}`, "d"));
    const line = planToolCatalogLine(many)!;
    expect(line).toContain(`tool-${MAX_CATALOG_TOOLS - 1} (d)`);
    expect(line).not.toContain(`tool-${MAX_CATALOG_TOOLS} (d)`);
    expect(line).toContain("; and 5 more.");
    expect(planToolCatalogLine([])).toBeUndefined();
    expect(planToolCatalogLine(undefined)).toBeUndefined();
    expect(planToolCatalogLine([tool("todo", "x")])).toBeUndefined();
  });
});

describe("planToolCatalog harness switch", () => {
  it("default OFF (key absent); on through config; the resolved value is what think.ts reads", () => {
    expect("planToolCatalog" in resolveHarnessConfig()).toBe(false);
    expect(resolveHarnessConfig({ planToolCatalog: true }).planToolCatalog).toBe(true);
    expect("planToolCatalog" in resolveHarnessConfig({ planToolCatalog: false })).toBe(false);
  });
});

describe("followPlanLine (execute, seeded checklist)", () => {
  const input = (over: Partial<KernelInput> = {}): KernelInput => ({ task: "t", ...over }) as KernelInput;
  const seeded = (statuses: readonly ("pending" | "in_progress" | "completed")[]) => {
    const seed = statuses.map((status, i) => ({ id: String(i + 1), title: `step ${i + 1}`, status }));
    const ledger = recordChecklistItems(undefined, [
      { iteration: 0, change: { op: "add", items: seed.map(({ id, title }) => ({ id, title })) } },
      ...seed.flatMap((s) => (s.status === "pending" ? [] : [{ iteration: 0, change: { op: "status" as const, id: s.id, status: s.status } }])),
    ]);
    return { state: transitionState(fresh(), { ledger }), input: input({ initialAdvisory: seed }) };
  };

  it("an unchecked seeded step yields exactly the follow-the-plan line", () => {
    const s = seeded(["completed", "pending"]);
    expect(followPlanLine(s.state, s.input)).toBe(FOLLOW_PLAN_GUIDANCE);
    expect(FOLLOW_PLAN_GUIDANCE).toBe(
      "Follow the plan checklist: work the next unchecked step, mark it done with todo when finished, and revise the list with todo if reality differs from the plan.",
    );
    const applied = applyFollowPlanGuidance(s.state, s.input);
    expect(applied.pendingGuidance?.icsGuidance).toBe(FOLLOW_PLAN_GUIDANCE);
    // Idempotent within a turn: never doubled.
    expect(applyFollowPlanGuidance(applied, s.input)).toBe(applied);
  });

  it("an all-done seed, an empty seed, no seed, and plan posture produce nothing (state identity)", () => {
    const done = seeded(["completed", "completed"]);
    expect(applyFollowPlanGuidance(done.state, done.input)).toBe(done.state);
    const none = fresh();
    expect(applyFollowPlanGuidance(none, input())).toBe(none);
    expect(applyFollowPlanGuidance(none, input({ initialAdvisory: [] }))).toBe(none);
    const planning = seeded(["pending"]);
    expect(followPlanLine(planning.state, { ...planning.input, posture: "plan" })).toBeUndefined();
  });

  it("a list the model built itself (no seed) never triggers the line", () => {
    const own = transitionState(fresh(), {
      ledger: recordChecklistItems(undefined, [{ iteration: 0, change: { op: "add", items: [{ id: "1", title: "mine" }] } }]),
    });
    expect(followPlanLine(own, input())).toBeUndefined();
  });
});

describe("planStepTool", () => {
  it("reads `tool: name` / `(tool: name)` / backticked names; trailing punctuation is not part of the name; none = undefined", () => {
    expect(planStepTool("Fetch it (tool: crypto-price)")).toBe("crypto-price");
    expect(planStepTool("Save it, tool: file-write.")).toBe("file-write");
    expect(planStepTool("Run it with Tool: `code-execute`")).toBe("code-execute");
    expect(planStepTool("Summarize the result")).toBeUndefined();
    expect(planStepTool("the tool: ")).toBeUndefined();
  });
});

describe("proposeDoneLine (execute, seeded hinted step)", () => {
  const input = (over: Partial<KernelInput> = {}): KernelInput => ({ task: "t", ...over }) as KernelInput;
  const seed = [
    { id: "1", title: "Fetch the price", status: "pending" as const, tool: "crypto-price" },
    { id: "2", title: "Summarize", status: "pending" as const },
  ];
  const obs = (toolName: string, success: boolean) => ({
    id: `s-${toolName}-${success}` as KernelState["steps"][number]["id"],
    type: "observation" as const,
    content: "r",
    timestamp: new Date(0),
    metadata: { observationResult: makeObservationResult(toolName, success, "r") },
  });
  const seededState = (): KernelState => seedInitialAdvisory(fresh(), { initialAdvisory: seed });
  const withSteps = (s: KernelState, steps: KernelState["steps"]): KernelState => transitionState(s, { steps });

  it("seeding carries the tool hint onto the ledger row", () => {
    const add = (seededState().ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []))[0];
    expect(add?.change).toEqual({
      op: "add",
      items: [{ id: "1", title: "Fetch the price", tool: "crypto-price" }, { id: "2", title: "Summarize" }],
    });
  });

  it("the named tool succeeding this pass proposes done for that step: ONE line, advisory, idempotent", () => {
    const s = withSteps(seededState(), [obs("crypto-price", true)]);
    const line = proposeDoneLine(s, input({ initialAdvisory: seed }), 0);
    expect(line).toBe('Step 1 ("Fetch the price") named tool crypto-price, which just succeeded: if the step is complete, mark it done with todo.');
    const applied = applyFollowPlanGuidance(s, input({ initialAdvisory: seed }), 0);
    expect(applied.pendingGuidance?.icsGuidance).toContain(line!);
    expect(applied.pendingGuidance?.icsGuidance).toContain(FOLLOW_PLAN_GUIDANCE);
    expect(applyFollowPlanGuidance(applied, input({ initialAdvisory: seed }), 0)).toBe(applied);
  });

  it("nothing proposed: failed call, other tool, call before this pass, no hint, done step, no seed, plan posture", () => {
    const i = input({ initialAdvisory: seed });
    expect(proposeDoneLine(withSteps(seededState(), [obs("crypto-price", false)]), i, 0)).toBeUndefined();
    expect(proposeDoneLine(withSteps(seededState(), [obs("file-write", true)]), i, 0)).toBeUndefined();
    expect(proposeDoneLine(withSteps(seededState(), [obs("crypto-price", true)]), i, 1)).toBeUndefined();
    const done = transitionState(withSteps(seededState(), [obs("crypto-price", true)]), {
      ledger: recordChecklistItems(seededState().ledger, [{ iteration: 0, change: { op: "status", id: "1", status: "completed" } }]),
    });
    expect(proposeDoneLine(done, i, 0)).toBeUndefined();
    expect(proposeDoneLine(withSteps(seededState(), [obs("crypto-price", true)]), input(), 0)).toBeUndefined();
    expect(proposeDoneLine(withSteps(seededState(), [obs("crypto-price", true)]), { ...i, posture: "plan" }, 0)).toBeUndefined();
  });

  it("a seed with no hints leaves guidance byte-identical to follow-the-plan alone", () => {
    const plain = [{ id: "1", title: "a", status: "pending" as const }];
    const s = withSteps(seedInitialAdvisory(fresh(), { initialAdvisory: plain }), [obs("crypto-price", true)]);
    expect(applyFollowPlanGuidance(s, input({ initialAdvisory: plain }), 0).pendingGuidance?.icsGuidance).toBe(FOLLOW_PLAN_GUIDANCE);
  });
});

describe("frameGoalForPosture", () => {
  it("plan frames the goal once (string and parts); execute/absent return the same value", () => {
    expect(PLAN_TASK_FRAME).toBe("Plan how to accomplish this; do not carry it out: ");
    expect(frameGoalForPosture("fetch BTC", "plan")).toBe(`${PLAN_TASK_FRAME}fetch BTC`);
    expect(frameGoalForPosture(frameGoalForPosture("fetch BTC", "plan"), "plan")).toBe(`${PLAN_TASK_FRAME}fetch BTC`);
    const parts = [{ type: "text" as const, text: "look" }];
    const framed = frameGoalForPosture(parts, "plan");
    expect(framed).toEqual([{ type: "text", text: PLAN_TASK_FRAME }, ...parts]);
    expect(frameGoalForPosture(framed, "plan")).toBe(framed);
    expect(frameGoalForPosture("fetch BTC", "execute")).toBe("fetch BTC");
    expect(frameGoalForPosture(parts, undefined)).toBe(parts);
  });
});
