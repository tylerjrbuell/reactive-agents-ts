// Run: bun test packages/reasoning/tests/kernel/act/plan-todo-churn.test.ts --timeout 20000
//
// Plan posture: a model that already recorded its plan must not keep appending
// rephrased rows via `todo add` (live Cortex trace 01M7N75MCD0EGQ00SSTF3NA81R:
// 4 add calls -> 10 rows). Zero-token: scripted LLM, real kernel.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, foldAdvisory } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../../../src/kernel/state/kernel-state.js";
import {
  PLAN_TODO_CHURN_GUARD,
  PLAN_TODO_MAX_MUTATIONS_PER_TURN,
  isRephrasedStep,
  judgePlanTodoCall,
  planAlreadyRecordedMessage,
} from "../../../src/kernel/policy/plan-todo-churn.js";

// The live rephrase pairs (first-recorded row vs the model's later restatement).
const LIVE_PAIRS: readonly (readonly [string, string])[] = [
  [
    "Verify the current directory is a git repository and inspect repo state (top-level path, shallow flag, submodule, detached HEAD, pager settings).",
    "Confirm the working directory is a git repository and inspect repo state (top-level path, shallow flag, submodules, branch vs detached HEAD, pager setting).",
  ],
  [
    "For each of the five commits, extract the changed-file list (tree diff / commit stat).",
    "For each of the five commits, extract the changed-file list via `git diff-tree -r --name-only` (or `git diff --name-status` for merge/annotated-tag cases, `git show <commit>:<path>` for submodules).",
  ],
  [
    "Compose and present a per-commit summary table (commit, date, message, changed files) in the final answer.",
    "Present a per-commit summary table (hash, date, message, changed files) and note any caveats (merge commits, submodules, renames).",
  ],
  [
    "Handle edge cases: merge commits (use `git diff-tree -r -M`), submodules (use `git show <commit>:<path>`), and renames (use `git diff-tree -r -m --name-status` or `git diff --stat` with rename detection).",
    "Handle edge cases: merge commits (`git diff-tree -r -m --name-only`), submodules (`git show <commit>:<path>`), and the root commit (`git diff-tree -r --root` if applicable).",
  ],
];

const PLAN = [
  LIVE_PAIRS[0]![0],
  "Retrieve the five newest commits with metadata (hash, date, short message) via git log.",
  LIVE_PAIRS[1]![0],
  LIVE_PAIRS[2]![0],
];

describe("isRephrasedStep", () => {
  it("catches every live rephrase pair", () => {
    for (const [a, b] of LIVE_PAIRS) expect(isRephrasedStep(b, a)).toBe(true);
  });
  it("is symmetric on the live pairs", () => {
    for (const [a, b] of LIVE_PAIRS) expect(isRephrasedStep(a, b)).toBe(isRephrasedStep(b, a));
  });
  it("keeps genuinely new steps and numbered per-item steps distinct", () => {
    expect(isRephrasedStep("Handle edge cases: merge commits, submodules and renames.", PLAN[3]!)).toBe(false);
    expect(isRephrasedStep("Ask the user which branch to summarise before fetching history.", PLAN[1]!)).toBe(false);
    expect(isRephrasedStep("Read notes-1.txt and write the summary to out-1.txt", "Read notes-2.txt and write the summary to out-2.txt")).toBe(false);
    expect(isRephrasedStep("Run tests", "Run linter")).toBe(false);
  });
});

describe("judgePlanTodoCall (pure)", () => {
  const items = PLAN.map((title, i) => ({ id: String(i + 1), title, status: "pending" as const }));
  it("answers an all-rephrased add with the list and the guidance line", () => {
    const v = judgePlanTodoCall({ action: "add", items: [LIVE_PAIRS[0]![1], LIVE_PAIRS[2]![1]] }, items, []);
    expect(v.kind).toBe("answer");
    if (v.kind !== "answer") return;
    expect(v.content).toContain("1. Verify the current directory");
    expect(v.content).toContain(planAlreadyRecordedMessage(4));
  });
  it("trims restated entries and keeps genuinely new ones", () => {
    const fresh = "Ask the user which branch to summarise before fetching history.";
    const v = judgePlanTodoCall({ action: "add", items: [LIVE_PAIRS[0]![1], fresh] }, items, []);
    expect(v.kind).toBe("trim");
    if (v.kind === "trim") expect(v.args.items).toEqual([fresh]);
  });
  it("passes the first add (empty list) and non-add actions", () => {
    expect(judgePlanTodoCall({ action: "add", items: PLAN }, [], []).kind).toBe("pass");
    expect(judgePlanTodoCall({ action: "done", id: 1 }, items, []).kind).toBe("pass");
  });
});

