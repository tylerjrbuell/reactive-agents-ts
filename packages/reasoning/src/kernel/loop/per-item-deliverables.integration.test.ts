// Run: bun test packages/reasoning/src/kernel/loop/per-item-deliverables.integration.test.ts
//
// Per-item deliverables — LIVE-LOOP pins (Plan 8 L7, 2026-11-03).
//
// A task that literally names three files compiles three `artifact-produced`
// requirements (source `task-explicit`), but the run-start PostCondition set the
// terminal gates read (`state.meta.postConditions`, single-path deriveConditions)
// held only the FIRST named file. A model that wrote 2 of 3 and claimed done was
// accepted. `deliveryConditions` (contract/declared-deliverables.ts) widens both
// gates — the arbitrator's exit-success spine and terminate.ts — with every
// per-item condition on the contract.
//
// RED-ON-CUT: make `deliveryConditions` return `meta.postConditions` unchanged
// and both tests below go red (the 2-of-3 claim is accepted as done).

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { succeedingToolLayer } from "../../testing/tool-service-mock.js";
import type { KernelInput } from "../state/kernel-state.js";
import { resolveCompletionStatus } from "../state/completion-status.js";

const PAD =
  " The petals rest quietly on the morning grass while the season slowly turns overhead.".repeat(30);

const FILE_WRITE_SCHEMA = {
  name: "file-write",
  description: "write content to a file",
  parameters: [
    { name: "path", type: "string", required: true },
    { name: "content", type: "string", required: true },
  ],
};

const TASK = "Write out-1.txt, out-2.txt and out-3.txt, each containing the word done.";

const write = (path: string, match?: string): TestTurn => ({
  ...(match !== undefined ? { match } : {}),
  toolCall: { name: "file-write", args: { path, content: "done" } },
});

const run = (scenario: TestTurn[], maxIterations: number) =>
  Effect.runPromise(
    runPass(reactKernel, { task: TASK, availableToolSchemas: [FILE_WRITE_SCHEMA] } satisfies KernelInput, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "per-item-deliverables",
    }).pipe(
      Effect.provide(
        Layer.merge(
          TestLLMServiceLayer(scenario),
          succeedingToolLayer({ written: true }, FILE_WRITE_SCHEMA.parameters),
        ),
      ),
    ),
  );

const wrote = (steps: readonly { type: string; content: string }[], path: string): boolean =>
  steps.some((s) => s.type === "action" && s.content.includes(path));

describe("per-item deliverables — the terminal gate refuses partial work (live loop)", () => {
  it("writes 2 of 3 named files and claims done → refused naming ./out-3.txt → writes it → done", async () => {
    const pass = await run(
      [
        write("./out-1.txt"),
        write("./out-2.txt"),
        { text: "All three files are written; the task is complete." + PAD },
        // Reachable ONLY when the refusal's guidance names the missing item.
        write("./out-3.txt", "file \\./out-3\\.txt"),
        { text: "Now all three files exist on disk and the task is complete." + PAD },
      ],
      10,
    );
    expect(wrote(pass.state.steps, "out-3.txt")).toBe(true);
    expect(pass.state.status).toBe("done");
  });

  it("never writes the third file → the run never reports done; the outcome names ./out-3.txt", async () => {
    const pass = await run(
      [
        write("./out-1.txt"),
        write("./out-2.txt"),
        { text: "All three files are written; the task is complete." + PAD },
        { text: "Everything requested is on disk; nothing remains to be done." + PAD },
      ],
      5,
    );
    expect(wrote(pass.state.steps, "out-3.txt")).toBe(false);
    // Plan 8 item 3 (G1): the guard exit hands off instead of failing bare —
    // never "completed": an honest partial whose delivered output names the
    // missing ./out-3.txt (status "done" now carries a refused decision).
    expect(resolveCompletionStatus(pass.state)).toBe("partial");
    expect(pass.state.meta.deliverableDecision?.accepted).toBe(false);
    expect(pass.state.output ?? "").toContain("./out-3.txt");
    const named =
      (pass.state.error ?? "").includes("./out-3.txt") ||
      pass.state.steps.some((s) => s.content.includes("./out-3.txt"));
    expect(named).toBe(true);
  });
});

// ── task-explicit via a BOUND template (h3-todo-heavy verbatim, 2026-11-04) ──
//
// The task names its outputs as a template (out-N.txt) AND binds N (notes-1.txt
// through notes-6.txt + the notes-N.txt input template). The compiler expands
// the family into six task-explicit file items; the single-path run-start
// deriver gates the first member, so `deliveryConditions` widens the terminal
// set with all six — no todo meta-tool needed (it is off on the default harness).
//
// RED-ON-CUT: make `expandBoundTemplate` (capabilities/verify/derive-conditions.ts)
// return undefined — the first test goes red (the 3-of-6 claim is accepted;
// out-4..6 are never written).

