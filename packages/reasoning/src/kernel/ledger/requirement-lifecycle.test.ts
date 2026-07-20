// Run: bun test packages/reasoning/src/kernel/ledger/requirement-lifecycle.test.ts --timeout 30000
//
// B7 / meta-loop §3b #39 — the RunLedger `requirement` kind had ZERO non-test
// writers, so its two LIVE readers (assess.ts:207 → satisfiedIds/blockedIds;
// standing-frame.ts:193 → the outstanding-goal frame) always saw `[]` and the
// declared → satisfied|blocked lifecycle was fiction. These tests pin the two
// (and only two) writers — DECLARED at contract-compile, SATISFIED/BLOCKED at the
// assess gate — end to end, and are MUTATION tests: cutting a writer turns a
// specific expectation red (each `CUT:` note names the line to delete to see it).

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { reactKernel } from "../loop/react-kernel.js";
import { runPass } from "../loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import { compileRunContract } from "../contract/run-contract.js";
import { artifactProduced, toolCalled } from "../capabilities/verify/post-conditions.js";
import { assess } from "../assessment/assess.js";
import { appendEntry, entriesOfKind, type RunLedger } from "./run-ledger.js";
import { recordRequirementsDeclared, recordRequirementTransitions } from "./emit.js";

// ─── Unit: the two emitters in isolation ──────────────────────────────────────

describe("recordRequirementsDeclared — the DECLARED writer", () => {
  it("mints exactly one `declared` entry per requirement", () => {
    const reqs = [{ id: "tool:read" }, { id: "artifact:report.md" }, { id: "answer" }];
    const ledger = recordRequirementsDeclared(undefined, reqs, 0);
    const declared = entriesOfKind(ledger, "requirement");
    expect(declared.length).toBe(3);
    expect(declared.every((e) => e.status === "declared")).toBe(true);
    expect(new Set(declared.map((e) => e.requirementId))).toEqual(
      new Set(["tool:read", "artifact:report.md", "answer"]),
    );
  });

  it("is idempotent — a requirement already recorded (any status) is not re-declared", () => {
    let ledger: RunLedger = recordRequirementsDeclared(undefined, [{ id: "a" }, { id: "b" }], 0);
    // `a` transitions to satisfied; re-declaring must NOT resurrect it as declared.
    ledger = recordRequirementTransitions(ledger, ["a"], [], 1);
    ledger = recordRequirementsDeclared(ledger, [{ id: "a" }, { id: "b" }, { id: "c" }], 2);
    const forA = entriesOfKind(ledger, "requirement").filter((e) => e.requirementId === "a");
    expect(forA.map((e) => e.status)).toEqual(["declared", "satisfied"]);
    // Only the NEW `c` is freshly declared.
    const declaredIds = entriesOfKind(ledger, "requirement")
      .filter((e) => e.status === "declared")
      .map((e) => e.requirementId);
    expect(declaredIds).toEqual(["a", "b", "c"]);
  });
});

describe("recordRequirementTransitions — the SATISFIED/BLOCKED writer", () => {
  it("mints a `satisfied` transition once, then no-ops on repeat (idempotent)", () => {
    let ledger: RunLedger = recordRequirementsDeclared(undefined, [{ id: "x" }], 0);
    ledger = recordRequirementTransitions(ledger, ["x"], [], 1);
    const before = ledger.length;
    ledger = recordRequirementTransitions(ledger, ["x"], [], 2); // same status → no-op
    expect(ledger.length).toBe(before);
    const sat = entriesOfKind(ledger, "requirement").filter((e) => e.status === "satisfied");
    expect(sat.map((e) => e.requirementId)).toEqual(["x"]);
  });

  it("`blocked` wins over `satisfied` when an id is in both sets", () => {
    const ledger = recordRequirementTransitions(undefined, ["y"], ["y"], 0);
    const forY = entriesOfKind(ledger, "requirement").filter((e) => e.requirementId === "y");
    expect(forY.map((e) => e.status)).toEqual(["blocked"]);
  });
});

// ─── #39: satisfaction is ENTITY-keyed, not tool-name-keyed ────────────────────
//
// assess() is the single satisfaction authority and matches ArtifactProduced by
// PATH (pathMatches), so a write to a DIFFERENT entity does not satisfy a
// requirement bound to a specific one. The transition writer PERSISTS what assess
// partitions, so the entity-keying rides that one authority (REUSE, DO NOT FORK).
// This pins the false-positive kill end to end (compile → ledger → assess → mint).

