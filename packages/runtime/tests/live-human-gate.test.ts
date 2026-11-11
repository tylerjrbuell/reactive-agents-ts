// Run: bun test packages/runtime/tests/live-human-gate.test.ts --timeout 30000
//
// Live human gate (2026-11-11): tool approval no longer needs `.withDurableRuns()`.
// `.withApprovalPolicy({ mode: "detach" })` on a NON-durable agent used to fail
// the build ("requires .withDurableRuns()"), so a normal chat/desk run could not
// ask a person anything. Now the run waits IN PROCESS at the gate
// (engine/human-gate.ts): the stream shows `ApprovalRequested`, and
// `approveRun` / `denyRun` resolve the same run, which continues on the same
// stream. Durable runs stay the cross-process / crash-surviving backend.
//
// Pins (behavioral, `test` provider, no durable store anywhere in this file):
//   L1 build: detach without durable builds.
//   L2 runStream + approveRun: the gated tool runs, the stream continues to
//      StreamCompleted (no pause status), approveRun resolves with that run's result.
//   L3 runStream + denyRun: the gated tool never runs, the run still completes.
//   L4 run() (no stream): listPendingApprovals shows the live wait; approveRun
//      releases it and run() resolves.
//   L5 terminate() while waiting: the stream ends cancelled, the tool never ran,
//      nothing is left pending.
//   L6 stop() while waiting: the wait is abandoned (denied), the run ends.
//   L7 approveRun on a run nobody is waiting on rejects (no durable fallback).
//   L8 run(task, { onApproval }) answers the live wait itself (was a hang).
//
// Red-on-cut:
//   - drop the live branch in run-envelope-config.ts (`approvalWaitsLive`) -> the
//     kernel pauses with no store: L2/L3/L4 never see ApprovalRequested.
//   - drop `answerLive` in durable-facade.ts -> L2/L3/L4 reject (no durable store).
//   - drop `runEnded` in human-gate.ts -> L6 hangs past its timeout.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

function makeAgent(onExecute: () => void, name = "live-gate") {
  return ReactiveAgents.create()
    .withName(name)
    .withProvider("test")
    .withTestScenario([
      { toolCall: { name: "risky-tool", args: { input: "go" } } },
      { text: "FINAL ANSWER: done" },
    ] as never)
    .withTools({
      tools: [
        {
          definition: {
            name: "risky-tool",
            description: "Mutates state, requires approval.",
            parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
            riskLevel: "high" as const,
            requiresApproval: true,
            timeoutMs: 5_000,
            source: "function" as const,
          },
          handler: () =>
            Effect.sync(() => {
              onExecute();
              return "ran";
            }),
        },
      ],
    })
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(4)
    .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
    .build();
}

type Agent = Awaited<ReturnType<typeof makeAgent>>;

/** Drain a stream, answering every live approval request with `decide`. */
async function drive(
  agent: Agent,
  decide: (runId: string) => Promise<unknown>,
): Promise<{ events: AgentStreamEvent[]; answers: Promise<unknown>[] }> {
  const events: AgentStreamEvent[] = [];
  const answers: Promise<unknown>[] = [];
  for await (const event of agent.runStream("do the risky thing")) {
    events.push(event);
    if (event._tag === "ApprovalRequested") answers.push(decide(event.runId));
  }
  return { events, answers };
}

async function waitForPending(agent: Agent, ms = 10_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const pending = await agent.listPendingApprovals();
    if (pending.length > 0) return pending;
    await new Promise((r) => setTimeout(r, 20));
  }
  return [];
}

