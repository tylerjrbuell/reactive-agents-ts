// Run: bun test packages/reasoning/tests/kernel/contract-current-turn.test.ts --timeout 20000
//
// Contract current-turn scoping + provenance (2026-11-03). Chat callers (Cortex,
// gateway) inline prior conversation ahead of the user's current ask; the
// RunContract used to compile from ALL of it, so requirements from earlier turns
// stayed outstanding and the terminal gate could never be satisfied.
// RED-ON-CUT: make extractCurrentTurn (kernel/contract/current-turn.ts) return
// `{ text: task, offset: 0, historyStripped: false }` and every history test
// below fails; drop the `provenance` fields in run-contract.ts or the projection
// in diagnostics.ts emitContractCompiled and the trace test fails.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type ContractCompiledEvent } from "@reactive-agents/trace";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { extractCurrentTurn } from "../../src/kernel/contract/current-turn.js";
import type { KernelInput } from "../../src/kernel/state/kernel-state.js";

const HISTORY =
  "--- Conversation history ---\n" +
  "User: Write the report to ./old-report.md and send an email to the team about it.\n" +
  "Assistant: Done, saved ./old-report.md and emailed the team.";

const CURRENT = "Thanks, what is the capital of France?";
const withHistoryBlock = `${HISTORY}\n\n--- Current message ---\n${CURRENT}`;
const withNewRequest = `Context from prior run: wrote ./old-report.md\n\nNew request: ${CURRENT}`;
const gateway =
  `${HISTORY}\n\nYou are in a live conversation with alice on slack.\n\nUser: ${CURRENT}`;
const composed = `${withNewRequest}\n\n${HISTORY}\n\n--- Current message ---\n${CURRENT}`;

describe("extractCurrentTurn", () => {
  it("no marker: whole task, offset 0, not stripped (byte-identical)", () => {
    expect(extractCurrentTurn("Write ./a.md")).toEqual({ text: "Write ./a.md", offset: 0, historyStripped: false });
  });
  for (const [name, task] of [
    ["withHistoryBlock", withHistoryBlock],
    ["New request", withNewRequest],
    ["gateway enriched instruction", gateway],
    ["composed markers", composed],
  ] as const) {
    it(`${name}: returns only the current turn at the right offset`, () => {
      const t = extractCurrentTurn(task);
      expect(t.historyStripped).toBe(true);
      expect(t.text.trim()).toBe(CURRENT);
      expect(task.slice(t.offset)).toBe(t.text);
    });
  }
});

describe("compileRunContract — history never reaches the contract", () => {
  it("control: the same history compiled as the task WOULD derive history requirements", () => {
    const polluted = compileRunContract(HISTORY);
    const ids = polluted.requirements.map((r) => r.id);
    expect(ids).toContain("artifact:./old-report.md");
    expect(ids).toContain("action:send-message");
  });

  for (const [name, task] of [
    ["withHistoryBlock", withHistoryBlock],
    ["New request", withNewRequest],
    ["gateway enriched instruction", gateway],
    ["composed markers", composed],
  ] as const) {
    it(`${name}: contract has only the floor requirement and no history deliverables`, () => {
      const c = compileRunContract(task);
      expect(c.requirements.map((r) => r.id)).toEqual(["answer"]);
      expect(c.deliverables).toEqual([]);
      expect(c.postConditions).toEqual([]);
      expect(c.currentTurn?.historyStripped).toBe(true);
    });
  }

  it("a real deliverable in the CURRENT turn is kept, with a span into the ORIGINAL string", () => {
    const current = "Now save the summary to ./summary.md";
    const task = `${HISTORY}\n\n--- Current message ---\n${current}`;
    const c = compileRunContract(task);
    const req = c.requirements.find((r) => r.id === "artifact:./summary.md");
    expect(req?.provenance?.source).toBe("task-text");
    const span = req?.provenance?.span;
    expect(span).toBeDefined();
    expect(task.slice(span!.start, span!.end)).toBe("./summary.md");
    expect(c.deliverables.find((d) => d.id === "artifact:./summary.md")?.provenance?.span).toEqual(span);
    expect(c.requirements.map((r) => r.id)).not.toContain("artifact:./old-report.md");
  });

  it("provenance sources: tools, floor, task-text", () => {
    const c = compileRunContract("Search for X then write ./o.md", { requiredTools: ["web-search"] });
    const by = (id: string) => c.requirements.find((r) => r.id === id)?.provenance?.source;
    expect(by("tool:web-search")).toBe("required-tools");
    expect(by("answer")).toBe("floor");
    expect(by("artifact:./o.md")).toBe("task-text");
  });

  it("an action need in the current turn carries a task-text span", () => {
    const task = `${HISTORY}\n\n--- Current message ---\nPlease send an email to the team.`;
    const req = compileRunContract(task).requirements.find((r) => r.id === "action:send-message");
    const span = req?.provenance?.span;
    expect(span).toBeDefined();
    expect(task.slice(span!.start, span!.end).toLowerCase()).toContain("send");
    expect(span!.start).toBeGreaterThanOrEqual(task.indexOf("--- Current message ---"));
  });
});

describe("contract-compiled trace event (scripted kernel run, read via toTraceEvent)", () => {
  const runTraced = async (task: string): Promise<ContractCompiledEvent> => {
    const raw = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("ContractCompiledEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
        yield* runPass(reactKernel, { task } satisfies KernelInput, {
          maxIterations: 2, strategy: "reactive", kernelType: "react", taskId: "contract-current-turn",
        });
        return yield* Ref.get(events);
      }).pipe(
        Effect.provide(Layer.mergeAll(TestLLMServiceLayer([{ text: "Paris." }]), EventBusLive)),
      ),
    );
    const ev = raw.map((r, i) => toTraceEvent(r, i)).find((e): e is ContractCompiledEvent => e?.kind === "contract-compiled");
    if (!ev) throw new Error("no contract-compiled event");
    return ev;
  };

  it("history-prefixed task: event has no history requirements, records currentTurn + provenance", async () => {
    const ev = await runTraced(withHistoryBlock);
    expect(ev.requirements.map((r) => r.id)).toEqual(["answer"]);
    expect(ev.requirements[0]?.provenance?.source).toBe("floor");
    expect(ev.deliverables).toEqual([]);
    expect(ev.currentTurn?.historyStripped).toBe(true);
    expect(withHistoryBlock.slice(ev.currentTurn!.offset).trim()).toBe(CURRENT);
  });

  it("current-turn deliverable span survives to the trace and indexes the original task", async () => {
    const task = `${HISTORY}\n\n--- Current message ---\nSave the answer to ./out.md`;
    const ev = await runTraced(task);
    const ref = ev.deliverables.find((d) => d.id === "artifact:./out.md");
    expect(ref?.provenance?.source).toBe("task-text");
    expect(task.slice(ref!.provenance!.span!.start, ref!.provenance!.span!.end)).toBe("./out.md");
    expect(ev.requirements.map((r) => r.id)).not.toContain("artifact:./old-report.md");
  });
});
