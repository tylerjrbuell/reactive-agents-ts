// Run: bun test packages/reasoning/src/kernel/ledger/answer-requirement.test.ts --timeout 15000
//
// The `answer` floor requirement is declared on every run but assess() cannot
// verify it, so its only satisfaction writer is the terminal verdict: an ACCEPTED
// final answer records it satisfied; a run that ends without one leaves it
// declared. The checklist (a ledger projection) must never say done when the gate
// disagrees. CUT: the answer arm in recordTerminalVerdict (emit.ts) turns the
// satisfied expectations red.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { projectChecklist, type ChecklistFact } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { reactKernel } from "../loop/react-kernel.js";
import { runPass } from "../loop/run-pass.js";
import type { KernelInput } from "../state/kernel-state.js";
import { resolveCompletionStatus } from "../state/completion-status.js";
import { compileRunContract } from "../contract/run-contract.js";
import { assess } from "../assessment/assess.js";
import { entriesOfKind, type RunLedger } from "./run-ledger.js";
import { mergePassLedger } from "./run-scope.js";
import { recordRequirementsDeclared, recordRequirementTransitions, recordTerminalVerdict } from "./emit.js";

const statuses = (ledger: RunLedger | undefined, id: string) =>
  entriesOfKind(ledger, "requirement").filter((e) => e.requirementId === id).map((e) => e.status);

const rowStatuses = (ledger: RunLedger | undefined) => {
  const facts: ChecklistFact[] = [...entriesOfKind(ledger, "requirement"), ...entriesOfKind(ledger, "checklist-item")];
  return projectChecklist(facts).root.rows.filter((r) => r.kind === "requirement").map((r) => [r.id, r.status]);
};

const declared = (): RunLedger => recordRequirementsDeclared(undefined, [{ id: "answer", description: "answer", kind: "question-answered" }], 0);

describe("recordTerminalVerdict — answer floor", () => {
  it("accepted final answer records `answer` satisfied", () => {
    const l = recordTerminalVerdict(declared(), { verified: true, terminatedBy: "final_answer", iteration: 1 });
    expect(statuses(l, "answer")).toEqual(["declared", "satisfied"]);
  });
  it("failure verdict, abstention, and contractless ledgers do not satisfy it", () => {
    expect(statuses(recordTerminalVerdict(declared(), { verified: false, terminatedBy: "max_iterations", iteration: 1 }), "answer")).toEqual(["declared"]);
    expect(statuses(recordTerminalVerdict(declared(), { verified: true, terminatedBy: "abstained", iteration: 1 }), "answer")).toEqual(["declared"]);
    expect(statuses(recordTerminalVerdict(undefined, { verified: true, terminatedBy: "final_answer", iteration: 1 }), "answer")).toEqual([]);
  });
  it("is idempotent", () => {
    const once = recordTerminalVerdict(declared(), { verified: true, terminatedBy: "final_answer", iteration: 1 });
    expect(statuses(recordTerminalVerdict(once, { verified: true, terminatedBy: "final_answer", iteration: 2 }), "answer")).toEqual(["declared", "satisfied"]);
  });
});

describe("recordTerminalVerdict — absorbed sub-agent passes", () => {
  it("pass-tagged child `answer` facts do not shadow the root's own answer requirement", () => {
    const childRun = recordTerminalVerdict(declared(), { verified: true, terminatedBy: "final_answer", iteration: 2 });
    const root = mergePassLedger(declared(), childRun, "sub-agent:alpha");
    const l = recordTerminalVerdict(root, { verified: true, terminatedBy: "final_answer", iteration: 3 });
    const rootStatuses = entriesOfKind(l, "requirement").filter((e) => e.pass === undefined).map((e) => e.status);
    expect(rootStatuses).toEqual(["declared", "satisfied"]);
  });
});

describe("monotonicity — assess() never regresses a satisfied requirement", () => {
  it("once `answer` is satisfied on the ledger, later assess keeps it satisfied; only `blocked` retracts the projection", () => {
    const contract = compileRunContract("What is 17*23?", {});
    let ledger = recordRequirementsDeclared(undefined, contract.requirements.map((r) => ({ id: r.id, description: r.spec.description, kind: r.kind })), 0);
    ledger = recordTerminalVerdict(ledger, { verified: true, terminatedBy: "final_answer", iteration: 1 });
    const budget = { iteration: 2, maxIterations: 5, tokensUsed: 0, costUsd: 0 };
    const a = assess(contract, ledger, budget);
    expect(a.requirements.satisfied).toContain("answer");
    expect(a.requirements.outstanding).not.toContain("answer");
    // blocked is the only regression and is recorded (latest-wins projection retracts).
    const blocked = recordRequirementTransitions(ledger, [], ["answer"], 3);
    expect(rowStatuses(blocked)).toEqual([["answer", "blocked"]]);
  });
});

const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: { finding: "KEY FACT" } }),
  getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [{ name: "q", type: "string", required: true }] }),
});
const SCHEMAS = [{ name: "alpha", description: "a", parameters: [{ name: "q", type: "string", required: true }] }];
const runWith = (turns: Parameters<typeof TestLLMServiceLayer>[0], maxIterations: number) =>
  Effect.runPromise(
    runPass(reactKernel, { task: "What is 17*23?", availableToolSchemas: SCHEMAS } as KernelInput, {
      maxIterations, strategy: "reactive", kernelType: "react", taskId: "answer-requirement", modelId: "llama3.2:3b",
    }).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer(turns), toolLayer))),
  );

describe("kernel run -> checklist projection", () => {
  it("plain-chat turn with an accepted answer shows requirements done", async () => {
    const pass = await runWith([{ text: "17*23 = 391" }], 4);
    expect(pass.state.status).toBe("done");
    expect(statuses(pass.state.ledger, "answer")).toContain("satisfied");
    const rows = rowStatuses(pass.state.ledger);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(([, s]) => s === "done")).toBe(true);
  });
  it("run ending without an accepted answer leaves `answer` unsatisfied", async () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({ toolCall: { name: "alpha", args: { q: `go${i}` } } }));
    const pass = await runWith(calls, 2);
    // Plan 8 item 3 (G1): the cap hands off (an honest partial over the
    // gathered evidence) instead of failing bare; it is never "completed".
    expect(resolveCompletionStatus(pass.state)).toBe("partial");
    expect(pass.state.meta.deliverableDecision?.accepted).toBe(false);
    expect(statuses(pass.state.ledger, "answer")).not.toContain("satisfied");
  });
});