describe("live human gate: approvals without durable runs", () => {
  it("L1 detach without durable builds (no durable store required)", async () => {
    const agent = await makeAgent(() => {});
    await agent.dispose();
  }, 30_000);

  it("L2 runStream + approveRun: the tool runs and the SAME stream completes", async () => {
    let executed = 0;
    const agent = await makeAgent(() => {
      executed += 1;
    });
    try {
      const { events, answers } = await drive(agent, (runId) => agent.approveRun(runId));
      const requested = events.filter((e) => e._tag === "ApprovalRequested");
      expect(requested.length).toBeGreaterThan(0);
      const first = requested[0];
      if (first?._tag !== "ApprovalRequested") throw new TypeError("unreachable");
      expect(first.toolName).toBe("risky-tool");
      expect(first.args).toEqual({ input: "go" });
      expect(executed).toBeGreaterThan(0);
      const done = events.at(-1);
      expect(done?._tag).toBe("StreamCompleted");
      if (done?._tag !== "StreamCompleted") return;
      expect(done.status).toBeUndefined(); // never paused
      // approveRun resolves with the run's own final result.
      const results = (await Promise.all(answers)) as Array<{ output: string; taskId: string }>;
      expect(results[0]?.output).toBe(done.output);
      expect(results[0]?.taskId).toBe(first.runId);
      expect(await agent.listPendingApprovals()).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("L3 runStream + denyRun: the tool never runs, the run still completes", async () => {
    let executed = 0;
    const agent = await makeAgent(() => {
      executed += 1;
    });
    try {
      const { events, answers } = await drive(agent, (runId) => agent.denyRun(runId, "not today"));
      expect(events.some((e) => e._tag === "ApprovalRequested")).toBe(true);
      expect(executed).toBe(0);
      expect(events.at(-1)?._tag).toBe("StreamCompleted");
      await Promise.all(answers);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("L4 run() without a stream: the wait is listed, approveRun releases it", async () => {
    let executed = 0;
    const agent = await makeAgent(() => {
      executed += 1;
    });
    try {
      const running = agent.run("do the risky thing");
      const answers: Promise<unknown>[] = [];
      let settled = false;
      void running.finally(() => {
        settled = true;
      });
      // Answer every wait until the run ends (the scenario may ask more than once).
      while (!settled) {
        const pending = await waitForPending(agent, 200);
        for (const p of pending) {
          expect(p.toolName).toBe("risky-tool");
          expect(p.task).toContain("do the risky thing");
          answers.push(agent.approveRun(p.runId));
        }
      }
      const result = await running;
      expect(executed).toBeGreaterThan(0);
      expect(result.status).toBeUndefined();
      expect(answers.length).toBeGreaterThan(0);
      const fromApprove = (await answers[0]) as { output: string };
      expect(fromApprove.output).toBe(result.output);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("L5 terminate() while waiting: cancelled, tool never ran, nothing left pending", async () => {
    let executed = 0;
    const agent = await makeAgent(() => {
      executed += 1;
    });
    try {
      const handle = agent.runStream("do the risky thing");
      const events: AgentStreamEvent[] = [];
      for await (const event of handle) {
        events.push(event);
        if (event._tag === "ApprovalRequested") handle.terminate();
      }
      expect(events.some((e) => e._tag === "ApprovalRequested")).toBe(true);
      expect(events.at(-1)?._tag).toBe("StreamCancelled");
      expect(executed).toBe(0);
      expect(await agent.listPendingApprovals()).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("L6 stop() while waiting: the wait is abandoned (denied) and the run ends", async () => {
    let executed = 0;
    const agent = await makeAgent(() => {
      executed += 1;
    });
    try {
      const handle = agent.runStream("do the risky thing");
      const events: AgentStreamEvent[] = [];
      for await (const event of handle) {
        events.push(event);
        if (event._tag === "ApprovalRequested") handle.stop();
      }
      expect(events.some((e) => e._tag === "ApprovalRequested")).toBe(true);
      const last = events.at(-1)?._tag;
      expect(last === "StreamCompleted" || last === "StreamCancelled").toBe(true);
      expect(executed).toBe(0);
      expect(await agent.listPendingApprovals()).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("L8 run(task, { onApproval }) answers the live wait (approve runs, deny refuses)", async () => {
    let executed = 0;
    const agent = await makeAgent(() => {
      executed += 1;
    });
    try {
      const asked: string[] = [];
      const approved = await agent.run("do the risky thing", {
        onApproval: ({ toolName }) => {
          asked.push(toolName);
          return true;
        },
      });
      expect(asked[0]).toBe("risky-tool");
      expect(executed).toBeGreaterThan(0);
      expect(approved.status).toBeUndefined();

      executed = 0;
      await agent.run("do the risky thing", { onApproval: () => ({ approve: false, reason: "no" }) });
      expect(executed).toBe(0);
      expect(await agent.listPendingApprovals()).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("L7 approveRun on a run nobody is waiting on rejects (no durable store to fall back to)", async () => {
    const agent = await makeAgent(() => {});
    try {
      const err = await agent.approveRun("no-such-run").then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toMatchObject({ _tag: "ApprovalStateError", runId: "no-such-run" });
      expect(String((err as { detail?: unknown }).detail)).toContain(
        "no run with this id is waiting for a decision",
      );
    } finally {
      await agent.dispose();
    }
  }, 30_000);
});
