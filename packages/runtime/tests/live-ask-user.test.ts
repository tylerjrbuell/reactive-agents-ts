// Run: bun test packages/runtime/tests/live-ask-user.test.ts --timeout 30000
//
// Live ask-user (2026-11-11): `.withUserInteraction()` no longer needs
// `.withDurableRuns()`. Without a durable store a `request_user_input`
// question waits LIVE on the agent's human gate: the stream shows
// `InteractionRequested`, `listPendingInteractions()` lists it, and
// `respondToInteraction` answers it; the answer becomes the tool result and
// the SAME run continues. Waits are bounded by `timeoutMs` (approvals and
// questions), and `.withName()` labels the run.
//
// Pins (test provider, no durable store):
//   A1 build: withUserInteraction without durable builds.
//   A2 runStream: InteractionRequested, respondToInteraction mid-run, the same
//      stream completes with the answer (no pause), respond resolves with that result.
//   A3 run(): listPendingInteractions shows the wait; the answer resolves run().
//   A4 withUserInteraction({ timeoutMs }): no answer -> the model reads an honest
//      "did not answer" and the run continues.
//   A5 approvalPolicy.timeoutMs: a live detach wait nobody answers denies the
//      call; an onApprove callback that never decides is denied the same way.
//   A6 toConfig/fromConfig keeps both timeouts.
//   N1 .withName() reaches AgentStarted.agentDisplayName; no name -> the id.
//
// Red-on-cut:
//   - drop `askUser` in run-envelope-config.ts -> A2/A3 never see a live
//     request (the kernel pauses with no store).
//   - drop the interaction default in human-gate.ts `ask` -> A4 hangs to its timeout.
//   - drop `withDecisionTimeout` -> A5's onApprove case hangs.
//   - drop `agentDisplayName` in build-effect.ts -> N1 sees the id.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

const askScenario = [
  {
    toolCall: {
      name: "request_user_input",
      args: { kind: "choice", prompt: "Which option?", schema: { options: ["red", "blue"] } },
    },
  },
  { match: "did not answer", text: "No answer arrived, so I stopped. FINAL." },
  { match: "blue", text: "You picked blue. FINAL." },
  { text: "fallback" },
];

function askAgent(timeoutMs?: number) {
  return ReactiveAgents.create()
    .withName("live-ask")
    .withProvider("test")
    .withTestScenario(askScenario as never)
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withMaxIterations(4)
    .withUserInteraction(timeoutMs !== undefined ? { timeoutMs } : undefined)
    .build();
}

type Agent = Awaited<ReturnType<typeof askAgent>>;

async function waitForInteraction(agent: Agent, ms = 10_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const pending = await agent.listPendingInteractions();
    if (pending.length > 0) return pending;
    await new Promise((r) => setTimeout(r, 20));
  }
  return [];
}

