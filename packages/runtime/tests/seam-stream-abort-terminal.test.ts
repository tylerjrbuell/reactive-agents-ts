// Run: bun test packages/runtime/tests/seam-stream-abort-terminal.test.ts --timeout 20000
//
// Seam pin (engine/stream-abort-terminal.ts): a runStream aborted by its
// signal publishes exactly one terminal bus event, `ExecutionCancelled` with
// the run's taskId (2026-11-10 review: before, an aborted stream published no
// AgentCompleted / ExecutionCancelled / TaskFailed, so every bus consumer saw
// the run as live forever). A run that already ended normally publishes none.
//
// Cells:
//   (a) abort mid-run: one ExecutionCancelled, taskId = AgentStreamStarted's,
//       and no AgentCompleted.
//   (b) a run that completes normally, then the signal aborts: no
//       ExecutionCancelled (no duplicate terminal).
//   (c) breaking out of the stream early (the generator terminates the run):
//       one ExecutionCancelled.
//
// RED-ON-CUT (verified by temporary mutation, 2026-11-10): dropping the
// `publishIfOpen` call in execute-stream.ts's abort listener fails (a) and
// (c); dropping the settled check in `publishIfOpen` (always publish) fails (b).
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/index.js";

type Agent = Awaited<ReturnType<ReturnType<typeof ReactiveAgents.create>["build"]>>;

const TERMINAL_TAGS = new Set(["AgentCompleted", "ExecutionCancelled", "TaskFailed"]);

const build = (turns: unknown[]): Promise<Agent> =>
  ReactiveAgents.create()
    .withName("abort-terminal")
    .withProvider("test")
    .withModel("test")
    .withTestScenario(turns as never)
    .withMaxIterations(3)
    .build();

/** Bus events of interest for the root run: AgentStreamStarted + terminals. */
const record = async (agent: Agent): Promise<{ started: string[]; terminals: AgentEvent[] }> => {
  const started: string[] = [];
  const terminals: AgentEvent[] = [];
  await agent.subscribe((e: AgentEvent) => {
    if (e._tag === "AgentStreamStarted") started.push(String(e.taskId));
    if (TERMINAL_TAGS.has(e._tag)) terminals.push(e);
  });
  return { started, terminals };
};

const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

const taskIdOf = (e: AgentEvent): string => ("taskId" in e ? String(e.taskId) : "");

describe("runStream abort publishes one terminal bus event", () => {
  it("(a) abort mid-run: exactly one ExecutionCancelled with the run's taskId", async () => {
    const agent = await build([{ text: "FINAL ANSWER: slow.", delayMs: 3000 }]);
    try {
      const { started, terminals } = await record(agent);
      const ctl = new AbortController();
      const tags: string[] = [];
      setTimeout(() => ctl.abort(), 100);
      for await (const ev of agent.runStream("slow task", { signal: ctl.signal })) tags.push(ev._tag);
      await settle();
      expect(tags).toContain("StreamCancelled");
      expect(started.length).toBe(1);
      const cancelled = terminals.filter((e) => e._tag === "ExecutionCancelled");
      expect(cancelled.length).toBe(1);
      expect(taskIdOf(cancelled[0]!)).toBe(started[0]!);
      expect(terminals.filter((e) => e._tag === "AgentCompleted" && taskIdOf(e) === started[0]).length).toBe(0);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(b) a normally completed run publishes no ExecutionCancelled, even when the signal aborts after", async () => {
    const agent = await build([{ text: "FINAL ANSWER: quick." }]);
    try {
      const { started, terminals } = await record(agent);
      const ctl = new AbortController();
      const tags: string[] = [];
      for await (const ev of agent.runStream("quick task", { signal: ctl.signal })) tags.push(ev._tag);
      ctl.abort();
      await settle();
      expect(tags).toContain("StreamCompleted");
      expect(terminals.filter((e) => e._tag === "ExecutionCancelled").length).toBe(0);
      expect(terminals.filter((e) => e._tag === "AgentCompleted" && taskIdOf(e) === started[0]).length).toBe(1);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(c) breaking out of the stream early ends the run with one ExecutionCancelled", async () => {
    const agent = await build([{ text: "FINAL ANSWER: slow.", delayMs: 3000 }]);
    try {
      const { started, terminals } = await record(agent);
      for await (const _ev of agent.runStream("slow task")) break;
      await settle();
      const cancelled = terminals.filter((e) => e._tag === "ExecutionCancelled");
      expect(cancelled.length).toBe(1);
      expect(taskIdOf(cancelled[0]!)).toBe(started[0]!);
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
