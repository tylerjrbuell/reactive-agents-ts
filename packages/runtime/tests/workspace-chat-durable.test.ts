// Run: bun test packages/runtime/tests/workspace-chat-durable.test.ts --timeout 20000
//
// Per-run `workspace` beyond run()/runStream():
// - chat turns: `agent.chat(msg, { workspace })`, `session.chat(msg, { workspace })`
//   and `session.runStream(msg, { workspace })` route the turn's directory
//   through the same run entry as run(), so precedence is turn > builder > ambient.
// - durable runs: the per-run workspace is persisted on the run row and a
//   paused run resumed by approveRun() (any process) runs in it again, from
//   both the run() and the runStream() durable paths.
//
// RED-ON-CUT (verified by temporary mutation, reverted):
// - drop `...workspaceCarry(opts?.workspace)` in chat-capabilities.ts
//   turnRunOptions: every chat cell fails (writes land in the builder ws / cwd).
// - drop `...workspaceCarry(payload.run.workspace)` in durable-facade.ts
//   decideAndResumeRun: both durable cells fail (the approved write lands in cwd).
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ReactiveAgents } from "../src/index.js";

const roots: string[] = [];
const strays: string[] = [];
const mkRoot = (tag: string): string => {
  const r = mkdtempSync(join(tmpdir(), `ra-ws-chat-${tag}-`));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const p of strays.splice(0)) rmSync(p, { force: true });
});
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A relative file name that must NOT land in the process cwd. */
const relName = (tag: string): string => {
  const name = `ws-${tag}-${randomUUID()}.ts`;
  strays.push(join(process.cwd(), name));
  return name;
};

const writeAgent = (name: string, opts: { workspace?: string; durableDir?: string } = {}) => {
  let b = ReactiveAgents.create()
    .withName("ws-chat-durable")
    .withProvider("test")
    .withModel("test")
    .withTestScenario([
      { match: "Write", text: "Writing.", toolCall: { name: "file-write", args: { path: name, content: "export {}\n" } } },
      { text: "FINAL ANSWER: done." },
    ] as never)
    .withTools({ builtins: ["file-write"], adaptive: false, ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}) })
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withMaxIterations(4);
  if (opts.durableDir !== undefined) {
    b = b.withDurableRuns({ dir: opts.durableDir, checkpointEvery: 1 }).withApprovalPolicy({ tools: ["file-write"], mode: "detach" });
  }
  return b.build();
};

describe("chat turns accept a per-turn workspace (turn > builder > ambient)", () => {
  it("session.runStream(msg, { workspace }) writes in the turn's workspace, not the builder's", async () => {
    const builderWs = mkRoot("sb");
    const turnWs = mkRoot("st");
    const name = relName("session-stream");
    const agent = await writeAgent(name, { workspace: builderWs });
    try {
      const session = agent.session();
      for await (const _ev of session.runStream(`Write ${name}`, { workspace: turnWs })) {
        // drain
      }
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(turnWs, name))).toBe(true);
    expect(existsSync(join(builderWs, name))).toBe(false);
  }, 20000);

  it("session.chat(msg, { useTools, workspace }) writes in the turn's workspace", async () => {
    const builderWs = mkRoot("cb");
    const turnWs = mkRoot("ct");
    const name = relName("session-chat");
    const agent = await writeAgent(name, { workspace: builderWs });
    try {
      await agent.session().chat(`Write ${name}`, { useTools: true, workspace: turnWs });
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(turnWs, name))).toBe(true);
    expect(existsSync(join(builderWs, name))).toBe(false);
  }, 20000);

  it("agent.chat(msg, { useTools, workspace }) writes in the turn's workspace; without it the builder's wins", async () => {
    const builderWs = mkRoot("ab");
    const turnWs = mkRoot("at");
    const a = relName("agent-chat-a");
    const withTurn = await writeAgent(a, { workspace: builderWs });
    try {
      await withTurn.chat(`Write ${a}`, { useTools: true, workspace: turnWs });
    } finally {
      await withTurn.dispose();
    }
    expect(existsSync(join(turnWs, a))).toBe(true);
    expect(existsSync(join(builderWs, a))).toBe(false);

    const b = relName("agent-chat-b");
    const noTurn = await writeAgent(b, { workspace: builderWs });
    try {
      await noTurn.chat(`Write ${b}`, { useTools: true });
    } finally {
      await noTurn.dispose();
    }
    expect(existsSync(join(builderWs, b))).toBe(true);
  }, 20000);
});

describe("a per-run workspace survives durable pause -> approveRun", () => {
  it("run(task, { workspace }) pauses; approveRun from a fresh agent writes in that workspace", async () => {
    const ws = mkRoot("durable-run");
    const durableDir = mkRoot("durable-run-store");
    const name = relName("durable-run");
    const first = await writeAgent(name, { durableDir });
    let runId: string;
    try {
      const paused = await first.run(`Write ${name}`, { workspace: ws });
      expect(paused.status).toBe("awaiting-approval");
      runId = paused.pendingApproval!.runId;
    } finally {
      await first.dispose();
    }
    expect(existsSync(join(ws, name))).toBe(false);

    // A different process/agent (no workspace option anywhere) approves it.
    const second = await writeAgent(name, { durableDir });
    try {
      const row = (await second.listRuns()).find((r) => r.runId === runId);
      expect(row?.workspace).toBe(ws);
      await second.approveRun(runId);
    } finally {
      await second.dispose();
    }
    expect(existsSync(join(ws, name))).toBe(true);
    expect(existsSync(join(process.cwd(), name))).toBe(false);
  }, 30000);

  it("runStream(task, { workspace }) pauses; approveRun writes in that workspace", async () => {
    const ws = mkRoot("durable-stream");
    const durableDir = mkRoot("durable-stream-store");
    const name = relName("durable-stream");
    const agent = await writeAgent(name, { durableDir });
    try {
      let runId: string | undefined;
      for await (const ev of agent.runStream(`Write ${name}`, { workspace: ws })) {
        if (ev._tag === "StreamCompleted") runId = ev.pendingApproval?.runId;
      }
      expect(runId).toBeDefined();
      expect(existsSync(join(ws, name))).toBe(false);
      await agent.approveRun(runId!);
    } finally {
      await agent.dispose();
    }
    expect(existsSync(join(ws, name))).toBe(true);
    expect(existsSync(join(process.cwd(), name))).toBe(false);
  }, 30000);
});