// ─── Real kernel, scripted LLM ────────────────────────────────────────────────

const SCHEMAS = [
  { name: "brief", description: "snapshot", parameters: [{ name: "section", type: "string", required: false }] },
  {
    name: "todo",
    description: "checklist",
    parameters: [
      { name: "action", type: "string", required: true },
      { name: "items", type: "array", required: false },
      { name: "id", type: "number", required: false },
      { name: "text", type: "string", required: false },
    ],
  },
];
let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `w${padN}x${i}`).join(" ");
};
const todoTurn = (args: Record<string, unknown>) => ({ text: pad(), toolCall: { name: "todo", args } });
const FINAL = { text: "Here is the plan." };

const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: "ok" }),
  getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
});

const run = (turns: Parameters<typeof TestLLMServiceLayer>[0]) => {
  const guards: { guard: string; outcome: string; metadata?: Record<string, unknown> }[] = [];
  const input = {
    task: "Plan how to summarise the five newest git commits.",
    availableToolSchemas: SCHEMAS,
    metaTools: { todo: true },
    posture: "plan",
    contextProfile: { tier: "local" },
  } as KernelInput;
  const opts: KernelRunOptions = { maxIterations: 8, strategy: "reactive", kernelType: "react", taskId: "plan-churn", modelId: "llama3.2:3b" };
  return Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (e) =>
        Effect.sync(() => void guards.push({ guard: e.guard, outcome: e.outcome, metadata: e.metadata })));
      const pass = yield* runPass(reactKernel, input, opts);
      return { state: pass.state as KernelState, guards };
    }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), toolLayer, EventBusLive))),
  );
};

const items = (s: KernelState) =>
  foldAdvisory((s.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []))).map((i) => i.title);

describe("plan posture: todo churn (kernel)", () => {
  it("three add calls with rephrased rows leave the list at the planned steps", async () => {
    const { state, guards } = await run([
      todoTurn({ action: "add", items: PLAN }),
      todoTurn({ action: "add", items: LIVE_PAIRS.slice(0, 3).map((p) => p[1]) }),
      todoTurn({ action: "add", items: [LIVE_PAIRS[0]![1], LIVE_PAIRS[2]![1]] }),
      FINAL,
    ]);
    expect(items(state)).toEqual(PLAN);
    const churn = guards.filter((g) => g.guard === PLAN_TODO_CHURN_GUARD);
    expect(churn.length).toBeGreaterThanOrEqual(2);
    expect(churn[0]!.metadata).toMatchObject({ posture: "plan", planSteps: 4 });
    const obs = state.steps.filter((s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "todo").map((s) => s.content);
    expect(obs[1]).toContain(planAlreadyRecordedMessage(4));
  });

  it("caps todo mutations per turn", async () => {
    const adds = Array.from({ length: PLAN_TODO_MAX_MUTATIONS_PER_TURN + 1 }, (_, i) => ({
      name: "todo",
      args: { action: "add", items: [`Entirely separate unique objective number ${["alpha", "bravo", "charlie", "delta"][i]} xylophone${i}`] },
    }));
    const { state, guards } = await run([{ text: pad(), toolCalls: adds }, FINAL]);
    expect(items(state).length).toBe(PLAN_TODO_MAX_MUTATIONS_PER_TURN);
    expect(guards.some((g) => g.guard === PLAN_TODO_CHURN_GUARD && g.metadata?.cause === "turn-cap")).toBe(true);
  });

  it("execute posture is untouched: rephrased rows the core rule misses still append", async () => {
    const { state } = await runExecute();
    expect(items(state).length).toBeGreaterThan(4);
  });
});

async function runExecute() {
  const input = {
    task: "Do the work.", availableToolSchemas: SCHEMAS, metaTools: { todo: true }, contextProfile: { tier: "local" },
  } as KernelInput;
  const opts: KernelRunOptions = { maxIterations: 8, strategy: "reactive", kernelType: "react", taskId: "exec-churn", modelId: "llama3.2:3b" };
  const pass = await Effect.runPromise(
    runPass(reactKernel, input, opts).pipe(
      Effect.provide(Layer.mergeAll(
        TestLLMServiceLayer([todoTurn({ action: "add", items: PLAN }), todoTurn({ action: "add", items: [LIVE_PAIRS[0]![1], LIVE_PAIRS[2]![1]] }), FINAL]),
        toolLayer, EventBusLive)),
    ),
  );
  return { state: pass.state as KernelState };
}
