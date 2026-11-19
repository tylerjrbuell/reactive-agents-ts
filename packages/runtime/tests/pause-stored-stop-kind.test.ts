/**
 * pause-stored-stop-kind.test.ts — zero-token repro: what stop kind is STORED when a
 * user Pauses / Stops a STREAMING durable run, including when the stream's abort
 * signal fires right after (Cortex: `agent.pauseRun` then the turn's signal aborts).
 *
 * Cortex reported "Stopped by you" on the Continue card after a Pause. Suspect:
 * execute-stream.ts abort listener calls `durableInstalled.interrupt("user-stopped")`
 * when the producer fiber is not yet ended, overwriting `user-paused`.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import type { ReactiveAgent } from "../src/reactive-agent.js";
import type { RunRecord } from "../src/services/run-store.js";

const toolDef = (name: string) => ({
  name,
  description: `Tool ${name}`,
  parameters: [{ name: "q", type: "string" as const, description: "Input", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
});

const SCRIPT = [
  { toolCall: { name: "read-tool", args: { q: "a" } } },
  { toolCall: { name: "write-tool", args: { q: "notes" } } },
  { text: "FINAL ANSWER: ships 2026-03-01." },
];

const agentOf = (dir: string, onRead: () => void) =>
  ReactiveAgents.create()
    .withName("pause-kind-subject")
    .withSystemPrompt("You research then write.")
    .withTestScenario(SCRIPT as never)
    .withTools({
      tools: [
        { definition: toolDef("read-tool"), handler: () => { onRead(); return Effect.succeed("note: ships 2026-03-01"); } },
        { definition: toolDef("write-tool"), handler: () => Effect.succeed("wrote notes.md") },
      ],
    })
    .withReasoning()
    .withMaxIterations(12)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .build();

const rowOf = async (agent: ReactiveAgent, runId: string): Promise<RunRecord | undefined> =>
  (await agent.listRuns()).find((r) => r.runId === runId);

const settle = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Step = (agent: ReactiveAgent, runId: string, abort: () => void) => void;

/** Stream a durable run; at the first tool call, drive `step`; return the stored row. */
const drive = async (step: Step): Promise<{ row: RunRecord | undefined; pending: Promise<unknown> }> => {
  const dir = mkdtempSync(join(tmpdir(), "ra-pause-kind-"));
  try {
    const ctl = new AbortController();
    let ref: ReactiveAgent | undefined;
    let runId: string | undefined;
    let pending: Promise<unknown> = Promise.resolve();
    let fired = false;
    const agent = await agentOf(dir, () => {
      if (fired) return;
      fired = true;
      const id = runId ?? ref?.activeRunIds()[0];
      if (id === undefined) throw new Error("no live run");
      const before = ref!;
      step(before, id, () => ctl.abort());
      pending = Promise.resolve();
    });
    ref = agent;
    const h = agent.runStream("Find the release date", { signal: ctl.signal, onRunId: (id) => { runId = id; } });
    for await (const _ of h) { /* drain to the terminal event */ }
    await settle();
    const row = runId !== undefined ? await rowOf(agent, runId) : undefined;
    await agent.dispose();
    return { row, pending };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("stored stop kind of a streamed durable run", () => {
  it("1. pauseRun on a live stream (no abort): paused / user-paused", async () => {
    const { row } = await drive((agent, id) => { void agent.pauseRun(id); });
    expect(row?.status).toBe("paused");
    expect(row?.stop?.kind).toBe("user-paused");
  }, 30_000);

  it("2a. pauseRun, then abort the stream signal once the pause is persisted (Cortex order): paused / user-paused", async () => {
    const { row } = await drive((agent, id, abort) => { void agent.pauseRun(id).then(() => abort()); });
    expect(row?.status).toBe("paused");
    expect(row?.stop?.kind).toBe("user-paused");
  }, 30_000);

  // KNOWN DEFECT (observed: status "stopped", stop.kind "user-stopped"). The abort listener in
  // engine/execute-stream.ts (~L819-830) sees the producer fiber not yet ended and calls
  // `durableInstalled.interrupt("user-stopped", "terminated")`, ignoring the controller's
  // `requestedStop()` ("user-paused"). Cortex hits it when interruptLiveRun's grace times out
  // ("pending") and the turn is aborted while pauseRun is still waiting for the iteration boundary.
  // Remove `.failing` when the listener uses `requestedStop() ?? "user-stopped"`.
  it.failing("2b. pauseRun, then abort the signal before the pause is persisted (Cortex grace-timeout order): paused / user-paused", async () => {
    const { row } = await drive((agent, id, abort) => { void agent.pauseRun(id); abort(); });
    expect(row?.status).toBe("paused");
    expect(row?.stop?.kind).toBe("user-paused");
  }, 30_000);

  it("3. abort the signal first, then pauseRun: the abort wins (stopped / user-stopped), still resumable", async () => {
    const { row } = await drive((agent, id, abort) => { abort(); void agent.pauseRun(id); });
    expect(row?.resumable).toBe(true);
    expect(row?.status).toBe("stopped");
    expect(row?.stop?.kind).toBe("user-stopped");
  }, 30_000);

  it("4. stopRun on a live stream: stopped / user-stopped", async () => {
    const { row } = await drive((agent, id) => { void agent.stopRun(id); });
    expect(row?.status).toBe("stopped");
    expect(row?.stop?.kind).toBe("user-stopped");
  }, 30_000);
});
