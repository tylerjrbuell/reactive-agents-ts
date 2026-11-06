// Run: bun test packages/runtime/tests/run-evidence-pause-outcome.test.ts --timeout 20000
//
// Three result-surface contracts:
// 1. AgentResult.evidenceDelta is the run's own sum of AssessmentEmitted
//    evidenceDelta (root task only), on run(), on runStream()'s StreamCompleted
//    (and AgentStream.collect), and on a tool-path ChatReply; goalRunOf()
//    prefers it over re-summing events.
// 2. A durable run paused for approval is not a successful end_turn: run() and
//    runStream() both report status "awaiting-approval", success false, no
//    terminatedBy, and the pending gate.
// 3. A tool-path ChatReply carries the run's goalAchieved and
//    outstandingCriteria, so a goal supervisor can honor the exit gate.
//
// RED-ON-CUT (verified by temporary mutation, reverted):
// - drop the AssessmentEmitted subscription in execute-event-collectors.ts:
//   the evidence cells fail (evidenceDelta undefined).
// - make terminalOutcomeFields ignore `paused`: both pause cells fail
//   (success true, terminatedBy "end_turn").
// - drop the goalAchieved/outstandingCriteria spreads in chat/tool-reply.ts:
//   the ChatReply cells fail.
import { afterAll, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@reactive-agents/core";
import { AgentStream, ReactiveAgents, goalRunOf } from "../src/index.js";
import type { AgentResult } from "../src/index.js";
import { assembleToolReply } from "../src/chat/tool-reply.js";

const roots: string[] = [];
const mkRoot = (tag: string): string => {
  const r = mkdtempSync(join(tmpdir(), `ra-evidence-${tag}-`));
  roots.push(r);
  return r;
};
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const readAgent = (durableDir?: string) => {
  let b = ReactiveAgents.create()
    .withName("evidence-agent")
    .withProvider("test")
    .withModel("test")
    .withTestScenario([
      { match: "Echo", text: "Echoing.", toolCall: { name: "echo-tool", args: { input: "hello" } } },
      { text: "FINAL ANSWER: hello." },
    ] as never)
    .withTools({
      adaptive: false,
      tools: [
        {
          definition: {
            name: "echo-tool",
            description: "Echo the input back",
            parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
            riskLevel: "low" as const,
            timeoutMs: 5_000,
            requiresApproval: false,
            source: "function" as const,
          },
          handler: (args: Record<string, unknown>) => Effect.succeed(`echo:${String(args.input)}`),
        },
      ],
    })
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withMaxIterations(4);
  if (durableDir !== undefined) {
    b = b.withDurableRuns({ dir: durableDir, checkpointEvery: 1 }).withApprovalPolicy({ tools: ["echo-tool"], mode: "detach" });
  }
  return b.build();
};

/** Sum of the root task's AssessmentEmitted deltas, observed off the bus. */
const watchEvidence = async (agent: Awaited<ReturnType<typeof readAgent>>) => {
  const events: { taskId: string; evidenceDelta: number }[] = [];
  await agent.subscribe((e: AgentEvent) => {
    if (e._tag === "AssessmentEmitted") events.push({ taskId: String(e.taskId), evidenceDelta: e.evidenceDelta });
  });
  return (taskId: string) => {
    const mine = events.filter((e) => e.taskId === taskId);
    return { count: mine.length, sum: mine.reduce((n, e) => n + e.evidenceDelta, 0) };
  };
};

describe("AgentResult.evidenceDelta: the run's summed assessment evidence", () => {
  it("run(): equals the root task's AssessmentEmitted sum, and goalRunOf(result) uses it", async () => {
    const agent = await readAgent();
    const seen = await watchEvidence(agent);
    let result: AgentResult;
    try {
      result = await agent.run("Echo hello with the tool");
    } finally {
      await agent.dispose();
    }
    const observed = seen(result.taskId);
    expect(observed.count).toBeGreaterThan(0);
    expect(result.evidenceDelta).toBe(observed.sum);
    expect(observed.sum).toBeGreaterThan(0);
    // The result total wins over a (here deliberately wrong) event list.
    expect(goalRunOf(result, [{ _tag: "AssessmentEmitted", evidenceDelta: 999 }]).evidenceDelta).toBe(observed.sum);
  }, 20000);

  it("runStream(): StreamCompleted and AgentStream.collect carry the same total", async () => {
    const agent = await readAgent();
    const seen = await watchEvidence(agent);
    try {
      const collected = await AgentStream.collect(agent.runStream("Echo hello with the tool"));
      const observed = seen(collected.taskId);
      expect(observed.count).toBeGreaterThan(0);
      expect(collected.evidenceDelta).toBe(observed.sum);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("a tool-path ChatReply carries evidenceDelta and goalAchieved", async () => {
    const agent = await readAgent();
    try {
      const reply = await agent.session().chat("Echo hello with the tool", { useTools: true });
      expect(typeof reply.evidenceDelta).toBe("number");
      expect(reply.evidenceDelta).toBeGreaterThan(0);
      expect(reply.goalAchieved === null || typeof reply.goalAchieved === "boolean").toBe(true);
      expect("goalAchieved" in reply).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 20000);
});

describe("a durable pause is not a successful end_turn (run() and runStream() agree)", () => {
  it("run(): status awaiting-approval, success false, no terminatedBy", async () => {
    const agent = await readAgent(mkRoot("pause-run"));
    try {
      const r = await agent.run("Echo hello with the tool");
      expect(r.status).toBe("awaiting-approval");
      expect(r.pendingApproval?.toolName).toBe("echo-tool");
      expect(r.success).toBe(false);
      expect(r.terminatedBy).toBeUndefined();
      expect(r.receipt).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("runStream(): the paused StreamCompleted carries status + pendingApproval, success false, no terminatedBy", async () => {
    const agent = await readAgent(mkRoot("pause-stream"));
    try {
      let completed: Extract<import("../src/index.js").AgentStreamEvent, { _tag: "StreamCompleted" }> | undefined;
      for await (const ev of agent.runStream("Echo hello with the tool")) {
        if (ev._tag === "StreamCompleted") completed = ev;
      }
      expect(completed?.status).toBe("awaiting-approval");
      expect(completed?.pendingApproval?.toolName).toBe("echo-tool");
      expect(completed?.success).toBe(false);
      expect(completed?.terminatedBy).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("CONTROL: a terminal stream still reports success true with its terminatedBy", async () => {
    const agent = await readAgent();
    try {
      const r = await AgentStream.collect(agent.runStream("Echo hello with the tool"));
      expect(r.success).toBe(true);
      expect(r.terminatedBy).toBeDefined();
      expect(r.status).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  }, 20000);
});

describe("assembleToolReply: the run's done/progress verdict rides on the ChatReply", () => {
  const base: AgentResult = {
    output: "partial",
    success: true,
    taskId: "t",
    agentId: "a",
    metadata: { duration: 1, cost: 0, tokensUsed: 1, stepsCount: 1 },
  };

  it("copies goalAchieved, metadata.outstandingCriteria and evidenceDelta; goalRunOf(reply) reads them", () => {
    const reply = assembleToolReply(
      { ...base, goalAchieved: false, evidenceDelta: 0, metadata: { ...base.metadata, outstandingCriteria: ["req-1"] } },
      {},
      {},
    );
    expect(reply.goalAchieved).toBe(false);
    expect(reply.outstandingCriteria).toEqual(["req-1"]);
    expect(reply.evidenceDelta).toBe(0);
    expect(goalRunOf(reply)).toEqual({ goalAchieved: false, outstanding: ["req-1"], evidenceDelta: 0 });
  });

  it("omits the fields when the run did not report them", () => {
    const reply = assembleToolReply(base, {}, {});
    expect("goalAchieved" in reply).toBe(false);
    expect("outstandingCriteria" in reply).toBe(false);
    expect("evidenceDelta" in reply).toBe(false);
  });
});
