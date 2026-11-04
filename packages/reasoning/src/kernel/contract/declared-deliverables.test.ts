// Run: bun test packages/reasoning/src/kernel/contract/declared-deliverables.test.ts
//
// Per-item deliverables (Plan 8 L7 / G2) — unit pins.
//   §1 explicit-member extraction: ONLY literally named files become items
//      (no count inference, no template expansion, no range fill).
//   §2 the addDeclaredDeliverables seam lands the SAME requirement shape and
//      the SAME gate verdict as a task-explicit item.
//   §3 deliveryConditions widens the stored spine set with every per-item
//      condition, and is byte-identical when there is nothing to add.
//   §4 plan-declared: the run's own todo `add` titles -> output-file items
//      (task-text deriver; inputs/placeholders dropped; plan posture declares none).
//
// RED-ON-CUT: drop `source` from declaredItem's spec (§1/§2 go red); make
// deliveryConditions return `meta.postConditions` unchanged (§2 gate + §3 red).

import { describe, expect, it } from "bun:test";
import {
  addDeclaredDeliverables,
  compileRunContract,
  type RunContract,
} from "./run-contract.js";
import { deliveryConditions, perItemConditions } from "./declared-deliverables.js";
import { declarePlanOutputs, planDeclaredOutputs } from "./plan-declared.js";
import {
  artifactProduced,
  toolCalled,
  verify,
} from "../capabilities/verify/post-conditions.js";
import { deriveConditions } from "../capabilities/verify/derive-conditions.js";
import type { RunLedger } from "../ledger/run-ledger.js";

const artifactIds = (c: RunContract): string[] =>
  c.requirements.filter((r) => r.kind === "artifact-produced").map((r) => r.id);

// verbatim from packages/benchmarks/src/h3/tasks.ts (h3-todo-heavy)
const H3_TODO_HEAVY = `Six files in your working directory, notes-1.txt through notes-6.txt, each contain one integer. Track the work as a todo list with one item per file. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish all six.`;
// The same shape with no literal instances: the task never binds N.
const UNBOUND_TEMPLATE = `Some files in your working directory each contain one integer. Track the work as a todo list with one item per file. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish them all.`;

describe("§1 explicit-member extraction (source: task-explicit)", () => {
  it.each([
    ["Write a.txt, b.txt and c.txt.", ["./a.txt", "./b.txt", "./c.txt"]],
    ["Create three files: alpha.md, beta.md, gamma.md.", ["./alpha.md", "./beta.md", "./gamma.md"]],
    [
      "Produce these files in your working directory:\n1. low-stock.txt: skus\n2. totals.json: sums\n3. summary.md: a note",
      ["./low-stock.txt", "./totals.json", "./summary.md"],
    ],
    ["For each input, write out-1.txt, out-2.txt and out-3.txt.", ["./out-1.txt", "./out-2.txt", "./out-3.txt"]],
    // A template whose variable the task binds (notes-1..6 + notes-N.txt) names
    // its members by substitution: one item per member (2026-11-04).
    [H3_TODO_HEAVY, [1, 2, 3, 4, 5, 6].map((n) => `./out-${n}.txt`)],
  ])("every named file is one item: %s", (task, paths) => {
    const c = compileRunContract(task);
    expect(artifactIds(c)).toEqual(paths.map((p) => `artifact:${p}`));
    for (const r of c.requirements.filter((x) => x.kind === "artifact-produced")) {
      expect(r.spec.source).toBe("task-explicit");
    }
    for (const d of c.deliverables) expect(d.source).toBe("task-explicit");
  });

  it.each([
    // Template only, variable unbound: members are not named, so nothing expands (source 2's job).
    [UNBOUND_TEMPLATE, []],
    // No count inference.
    ["Summarize every file in the repo and finish all six.", []],
    // No range fill: only the two literally named endpoints.
    ["Write out-1.txt through out-6.txt.", ["./out-1.txt", "./out-6.txt"]],
    // Named INPUTS are never items.
    ["Read a.txt and b.txt, then write the merged result to c.txt.", ["./c.txt"]],
  ])("no inferred items: %s", (task, paths) => {
    expect(artifactIds(compileRunContract(task))).toEqual(paths.map((p) => `artifact:${p}`));
  });

  it("non-item requirements carry no source (tool coverage, answer floor)", () => {
    const c = compileRunContract("Write a.txt.", { requiredTools: ["file-write"] });
    expect(c.requirements.find((r) => r.id === "tool:file-write")?.spec.source).toBeUndefined();
    expect(c.requirements.find((r) => r.id === "answer")?.spec.source).toBeUndefined();
  });
});