describe("#39 — a requirement bound to entity A is NOT satisfied by an interaction with entity B", () => {
  const contract = {
    requirements: [
      {
        id: "artifact:rates.json",
        kind: "artifact-produced" as const,
        spec: { description: "produce rates.json", condition: artifactProduced("rates.json"), acceptance: "deterministic" as const },
      },
    ],
    deliverables: [],
    constraints: [],
    horizon: "short" as const,
    postConditions: [artifactProduced("rates.json")],
  };
  const budget = { iteration: 1, maxIterations: 10, tokensUsed: 0, costUsd: 0 };

  it("a write to `orders.json` (entity B) mints NO `satisfied` for the `rates.json` (entity A) requirement", () => {
    const ledger = appendEntry(undefined, { kind: "artifact", iteration: 1, path: "orders.json", op: "write" });
    const a = assess(contract, ledger, budget);
    expect(a.requirements.satisfied).not.toContain("artifact:rates.json");
    // CUT: the entity-keying (pathMatches in assess.ts conditionMet) — if satisfaction
    // keyed on tool/kind alone, `orders.json` would satisfy `rates.json` here.
    const after = recordRequirementTransitions(ledger, a.requirements.satisfied, a.requirements.blocked, 1);
    const sat = entriesOfKind(after, "requirement").filter((e) => e.status === "satisfied");
    expect(sat.map((e) => e.requirementId)).not.toContain("artifact:rates.json");
  });

  it("a write to `rates.json` (entity A) DOES mint `satisfied` for the entity-A requirement", () => {
    const ledger = appendEntry(undefined, { kind: "artifact", iteration: 1, path: "rates.json", op: "write" });
    const a = assess(contract, ledger, budget);
    expect(a.requirements.satisfied).toContain("artifact:rates.json");
    const after = recordRequirementTransitions(ledger, a.requirements.satisfied, a.requirements.blocked, 1);
    const sat = entriesOfKind(after, "requirement").filter((e) => e.status === "satisfied");
    expect(sat.map((e) => e.requirementId)).toContain("artifact:rates.json");
  });
});

// ─── End-to-end wiring: DECLARED at compile, SATISFIED at the assess gate ──────

const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string; args?: unknown }) =>
    Effect.succeed({ success: true, result: { finding: `KEY FACT from ${req.toolName}` } }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

const SCHEMAS = [
  { name: "alpha", description: "gather a", parameters: [{ name: "q", type: "string", required: true }] },
];

// Call the required tool, then answer — so `tool:alpha` becomes SATISFIED and the
// run terminates cleanly.
const scenario = () =>
  TestLLMServiceLayer([
    { toolCall: { name: "alpha", args: { q: "go" } } },
    { text: "Done — the answer is 42." },
  ]);

const run = (opts: Partial<KernelRunOptions>) =>
  Effect.runPromise(
    runPass(
      reactKernel,
      { task: "Answer the question using the alpha tool.", availableToolSchemas: SCHEMAS, requiredTools: ["alpha"] } as KernelInput,
      {
        maxIterations: 6,
        strategy: "reactive",
        kernelType: "react",
        taskId: "requirement-lifecycle-integration",
        modelId: "llama3.2:3b",
        ...opts,
      },
    ).pipe(Effect.provide(Layer.merge(scenario(), toolLayer))),
  );

const requirementEntries = (ledger: RunLedger | undefined) => entriesOfKind(ledger, "requirement");

describe("B7 wiring — requirement lifecycle is minted by a real kernel run", () => {
  it("DECLARED: the ledger carries one `declared` entry per compiled requirement", async () => {
    const pass = await run({});
    const contract = pass.state.meta.runContract;
    expect(contract).toBeDefined();
    const declaredIds = requirementEntries(pass.state.ledger)
      .filter((e) => e.status === "declared")
      .map((e) => e.requirementId);
    // CUT: the `ledger: recordRequirementsDeclared(...)` line in runner.ts → zero declared.
    for (const r of contract?.requirements ?? []) expect(declaredIds).toContain(r.id);
    expect(declaredIds.length).toBe(contract?.requirements.length ?? -1);
  });

  it("SATISFIED: calling the required `alpha` tool mints a `satisfied` entry that assess() reads", async () => {
    const pass = await run({});
    const satisfied = requirementEntries(pass.state.ledger).filter((e) => e.status === "satisfied");
    // CUT: the `ledger: recordRequirementTransitions(...)` transition in iterate-pass.ts → no satisfied entry.
    expect(satisfied.map((e) => e.requirementId)).toContain("tool:alpha");

    // The satisfied FACT drives assess()'s satisfiedIds (the register's live reader).
    const contract = pass.state.meta.runContract;
    expect(contract).toBeDefined();
    if (contract) {
      const a = assess(contract, pass.state.ledger ?? [], {
        iteration: pass.state.iteration,
        maxIterations: 6,
        tokensUsed: pass.state.tokens,
        costUsd: pass.state.cost,
      });
      expect(a.requirements.satisfied).toContain("tool:alpha");
    }
  });
});
