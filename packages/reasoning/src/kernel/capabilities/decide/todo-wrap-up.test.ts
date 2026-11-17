// Run: bun test packages/reasoning/src/kernel/capabilities/decide/todo-wrap-up.test.ts --timeout 15000
//
// A final answer written while todo rows are open gets ONE bounded reconcile
// turn (todo-wrap-up.ts, wired in model-exit-proposal.ts). Never auto-checks,
// never twice, never without room. OPT-IN (`harness.todoWrapUp`,
// `RA_TODO_WRAPUP=1`): default OFF until an ablation measures it.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, foldAdvisory } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../../testing/tool-service-mock.js";
import { reactKernel } from "../../loop/react-kernel.js";
import { runPass } from "../../loop/run-pass.js";
import {
  initialKernelState,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../../state/kernel-state.js";
import { appendEntry } from "../../ledger/run-ledger.js";
import { makeStep } from "../sense/step-utils.js";
import { stepTodoWrapUp, todoWrapUpAwaitingReply, todoWrapUpIssued, todoWrapUpText } from "./todo-wrap-up.js";
import { ownItems } from "../reflect/checklist-reminder.js";
import { resolveHarnessConfig } from "../../../harness-config.js";

const SCHEMAS = [
  { name: "gather1", description: "gather", parameters: [{ name: "q", type: "string", required: true }] },
  {
    name: "todo",
    description: "checklist",
    parameters: [
      { name: "action", type: "string", required: true },
      { name: "items", type: "array", required: false },
      { name: "id", type: "number", required: false },
    ],
  },
];
const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: { finding: "KEY FACT" } }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `w${padN}x${i}`).join(" ");
};
// A todo call rides with a real gather call (meta-only turns hold the stall count)
// and a padded thought, so the token-delta guard (<300 tokens/iteration) stays quiet.
const todo = (args: Record<string, unknown>) => ({ text: pad(), toolCall: { name: "todo", args } });
const final = (): { text: string } => ({ text: "Done — the answer is 42." });

const WRAP_UP_ON = { ...resolveHarnessConfig(), todoWrapUp: true as const };
const input = (wrapUp: boolean): KernelInput =>
  ({
    task: "Plan and finish the work.",
    availableToolSchemas: SCHEMAS,
    metaTools: { todo: true },
    contextProfile: { tier: "local" },
    ...(wrapUp ? { harness: WRAP_UP_ON } : {}),
  }) as KernelInput;
const opts = (maxIterations = 12): KernelRunOptions => ({
  maxIterations,
  strategy: "reactive",
  kernelType: "react",
  taskId: "todo-wrap-up-test",
  modelId: "llama3.2:3b",
});
const run = (turns: Parameters<typeof TestLLMServiceLayer>[0], maxIterations = 12, wrapUp = true) =>
  Effect.runPromise(
    runPass(reactKernel, input(wrapUp), opts(maxIterations)).pipe(
      Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), toolLayer, EventBusLive)),
    ),
  );

const wrapUps = (s: KernelState) => s.steps.filter((x) => x.metadata?.intervention?.actor === "todo-wrap-up");
const statuses = (s: KernelState) =>
  foldAdvisory((s.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []))).map((i) => i.status);

describe("todo wrap-up is opt-in (default OFF)", () => {
  const prior = process.env.RA_TODO_WRAPUP;
  beforeEach(() => {
    delete process.env.RA_TODO_WRAPUP;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.RA_TODO_WRAPUP;
    else process.env.RA_TODO_WRAPUP = prior;
  });

  // RED-ON-CUT: drop the `harness.todoWrapUp` check in model-exit-proposal.ts
  // and the open row holds the answer for a wrap-up turn here.
  it("flag off: an open row at the final answer gets no wrap-up turn; the answer ends the run", async () => {
    const pass = await run([todo({ action: "add", items: ["only item"] }), final(), final()], 12, false);
    expect(wrapUps(pass.state).length).toBe(0);
    expect(statuses(pass.state)).toEqual(["pending"]);
    expect(pass.state.status).toBe("done");
    expect(pass.state.llmCalls).toBe(2);
  }, 30_000);

  it("resolves off by default, on only via RA_TODO_WRAPUP=1", () => {
    expect("todoWrapUp" in resolveHarnessConfig()).toBe(false);
    process.env.RA_TODO_WRAPUP = "true";
    expect("todoWrapUp" in resolveHarnessConfig()).toBe(false);
    process.env.RA_TODO_WRAPUP = "1";
    expect(resolveHarnessConfig().todoWrapUp).toBe(true);
  });
});