/** Two of the three files landed (run-scoped ledger artifact entries). */
const twoOfThree = [
  { kind: "artifact", seq: 0, iteration: 1, op: "write", path: "./a.txt", toolCallId: "t1" },
  { kind: "artifact", seq: 1, iteration: 2, op: "write", path: "./b.txt", toolCallId: "t2" },
] satisfies RunLedger;

/** The gate verdict a run on `task` gets: stored set seeded as runner.ts does. */
const unmetPaths = (task: string, contract: RunContract): string[] => {
  const conditions = deliveryConditions({ postConditions: deriveConditions(task, []), runContract: contract }) ?? [];
  return verify(conditions, [], { ledger: twoOfThree }).unmet.flatMap((c) =>
    c.kind === "ArtifactProduced" ? [c.path] : [],
  );
};

describe("§2 addDeclaredDeliverables — same shape, same gate as task-explicit", () => {
  const EXPLICIT = "Write a.txt, b.txt and c.txt.";
  const BARE = "Do the work.";
  const explicit = compileRunContract(EXPLICIT);
  const files = [
    { kind: "file", path: "a.txt" },
    { kind: "file", path: "./b.txt" },
    { kind: "file", path: "c.txt" },
  ] as const;

  it.each(["plan-declared", "caller-accept"] as const)("%s items compile like task-explicit items", (source) => {
    const declared = addDeclaredDeliverables(compileRunContract(BARE), files, source);
    const shape = (c: RunContract) =>
      c.requirements
        .filter((r) => r.kind === "artifact-produced")
        .map((r) => ({ id: r.id, kind: r.kind, condition: r.spec.condition, acceptance: r.spec.acceptance, description: r.spec.description }));
    expect(shape(declared)).toEqual(shape(explicit));
    expect(declared.deliverables.map((d) => ({ id: d.id, kind: d.kind, matcher: d.matcher }))).toEqual(
      explicit.deliverables.map((d) => ({ id: d.id, kind: d.kind, matcher: d.matcher })),
    );
    expect(declared.requirements.filter((r) => r.kind === "artifact-produced").every((r) => r.spec.source === source)).toBe(true);
    expect(declared.deliverables.every((d) => d.source === source)).toBe(true);
    // Same gate verdict on the same evidence: the missing item, by name.
    expect(unmetPaths(BARE, declared)).toEqual(["./c.txt"]);
    expect(unmetPaths(EXPLICIT, explicit)).toEqual(["./c.txt"]);
    expect(Object.isFrozen(declared)).toBe(true);
  });

  it("tool items land as tool-coverage (the tool must succeed)", () => {
    const c = addDeclaredDeliverables(compileRunContract("Do the work."), [{ kind: "tool", tool: "git-cli" }], "caller-accept");
    const r = c.requirements.find((x) => x.id === "tool:git-cli");
    expect(r?.kind).toBe("tool-coverage");
    expect(r?.spec.source).toBe("caller-accept");
    expect(c.postConditions).toContainEqual(toolCalled("git-cli"));
    expect(perItemConditions(c)).toEqual([toolCalled("git-cli")]);
  });

  it("first declarer wins: an id already on the contract is not re-added", () => {
    const c = addDeclaredDeliverables(explicit, [{ kind: "file", path: "a.txt" }], "plan-declared");
    expect(c.requirements.filter((r) => r.id === "artifact:./a.txt")).toHaveLength(1);
    expect(c.requirements.find((r) => r.id === "artifact:./a.txt")?.spec.source).toBe("task-explicit");
    expect(c.deliverables).toHaveLength(explicit.deliverables.length);
  });
});

