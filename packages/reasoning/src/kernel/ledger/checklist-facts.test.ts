// Run: bun test packages/reasoning/src/kernel/ledger/checklist-facts.test.ts --timeout 15000
//
// Plan-and-goal-primitives Phase 1 Task 2: the checklist is a PROJECTION of ledger
// facts. Declared requirements are self-describing; `checklist-item` is the new
// advisory fact kind. Pins: emitters, type-level assignability to the core
// structural mirrors, merge provenance, and model-invisibility.

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type {
  ChecklistItemFact,
  ChecklistItemOp,
  LedgerEntryAppendedEvent,
  RequirementFact,
} from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { reactKernel } from "../loop/react-kernel.js";
import { runPass } from "../loop/run-pass.js";
import type { KernelInput } from "../state/kernel-state.js";
import { project, type AssemblyInput } from "../../assembly/project.js";
import { EventLog } from "../../assembly/event-log.js";
import { ResultStore } from "../../assembly/result-store.js";
import { resolveCapability } from "../../assembly/capability.js";
import { entriesOfKind, ledgerEntriesForEvent, type RunLedger } from "./run-ledger.js";
import { appendAnnounced, type LedgerSinkTarget } from "./ledger-sink.js";
import { recordChecklistItems, recordRequirementsDeclared } from "./emit.js";
import { mergePassLedger } from "./run-scope.js";

const add = (id: string, title: string): ChecklistItemOp => ({ op: "add", items: [{ id, title }] });

describe("recordRequirementsDeclared — self-describing", () => {
  it("copies description + kind onto the declared entry and stays idempotent", () => {
    const refs = [{ id: "artifact:r.md", description: "produce ./r.md", kind: "artifact-produced" as const }];
    const once = recordRequirementsDeclared(undefined, refs, 0);
    const [e] = entriesOfKind(once, "requirement");
    expect(e?.description).toBe("produce ./r.md");
    expect(e?.requirementKind).toBe("artifact-produced");
    expect(recordRequirementsDeclared(once, refs, 3)).toBe(once);
  });
});

describe("recordChecklistItems", () => {
  it("appends dense seqs in order with toolCallId", () => {
    const base = recordRequirementsDeclared(undefined, [{ id: "a" }], 0);
    const out = recordChecklistItems(base, [
      { iteration: 1, change: add("1", "x"), toolCallId: "tc1" },
      { iteration: 1, change: { op: "status", id: "1", status: "completed" } },
    ]);
    const items = entriesOfKind(out, "checklist-item");
    expect(items.map((i) => i.seq)).toEqual([1, 2]);
    expect(items[0]?.toolCallId).toBe("tc1");
    expect(items[1]?.toolCallId).toBeUndefined();
  });

  it("is a no-op for an empty batch", () => {
    const base: RunLedger = recordChecklistItems(undefined, [{ iteration: 0, change: add("1", "x") }]);
    expect(recordChecklistItems(base, [])).toBe(base);
  });
});

describe("checklist origin (D9 P7 — plan rows are distinguishable)", () => {
  it("carries origin:'plan' through recordChecklistItems; todo facts stay unmarked", () => {
    const out = recordChecklistItems(undefined, [
      { iteration: 0, change: add("s1", "Plan step 1"), origin: "plan" },
      { iteration: 0, change: add("t1", "model todo") },
    ]);
    const items = entriesOfKind(out, "checklist-item");
    expect(items[0]?.origin).toBe("plan");
    expect(items[1] !== undefined && "origin" in items[1]).toBe(false);
  });
});