describe("todo wrap-up before finish (real kernel run, flag on)", () => {
  it("open row at final answer -> one extra turn -> model closes it -> finishes", async () => {
    const pass = await run([
      todo({ action: "add", items: ["only item"] }),
      final(),
      todo({ action: "done", id: 1 }),
      final(),
    ]);
    expect(wrapUps(pass.state).length).toBe(1);
    expect(statuses(pass.state)).toEqual(["completed"]);
    expect(pass.state.status).toBe("done");
    expect(pass.state.output).toContain("42");
  }, 30_000);

  it("model ignores the nudge -> still finishes after exactly one nudge", async () => {
    const pass = await run([todo({ action: "add", items: ["only item"] }), final(), final()]);
    expect(wrapUps(pass.state).length).toBe(1);
    expect(statuses(pass.state)).toEqual(["pending"]);
    expect(pass.state.status).toBe("done");
  }, 30_000);

  it("never checks an item for the model", async () => {
    const pass = await run([todo({ action: "add", items: ["a", "b"] }), final(), final()]);
    expect(statuses(pass.state)).toEqual(["pending", "pending"]);
  }, 30_000);

  it("no todo list -> untouched", async () => {
    const pass = await run([{ text: pad(), toolCall: { name: "gather1", args: { q: "x" } } }, final()]);
    expect(wrapUps(pass.state).length).toBe(0);
    expect(pass.state.status).toBe("done");
  }, 30_000);

  it("all rows closed -> untouched", async () => {
    const pass = await run([todo({ action: "add", items: ["a"] }), todo({ action: "done", id: 1 }), final()]);
    expect(wrapUps(pass.state).length).toBe(0);
    expect(pass.state.status).toBe("done");
  }, 30_000);
});

describe("stepTodoWrapUp (seam pin)", () => {
  const withOpenRow = (iteration: number, llmCalls = 0): KernelState => {
    const base = initialKernelState({ taskId: "t", strategy: "reactive", kernelType: "react" } as never);
    return {
      ...base,
      iteration,
      llmCalls,
      ledger: appendEntry(base.ledger, {
        kind: "checklist-item",
        iteration: 1,
        change: { op: "add", items: [{ id: "1", title: "write report" }] },
      } as never),
    } as KernelState;
  };

  it("names the open rows and issues the guidance once", () => {
    const next = stepTodoWrapUp(withOpenRow(2), 10);
    expect(next?.status).toBe("thinking");
    expect(next?.pendingGuidance?.checklistReminder).toBe(todoWrapUpText(ownItems(next?.ledger)));
    expect(next?.pendingGuidance?.checklistReminder).toContain("[1] write report");
    expect(todoWrapUpIssued(next as KernelState)).toBe(true);
    expect(stepTodoWrapUp(next as KernelState, 10)).toBeUndefined();
  });

  it("awaits the reply until the model writes a thought after the wrap-up step", () => {
    const next = stepTodoWrapUp(withOpenRow(2), 10) as KernelState;
    expect(todoWrapUpAwaitingReply(next.steps)).toBe(true);
    expect(todoWrapUpAwaitingReply([...next.steps, makeStep("thought", "closing the list", {})])).toBe(false);
    expect(todoWrapUpAwaitingReply([])).toBe(false);
  });

  it("no room (iteration or call budget spent) -> no nudge", () => {
    expect(stepTodoWrapUp(withOpenRow(9), 10)).toBeUndefined();
    expect(stepTodoWrapUp(withOpenRow(2, 10), 10)).toBeUndefined();
  });
});
