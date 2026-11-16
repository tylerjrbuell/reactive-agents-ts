// Run: bun test packages/reasoning/tests/kernel/typed-current-turn.test.ts --timeout 20000
//
// Typed current-turn input (2026-11-15). A producer that KNOWS the current turn
// (TaskMetadata.currentTurn) hands its text to the kernel; the contract compiler
// and deriveConditions prefer it over marker parsing (extractCurrentTurn stays
// as the fallback). RED-ON-CUT: make resolveCurrentTurn (kernel/contract/
// current-turn.ts) ignore its typed argument and the typed tests fail.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type ContractCompiledEvent } from "@reactive-agents/trace";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput } from "../../src/kernel/state/kernel-state.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { deriveConditions } from "../../src/kernel/capabilities/verify/derive-conditions.js";
import { deliveryRails } from "../../src/kernel/contract/delivery-scope.js";
import { extractCurrentTurn, resolveCurrentTurn } from "../../src/kernel/contract/current-turn.js";

const CURRENT = "Thanks, what is the capital of France?";
// A history block whose prose carries intent phrases and NO marker the parser
// recognises after it: marker parsing would read all of this as the ask.
const UNMARKED = `User: Write the report to ./old-report.md and send an email to the team.\nAssistant: Done.\n${CURRENT}`;

describe("resolveCurrentTurn", () => {
  it("absent / blank typed text falls back to marker parsing (identical)", () => {
    const task = `--- Conversation history ---\nUser: a\n\n--- Current message ---\n${CURRENT}`;
    expect(resolveCurrentTurn(task)).toEqual(extractCurrentTurn(task));
    expect(resolveCurrentTurn(task, undefined)).toEqual(extractCurrentTurn(task));
    expect(resolveCurrentTurn(task, "   ")).toEqual(extractCurrentTurn(task));
  });

  it("typed text wins; offset locates it in the original task", () => {
    const t = resolveCurrentTurn(UNMARKED, CURRENT);
    expect(t.text).toBe(CURRENT);
    expect(UNMARKED.slice(t.offset)).toBe(CURRENT);
    expect(t.historyStripped).toBe(true);
  });

  it("typed text not found in the task: offset 0", () => {
    expect(resolveCurrentTurn("something else", "typed").offset).toBe(0);
  });
});

describe("compileRunContract with currentTurnText", () => {
  it("control: without the typed text the unmarked history pollutes the contract", () => {
    const ids = compileRunContract(UNMARKED).requirements.map((r) => r.id);
    expect(ids).toContain("artifact:./old-report.md");
  });

  it("typed text: contract derives from the typed turn only", () => {
    const c = compileRunContract(UNMARKED, { currentTurnText: CURRENT });
    expect(c.requirements.map((r) => r.id)).toEqual(["answer"]);
    expect(c.deliverables).toEqual([]);
    expect(c.currentTurn?.historyStripped).toBe(true);
  });

  it("typed deliverable keeps a span into the ORIGINAL task", () => {
    const current = "Now save the summary to ./summary.md";
    const task = `User: write ./old.md\nAssistant: ok\n${current}`;
    const req = compileRunContract(task, { currentTurnText: current }).requirements.find(
      (r) => r.id === "artifact:./summary.md",
    );
    const span = req?.provenance?.span;
    expect(span).toBeDefined();
    expect(task.slice(span!.start, span!.end)).toBe("./summary.md");
  });

  it("absent: byte-identical to before", () => {
    const task = "Write ./a.md and send an email to bob.";
    expect(compileRunContract(task, {})).toEqual(compileRunContract(task));
  });
});

describe("deriveConditions with currentTurnText", () => {
  it("control: unmarked history derives history conditions", () => {
    expect(deriveConditions(UNMARKED, []).length).toBeGreaterThan(0);
  });

  it("typed text: only the current turn is scanned", () => {
    expect(deriveConditions(UNMARKED, [], undefined, undefined, CURRENT)).toEqual([]);
  });

  it("absent: byte-identical", () => {
    const task = "Write ./a.md and send an email to bob.";
    expect(deriveConditions(task, [], undefined, undefined, undefined)).toEqual(deriveConditions(task, []));
  });
});

describe("kernel run: KernelInput.currentTurnText reaches the compiled contract", () => {
  const compiled = async (input: KernelInput): Promise<ContractCompiledEvent> => {
    const raw = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("ContractCompiledEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
        yield* runPass(reactKernel, input, {
          maxIterations: 2, strategy: "reactive", kernelType: "react", taskId: "typed-current-turn",
        });
        return yield* Ref.get(events);
      }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer([{ text: "Paris." }]), EventBusLive))),
    );
    const ev = raw.map((r, i) => toTraceEvent(r, i)).find((e): e is ContractCompiledEvent => e?.kind === "contract-compiled");
    if (!ev) throw new Error("no contract-compiled event");
    return ev;
  };

  it("typed turn strips unmarked history from the run's contract; absent keeps it", async () => {
    const typed = await compiled({ task: UNMARKED, currentTurnText: CURRENT } satisfies KernelInput);
    expect(typed.requirements.map((r) => r.id)).toEqual(["answer"]);
    const untyped = await compiled({ task: UNMARKED } satisfies KernelInput);
    expect(untyped.requirements.map((r) => r.id)).toContain("artifact:./old-report.md");
  });
});

describe("kernel input carries the field to both derivations", () => {
  it("deliveryRails forwards currentTurnText (and omits it when absent)", () => {
    const harness = { inputCoverage: false, writeCoverage: false };
    expect(deliveryRails({ currentTurnText: CURRENT, harness }).currentTurnText).toBe(CURRENT);
    expect("currentTurnText" in deliveryRails({ harness })).toBe(false);
  });
});