describe("appendAnnounced — Ref sink growth is announced live", () => {
  const recordingTarget = (): { target: LedgerSinkTarget; events: LedgerEntryAppendedEvent[] } => {
    const events: LedgerEntryAppendedEvent[] = [];
    return {
      events,
      target: { taskId: "t-ann", agentId: "a-ann", publish: (ev) => Effect.sync(() => void events.push(ev)) },
    };
  };

  it("publishes ONE event carrying only the new tail and returns the grown ledger", async () => {
    const { target, events } = recordingTarget();
    const { grown, held, prior } = await Effect.runPromise(
      Effect.gen(function* () {
        const prior = recordRequirementsDeclared(undefined, [{ id: "a" }], 0);
        const ref = yield* Ref.make<RunLedger>(prior);
        const grown = yield* appendAnnounced(
          ref,
          (led) => recordChecklistItems(led, [{ iteration: 1, change: add("s1", "step"), origin: "plan" }]),
          target,
        );
        return { grown, held: yield* Ref.get(ref), prior };
      }),
    );
    expect(grown).toBe(held);
    expect(grown.length).toBe(prior.length + 1);
    expect(events.length).toBe(1);
    expect(events[0]?._tag).toBe("LedgerEntryAppended");
    expect(events[0]?.taskId).toBe("t-ann");
    expect(events[0]?.agentId).toBe("a-ann");
    expect(events[0]?.entries).toEqual(ledgerEntriesForEvent(grown.slice(prior.length)));
    // The origin field survives the event projection the checklist tracker reads.
    expect(events[0]?.entries[0]?.["origin"]).toBe("plan");
    expect(events[0]?.entries[0]?.["seq"]).toBe(prior.length);
  });

  it("publishes nothing when grow adds nothing", async () => {
    const { target, events } = recordingTarget();
    await Effect.runPromise(
      Effect.gen(function* () {
        const ref = yield* Ref.make<RunLedger>([]);
        yield* appendAnnounced(ref, (led) => recordChecklistItems(led, []), target);
      }),
    );
    expect(events.length).toBe(0);
  });

  it("concurrent appends each announce only their own entries, seqs stay dense", async () => {
    const { target, events } = recordingTarget();
    const final = await Effect.runPromise(
      Effect.gen(function* () {
        const ref = yield* Ref.make<RunLedger>([]);
        yield* Effect.forEach(
          ["w1", "w2", "w3"],
          (id) => appendAnnounced(ref, (led) => recordChecklistItems(led, [{ iteration: 0, change: add(id, id) }]), target),
          { concurrency: "unbounded" },
        );
        return yield* Ref.get(ref);
      }),
    );
    expect(final.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(events.length).toBe(3);
    expect(events.every((e) => e.entries.length === 1)).toBe(true);
    expect(events.flatMap((e) => [...e.entries])).toEqual([...ledgerEntriesForEvent(final)]);
  });
});

describe("type pin — ledger entries assignable to core fact mirrors", () => {
  it("compiles", () => {
    const led = recordChecklistItems(
      recordRequirementsDeclared(undefined, [{ id: "r", description: "d", kind: "question-answered" }], 0),
      [{ iteration: 1, change: add("1", "t") }],
    );
    const entry = entriesOfKind(led, "requirement")[0];
    const itemEntry = entriesOfKind(led, "checklist-item")[0];
    expect(entry).toBeDefined();
    expect(itemEntry).toBeDefined();
    if (!entry || !itemEntry) return;
    const f: RequirementFact = entry;
    const g: ChecklistItemFact = itemEntry;
    const stamped: RequirementFact = { ...entry, pass: "sub-agent:x" };
    expect(f.kind).toBe("requirement");
    expect(g.kind).toBe("checklist-item");
    expect(stamped.pass).toBe("sub-agent:x");
  });
});

describe("provenance through mergePassLedger", () => {
  it("keeps every checklist/requirement entry stamped; grandchild stamp survives", () => {
    const grand = mergePassLedger(
      undefined,
      recordChecklistItems(undefined, [{ iteration: 0, change: add("1", "g") }]),
      "sub-agent:grandchild",
    );
    let child = recordRequirementsDeclared(undefined, [{ id: "r", description: "d", kind: "question-answered" }], 0);
    child = recordChecklistItems(child, [{ iteration: 1, change: add("1", "c") }]);
    child = mergePassLedger(child, grand, "sub-agent:grandchild-wrapper");
    const merged = mergePassLedger(undefined, child, "sub-agent:x");
    expect(merged.every((e) => e.pass !== undefined)).toBe(true);
    expect(merged.filter((e) => e.pass === "sub-agent:x").map((e) => e.kind)).toEqual(["requirement", "checklist-item"]);
    expect(merged.find((e) => e.pass === "sub-agent:grandchild")?.kind).toBe("checklist-item");
    expect(merged.map((e) => e.seq)).toEqual([0, 1, 2]);
  });
});

describe("model-invisibility", () => {
  it("checklist-item entries never reach the projected request", () => {
    const ledger = recordChecklistItems(undefined, [
      { iteration: 1, change: add("1", "ZZ-SECRET-ADVISORY-TITLE") },
    ]);
    const input: AssemblyInput = {
      log: new EventLog().append({ kind: "goal", text: "Do the thing." }),
      capability: resolveCapability({ window: 200_000, outputBudget: 4096, dialect: "native-fc", tier: "frontier" }),
      store: new ResultStore(),
      persona: { system: "You are careful." },
      tools: { schemas: [] },
      ledger,
    };
    const { request } = project(input);
    const text = JSON.stringify(request);
    expect(text).not.toContain("checklist-item");
    expect(text).not.toContain("ZZ-SECRET-ADVISORY-TITLE");
  });
});

describe("contract run end to end", () => {
  it("declared entries carry the compiled descriptions", async () => {
    const toolLayer = mockToolServiceLayer({
      execute: () => Effect.succeed({ success: true, result: { finding: "KEY FACT" } }),
      getTool: (name: string) =>
        Effect.succeed({ name, description: "t", parameters: [{ name: "q", type: "string", required: true }] }),
    });
    const llm = TestLLMServiceLayer([{ toolCall: { name: "alpha", args: { q: "go" } } }, { text: "Done — 42." }]);
    const pass = await Effect.runPromise(
      runPass(
        reactKernel,
        {
          task: "Answer the question using the alpha tool.",
          availableToolSchemas: [{ name: "alpha", description: "a", parameters: [{ name: "q", type: "string", required: true }] }],
          requiredTools: ["alpha"],
        } as KernelInput,
        { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "checklist-facts-e2e", modelId: "llama3.2:3b" },
      ).pipe(Effect.provide(Layer.merge(llm, toolLayer))),
    );
    const contract = pass.state.meta.runContract;
    expect(contract).toBeDefined();
    const declared = entriesOfKind(pass.state.ledger, "requirement").filter((e) => e.status === "declared");
    for (const r of contract?.requirements ?? []) {
      const d = declared.find((e) => e.requirementId === r.id);
      expect(d?.description).toBe(r.spec.description);
      expect(d?.requirementKind).toBe(r.kind);
    }
    expect(declared.length).toBeGreaterThan(0);
  });
});