const H3_TODO_HEAVY = `Six files in your working directory, notes-1.txt through notes-6.txt, each contain one integer. Track the work as a todo list with one item per file. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish all six.`;

// The text the H3 bench runner actually sends: workdir prefix + absolutized inputs.
const W = "/home/u/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/.bench-run-6hEd5T";
const H3_AS_RUN = `Working directory for this task: ${W}\n\n${H3_TODO_HEAVY.replace(/\bnotes-(\d)\.txt\b/g, `${W}/notes-$1.txt`)}`;

const runBound = (scenario: TestTurn[], maxIterations: number, task: string = H3_TODO_HEAVY) =>
  Effect.runPromise(
    runPass(reactKernel, { task, availableToolSchemas: [FILE_WRITE_SCHEMA] } satisfies KernelInput, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "bound-template-deliverables",
    }).pipe(
      Effect.provide(
        Layer.merge(
          TestLLMServiceLayer(scenario),
          succeedingToolLayer({ written: true }, FILE_WRITE_SCHEMA.parameters),
        ),
      ),
    ),
  );

const writeAll = (paths: readonly string[], match?: string): TestTurn => ({
  ...(match !== undefined ? { match } : {}),
  toolCalls: paths.map((path) => ({ name: "file-write", args: { path, content: "34" } })),
});

describe("bound template deliverables — the task's own binding holds the run to every member", () => {
  it("writes out-1..3, claims done → refused naming ./out-4.txt → writes 4..6 → done", async () => {
    const pass = await runBound(
      [
        writeAll(["./out-1.txt", "./out-2.txt", "./out-3.txt"]),
        { text: "All six files are written; the task is complete." + PAD },
        // Reachable ONLY when the refusal's guidance names the missing member.
        writeAll(["./out-4.txt", "./out-5.txt", "./out-6.txt"], "file \\./out-4\\.txt"),
        { text: "Now all six files exist on disk and the task is complete." + PAD },
      ],
      10,
    );
    expect(wrote(pass.state.steps, "out-4.txt")).toBe(true);
    expect(wrote(pass.state.steps, "out-6.txt")).toBe(true);
    expect(pass.state.status).toBe("done");
    expect(resolveCompletionStatus(pass.state)).toBe("completed");
  });

  it("as the bench runner sends it (absolute inputs): writes out-1..3 to the workdir, claims done → refused naming ./out-4.txt", async () => {
    const pass = await runBound(
      [
        writeAll([`${W}/out-1.txt`, `${W}/out-2.txt`, `${W}/out-3.txt`]),
        { text: "All six files are written; the task is complete." + PAD },
        writeAll([`${W}/out-4.txt`, `${W}/out-5.txt`, `${W}/out-6.txt`], "file \\./out-4\\.txt"),
        { text: "Now all six files exist on disk and the task is complete." + PAD },
      ],
      10,
      H3_AS_RUN,
    );
    expect(wrote(pass.state.steps, "out-6.txt")).toBe(true);
    expect(resolveCompletionStatus(pass.state)).toBe("completed");
  });

  it("writes all six (bare, ./ and absolute path forms) → accepted at once, no veto", async () => {
    const pass = await runBound(
      [
        writeAll([
          "out-1.txt",
          "./out-2.txt",
          "/tmp/h3-work/out-3.txt",
          "out-4.txt",
          "./out-5.txt",
          "/tmp/h3-work/out-6.txt",
        ]),
        { text: "All six files are written; the task is complete." + PAD },
      ],
      6,
    );
    expect(pass.state.status).toBe("done");
    expect(resolveCompletionStatus(pass.state)).toBe("completed");
    expect(pass.state.meta.deliverableDecision?.accepted ?? true).toBe(true);
  });
});

// ── plan-declared: the run's own todo list names the files (h3-todo-heavy shape) ──
//
// The task names its outputs only as a template (out-N.txt, dropped as a
// placeholder), so the contract holds the run to nothing. The run's own todo
// items name them concretely; the round exit declares each named OUTPUT file
// (contract/plan-declared.ts via round-exit.ts) and the terminal gates then
// require write evidence for it — never the item's done/pending status.
//
// RED-ON-CUT: make `roundContract` in capabilities/act/round-exit.ts return
// `snap.state.meta.runContract` unchanged — the first test goes red (the
// 1-of-3 claim is accepted as done; out-2/out-3 are never written).