describe("live ask-user: request_user_input without durable runs", () => {
  it("A1 withUserInteraction without durable builds", async () => {
    const agent = await askAgent();
    await agent.dispose();
  }, 30_000);

  it("A2 runStream: answered mid-run, the same stream completes with the answer", async () => {
    const agent = await askAgent();
    const events: AgentStreamEvent[] = [];
    const answers: Promise<{ output: string }>[] = [];
    try {
      for await (const e of agent.runStream("help me choose")) {
        events.push(e);
        if (e._tag === "InteractionRequested") {
          expect(e.kind).toBe("choice");
          expect(e.prompt).toBe("Which option?");
          answers.push(agent.respondToInteraction(e.runId, e.interactionId, "blue"));
        }
      }
      expect(events.filter((e) => e._tag === "InteractionRequested").length).toBe(1);
      const done = events.at(-1);
      expect(done?._tag).toBe("StreamCompleted");
      if (done?._tag !== "StreamCompleted") return;
      expect(done.status).toBeUndefined(); // never paused
      expect(done.output).toContain("blue");
      const [answered] = await Promise.all(answers);
      expect(answered?.output).toBe(done.output);
      expect(await agent.listPendingInteractions()).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("A3 run(): the pending question is listed and the answer resolves run()", async () => {
    const agent = await askAgent();
    try {
      const running = agent.run("help me choose");
      const pending = await waitForInteraction(agent);
      expect(pending.length).toBe(1);
      expect(pending[0]!.prompt).toBe("Which option?");
      await agent.respondToInteraction(pending[0]!.runId, pending[0]!.interactionId, "blue");
      const result = await running;
      expect(result.success).toBe(true);
      expect(result.output).toContain("blue");
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("A4 timeoutMs: an unanswered question reads as 'did not answer' and the run continues", async () => {
    const agent = await askAgent(150);
    try {
      const result = await agent.run("help me choose");
      expect(result.output).toContain("No answer arrived");
      expect(await agent.listPendingInteractions()).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);
});

function approvalAgent(
  onExecute: () => void,
  policy: { mode?: "detach" | "block"; timeoutMs: number; onApprove?: () => Promise<boolean> },
) {
  return ReactiveAgents.create()
    .withName("live-approval-timeout")
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
    .withApprovalPolicy({ tools: ["risky-tool"], ...policy })
    .build();
}

describe("approval timeoutMs", () => {
  it("A5a a live detach wait nobody answers is denied after timeoutMs", async () => {
    let executed = 0;
    const agent = await approvalAgent(() => void (executed += 1), { mode: "detach", timeoutMs: 150 });
    try {
      const result = await agent.run("do the risky thing");
      expect(executed).toBe(0);
      expect(result.output).toBeDefined();
      expect(await agent.listPendingApprovals()).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("A5b an onApprove callback that never decides is denied after timeoutMs", async () => {
    let executed = 0;
    const agent = await approvalAgent(() => void (executed += 1), {
      mode: "block",
      timeoutMs: 150,
      onApprove: () => new Promise<boolean>(() => {}),
    });
    try {
      await agent.run("do the risky thing");
      expect(executed).toBe(0);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("A6 toConfig/fromConfig keep the approval and question timeouts", async () => {
    const config = ReactiveAgents.create()
      .withName("cfg")
      .withUserInteraction({ timeoutMs: 1_000 })
      .withApprovalPolicy({ tools: ["x"], mode: "block", timeoutMs: 2_000 })
      .toConfig();
    expect(config.userInteraction).toEqual({ timeoutMs: 1_000 });
    expect(config.approvalPolicy?.timeoutMs).toBe(2_000);
    const again = (await ReactiveAgents.fromConfig(config)).toConfig();
    expect(again.userInteraction).toEqual({ timeoutMs: 1_000 });
    expect(again.approvalPolicy?.timeoutMs).toBe(2_000);
    expect(ReactiveAgents.create().withUserInteraction().toConfig().userInteraction).toBe(true);
  });
});

describe("display name", () => {
  async function startedOf(builder: ReturnType<typeof ReactiveAgents.create>) {
    const agent = await builder.withProvider("test").withTestScenario([{ text: "ok" }]).build();
    const events: AgentEvent[] = [];
    const unsub = await agent.subscribe((e) => void events.push(e));
    try {
      await agent.run("hi");
    } finally {
      unsub();
      await agent.dispose();
    }
    const started = events.find((e) => e._tag === "AgentStarted");
    if (started?._tag !== "AgentStarted") throw new TypeError("no AgentStarted");
    return started;
  }

  it("N1 .withName() is the run's display name; without a name the id is shown", async () => {
    const named = await startedOf(ReactiveAgents.create().withName("Researcher"));
    expect(named.agentDisplayName).toBe("Researcher");
    expect(named.agentId).not.toBe("Researcher"); // the id stays uniquified
    const unnamed = await startedOf(ReactiveAgents.create());
    expect(unnamed.agentDisplayName).toBe(unnamed.agentId);
  }, 30_000);
});