describe("§3 deliveryConditions — the one widened set both terminal gates read", () => {
  it("adds the per-item conditions the single-path stored set misses", () => {
    const runContract = compileRunContract("Write a.txt, b.txt and c.txt.");
    const stored = [artifactProduced("./a.txt"), toolCalled("file-write")];
    expect(deliveryConditions({ postConditions: stored, runContract })).toEqual([
      ...stored,
      artifactProduced("./b.txt"),
      artifactProduced("./c.txt"),
    ]);
  });

  it("task-explicit items add no file gating where the stored set gates none (plan-execute step shape)", () => {
    // A step kernel's text carries the whole goal; the multi-path contract holds
    // ./report.md but the run-start deriver gated no file for the step.
    const runContract = compileRunContract("Research the topic thoroughly and write your findings to report.md.");
    expect(deliveryConditions({ runContract })).toBeUndefined();
    const stored = [toolCalled("gather")];
    expect(deliveryConditions({ postConditions: stored, runContract })).toBe(stored);
    // ...while an item declared FOR the run always widens it.
    const declared = addDeclaredDeliverables(runContract, [{ kind: "file", path: "notes.md" }], "plan-declared");
    expect(deliveryConditions({ postConditions: stored, runContract: declared })).toEqual([
      ...stored,
      artifactProduced("./notes.md"),
    ]);
  });

  it("is the stored set itself (same reference) when the contract adds nothing", () => {
    const stored = [toolCalled("web-search")];
    const runContract = compileRunContract("Find the population of France.", { requiredTools: ["web-search"] });
    expect(deliveryConditions({ postConditions: stored, runContract })).toBe(stored);
    expect(deliveryConditions({ runContract })).toBeUndefined();
    expect(deliveryConditions({})).toBeUndefined();
  });
});

describe("§4 plan-declared — the run's own todo items name its output files", () => {
  const add = (...titles: string[]) =>
    [{ op: "add" as const, items: titles.map((title, i) => ({ id: String(i + 1), title })) }];

  it.each([
    ["Read notes-1.txt and write out-1.txt", ["./out-1.txt"]],
    ["Write ./report.md", ["./report.md"]],
    ["Process notes-2.txt", []],
    ["out-3.txt: double notes-3", []],
    ["Summarize the findings", []],
    ["Write out-N.txt for each notes-N.txt file", []],
  ])("%s -> %j", (title, expected) => {
    expect(planDeclaredOutputs(add(title))).toEqual(expected.map((path) => ({ kind: "file", path })));
  });

  it("status ops declare nothing; duplicate paths collapse", () => {
    expect(planDeclaredOutputs([{ op: "status", id: "1", status: "completed" }])).toEqual([]);
    expect(planDeclaredOutputs(add("Write out-1.txt", "Then write ./out-1.txt again"))).toEqual([
      { kind: "file", path: "./out-1.txt" },
    ]);
  });

  it("declarePlanOutputs lands plan-declared file requirements through the seam", () => {
    const contract = compileRunContract(UNBOUND_TEMPLATE);
    expect(artifactIds(contract)).toEqual([]);
    const widened = declarePlanOutputs(contract, add("Read notes-1.txt and write out-1.txt", "Write out-2.txt"), undefined);
    expect(widened?.requirements.filter((r) => r.spec.source === "plan-declared").map((r) => r.id)).toEqual([
      "artifact:./out-1.txt",
      "artifact:./out-2.txt",
    ]);
    expect(deliveryConditions({ runContract: widened })).toEqual([
      artifactProduced("./out-1.txt"),
      artifactProduced("./out-2.txt"),
    ]);
  });

  it("returns the SAME contract when nothing new is declared, there is no contract, or posture is plan", () => {
    const contract = compileRunContract(UNBOUND_TEMPLATE);
    expect(declarePlanOutputs(contract, add("Summarize the findings"), undefined)).toBe(contract);
    expect(declarePlanOutputs(contract, add("Write out-1.txt"), "plan")).toBe(contract);
    expect(declarePlanOutputs(undefined, add("Write out-1.txt"), undefined)).toBeUndefined();
    const once = declarePlanOutputs(contract, add("Write out-1.txt"), undefined);
    expect(declarePlanOutputs(once, add("Write out-1.txt"), undefined)).toBe(once);
  });
});