const TODO_SCHEMA = {
  name: "todo",
  description: "checklist",
  parameters: [
    { name: "action", type: "string", required: true },
    { name: "items", type: "array", required: false },
    { name: "id", type: "number", required: false },
  ],
};

const TEMPLATE_TASK =
  "For each notes-N.txt file, write out-N.txt containing the word done. Track the work as a todo list with one item per file.";

const runTemplate = (scenario: TestTurn[], maxIterations: number, overrides: Partial<KernelInput> = {}) =>
  Effect.runPromise(
    runPass(
      reactKernel,
      {
        task: TEMPLATE_TASK,
        availableToolSchemas: [FILE_WRITE_SCHEMA, TODO_SCHEMA],
        metaTools: { todo: true },
        ...overrides,
      } as KernelInput,
      { maxIterations, strategy: "reactive", kernelType: "react", taskId: "plan-declared-deliverables" },
    ).pipe(
      Effect.provide(
        Layer.merge(
          TestLLMServiceLayer(scenario),
          succeedingToolLayer({ written: true }, FILE_WRITE_SCHEMA.parameters),
        ),
      ),
    ),
  );

const todoAddThenWrite = (titles: readonly string[], path: string): TestTurn => ({
  toolCalls: [
    { name: "todo", args: { action: "add", items: titles } },
    { name: "file-write", args: { path, content: "done" } },
  ],
});

// The todo action's args name the files too, so only a file-write action counts.
const wroteFile = (steps: readonly { type: string; content: string }[], path: string): boolean =>
  steps.some((s) => s.type === "action" && s.content.startsWith("file-write(") && s.content.includes(path));

const planDeclaredIds =(state: { meta: { runContract?: { requirements: readonly { id: string; spec: { source?: string } }[] } } }) =>
  (state.meta.runContract?.requirements ?? []).filter((r) => r.spec.source === "plan-declared").map((r) => r.id);

describe("plan-declared deliverables — the run's own todo list holds it to the files it names", () => {
  it("todo names out-1..3, writes out-1, claims done → refused naming ./out-2.txt → writes 2 and 3 → done", async () => {
    const pass = await runTemplate(
      [
        todoAddThenWrite(
          ["Read notes-1.txt and write out-1.txt", "Read notes-2.txt and write out-2.txt", "Read notes-3.txt and write out-3.txt"],
          "./out-1.txt",
        ),
        { text: "All the files are written; the task is complete." + PAD },
        // Reachable ONLY when the refusal's guidance names the missing item.
        write("./out-2.txt", "file \\./out-2\\.txt"),
        write("./out-3.txt"),
        { text: "Now every file exists on disk and the task is complete." + PAD },
      ],
      10,
    );
    expect(wroteFile(pass.state.steps, "out-2.txt")).toBe(true);
    expect(wroteFile(pass.state.steps, "out-3.txt")).toBe(true);
    expect(pass.state.status).toBe("done");
    expect(resolveCompletionStatus(pass.state)).toBe("completed");
    expect(planDeclaredIds(pass.state)).toEqual(["artifact:./out-1.txt", "artifact:./out-2.txt", "artifact:./out-3.txt"]);
    // The declared lifecycle fact is minted for each plan-declared file.
    const declared = (pass.state.ledger ?? []).flatMap((e) =>
      e.kind === "requirement" && e.status === "declared" ? [e.requirementId] : [],
    );
    expect(declared).toEqual(expect.arrayContaining(["artifact:./out-2.txt", "artifact:./out-3.txt"]));
  });

  it("todo items naming no output file add no requirement — the claim is accepted as before", async () => {
    const pass = await runTemplate(
      [
        todoAddThenWrite(["Process notes-1.txt", "Summarize the notes"], "./out-1.txt"),
        { text: "All the files are written; the task is complete." + PAD },
      ],
      6,
    );
    expect(planDeclaredIds(pass.state)).toEqual([]);
    expect(pass.state.status).toBe("done");
    expect(resolveCompletionStatus(pass.state)).toBe("completed");
  });

  it("seeded prior-turn items declare nothing — only items this run adds count", async () => {
    const pass = await runTemplate(
      [
        write("./out-1.txt"),
        { text: "All the files are written; the task is complete." + PAD },
      ],
      6,
      { initialAdvisory: [{ id: "1", title: "Read notes-9.txt and write out-9.txt", status: "pending" }] },
    );
    expect(planDeclaredIds(pass.state)).toEqual([]);
    expect(pass.state.status).toBe("done");
    expect(resolveCompletionStatus(pass.state)).toBe("completed");
  });
});
