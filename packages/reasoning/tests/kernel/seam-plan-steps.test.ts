// Run: bun test packages/reasoning/tests/kernel/seam-plan-steps.test.ts --timeout 20000
//
// Plan/execute posture pair, pure seams (spec 2026-11-16-plan-execute-posture-robustness.md):
//   derivePlanSteps       — checklist items hidden in a plan reply (deterministic);
//   derivePlanChecklist   — the terminal step's pure core (ledger + outcome);
//   planToolCatalogLine   — the opt-in capped catalog line;
//   followPlanLine        — the execute-side advisory line for a seeded list.
//
// RED-ON-CUT: return [] from derivePlanSteps, drop the `harnessDerived` write in
// plan-checklist-step.ts, or return the line unconditionally in followPlanLine
// and the pins below fail.
import { describe, expect, it } from "bun:test";
import {
  FOLLOW_PLAN_GUIDANCE,
  MAX_CATALOG_TOOLS,
  MAX_DERIVED_STEPS,
  MAX_DERIVED_STEP_CHARS,
  derivePlanSteps,
  planToolCatalogLine,
} from "../../src/kernel/policy/plan-steps.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { derivePlanChecklist } from "../../src/kernel/loop/plan-checklist-step.js";
import { followPlanLine, applyFollowPlanGuidance } from "../../src/kernel/loop/iterate-follow-plan-seam.js";
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
  it("empty list + step lines: records ONE add batch tagged harnessDerived with ids 1..n", () => {
    const { state, outcome } = derivePlanChecklist(withOutput("1. fetch\n2. write"));
    expect(outcome).toEqual({ planSteps: 2, planSource: "harness-derived" });
    const facts = (state.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []));
    expect(facts.length).toBe(1);
    expect(facts[0]?.harnessDerived).toBe(true);
    expect(facts[0]?.origin).toBeUndefined();
    expect(facts[0]?.change).toEqual({ op: "add", items: [{ id: "1", title: "fetch" }, { id: "2", title: "write" }] });
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
