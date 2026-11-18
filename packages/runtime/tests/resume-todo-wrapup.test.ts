/**
 * resume-todo-wrapup.test.ts — a resumed durable run with open todo rows.
 *
 * Probe (zero token, scripted): the model adds todo rows, the run is paused with
 * rows open, `resumeRun` continues it. The kernel's todo wrap-up turn is opt-in
 * (`RA_TODO_WRAPUP=1`); when on it must fire on the resumed run too (the ledger
 * rides the checkpoint), and the resume guidance itself names the open rows so a
 * default-off run still reconciles its list.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/builder.js";
import type { ReactiveAgent } from "../src/reactive-agent.js";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

const pad = (tag: string) => `${tag} ${"lorem ipsum dolor sit amet ".repeat(120)}`;
const FIRST = [
  { toolCall: { name: "todo", args: { action: "add", items: ["gather notes", "write summary"] } } },
  { toolCall: { name: "work", args: { input: pad("a") } } },
  { text: "FINAL ANSWER: done" },
];
const REST = [{ text: "FINAL ANSWER: done" }, { text: "FINAL ANSWER: done" }];

const workTool = (onRun: () => void) => ({
  definition: {
    name: "work",
    description: "Do some work",
    parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: () => { onRun(); return Effect.succeed("work ok"); },
});

const capturing = (script: readonly unknown[], captured: Req[]): Layer.Layer<LLMService> => {
  const base = TestLLMService(script as never);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => { captured.push(r); return base.complete(r); },
      stream: (r) => { captured.push(r); return base.stream(r); },
    }),
  );
};

const agentOf = (dir: string, script: readonly unknown[], captured: Req[], onWork: () => void = () => {}, cap = 12) =>
  ReactiveAgents.create()
    .withName("resume-todo")
    .withProvider("test")
    .withModel("test-model")
    .withReasoning()
    .withTools({ tools: [workTool(onWork)] })
    .withMetaTools({ todo: true })
    .withReplayLLM(capturing(script, captured))
    .withMaxIterations(cap)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .build();

const seen = (reqs: readonly Req[], needle: string): boolean =>
  reqs.some((r) => JSON.stringify([r.systemPrompt, r.messages]).includes(needle));

/** Pause a first run with both rows open, then resume it on a fresh agent; returns what the resumed run's model saw. */
const pauseThenResume = async (
  dir: string,
  shape: { readonly first?: readonly unknown[]; readonly rest?: readonly unknown[]; readonly cap?: number; readonly pauseAtWork?: number } = {},
): Promise<Req[]> => {
  let ref: ReactiveAgent | undefined;
  let paused: Promise<boolean> | undefined;
  let works = 0;
  const a1 = await agentOf(dir, shape.first ?? FIRST, [], () => {
    works++;
    const id = ref?.activeRunIds()[0];
    if (id !== undefined && works === (shape.pauseAtWork ?? 1)) paused = ref?.pauseRun(id);
  }, shape.cap);
  ref = a1;
  const first = await a1.run("Do the two things");
  expect(await paused).toBe(true);
  await a1.dispose();

  const seenOnResume: Req[] = [];
  const a2 = await agentOf(dir, shape.rest ?? REST, seenOnResume, () => {}, shape.cap);
  await a2.resumeRun(first.runId!);
  await a2.dispose();
  return seenOnResume;
};

describe("kernel wrap-up on a resumed run when opted in", () => {
  it("RA_TODO_WRAPUP=1: the ledger rides the checkpoint, so the wrap-up turn fires after resume", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-resume-todo-"));
    process.env.RA_TODO_WRAPUP = "1";
    try {
      const reqs = await pauseThenResume(dir);
      expect(reqs.length).toBe(2);
      expect(seen(reqs, "still open")).toBe(true);
    } finally {
      delete process.env.RA_TODO_WRAPUP;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a resumed run with open todo rows", () => {
  it("names the open rows in the continue guidance (default harness, wrap-up off)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-resume-todo-"));
    try {
      const reqs = await pauseThenResume(dir);
      expect(seen(reqs, "gather notes")).toBe(true);
      expect(seen(reqs, "still open")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
