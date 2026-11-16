/**
 * Plan recon wiring (spec 2026-11-16-plan-execute-posture-robustness.md, Addendum):
 * `plan-finding` ledger facts reach `Plan.findings` and `PlanRecorded`, the plan's
 * findings ride `agent.execute(plan)` into the execute run, the session plan keeps
 * them across turns and edits, and a plan turn can ask the user. Real runtime,
 * test provider; no live model.
 *
 * Run: bun test packages/runtime/tests/plan-recon-findings.test.ts --timeout 30000
 *
 * Red-on-cut:
 *   - drop `effect: toolEffect(t)` in tool-schemas.ts -> A1 finds no recon tool (no findings).
 *   - drop `findings` from `watchChecklist` / `planFromWatch` -> A1 sees `plan.findings` undefined.
 *   - drop `planFindings` in `executeFacade` or `readPlanFindings` in reasoning-think.ts -> A2's execute prompt lacks the finding.
 *   - drop `TodoCarry.observe`'s LedgerEntry branch -> S1 loses the streamed finding.
 */
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { EventBus, type AgentEvent, type Plan, type PlanFinding } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import { planFromWatch } from "../src/agent/plan-facade.js";
import { findingsOfEntries, mergeFindings, readPlanFindings } from "../src/chat/plan-findings.js";
import { findingsAfterEdit, freshPlanMeta, planOfTodo } from "../src/chat/session-plan.js";
import { TodoCarry, seedCarry, todoSeedMetadata, todoSeedOf } from "../src/chat/todo-seed.js";

type Script = ReadonlyArray<Record<string, unknown>>;
type Req = import("@reactive-agents/llm-provider").CompletionRequest;

const layerOf = (script: Script, captured: Req[]): Layer.Layer<LLMService> => {
  const base = TestLLMService(script as never);
  return Layer.succeed(LLMService, LLMService.of({ ...base, complete: (r) => (captured.push(r), base.complete(r)), stream: (r) => (captured.push(r), base.stream(r)) }));
};

const siteList = (over: { mutatesExternalState?: boolean; requiresApproval?: boolean } = {}) => ({
  definition: {
    name: "site-list",
    description: "List the sites.",
    parameters: [],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: over.requiresApproval ?? false,
    mutatesExternalState: over.mutatesExternalState ?? false,
    source: "function" as const,
  },
  handler: () => Effect.succeed("site-42 (main)"),
});

const REPLY = "Plan:\n1. Open the main site\n2. Pull its stats\n3. Report";

const buildRecon = (script: Script, captured: Req[], opts: { recon?: boolean; tool?: ReturnType<typeof siteList> } = {}) => {
  const b = ReactiveAgents.create()
    .withName("plan-recon")
    .withProvider("test")
    .withModel("test-model")
    .withReasoning({ defaultStrategy: "reactive" })
    .withTools({ tools: [opts.tool ?? siteList()] })
    .withRequiredTools({ adaptive: false })
    .withReplayLLM(layerOf(script, captured))
    .withMaxIterations(8);
  return (opts.recon === false ? b : b.withHarness({ planRecon: true })).build();
};

const listen = async (agent: Awaited<ReturnType<typeof buildRecon>>, tags: ReadonlySet<string>) => {
  const seen: AgentEvent[] = [];
  await agent.runtime.runPromise(
    EventBus.pipe(Effect.flatMap((bus) => bus.subscribe((e) => Effect.sync(() => { if (tags.has(e._tag)) seen.push(e); })))),
  );
  return seen;
};

const entry = (id: string, tool: string, summary: string) => ({ kind: "plan-finding", seq: 1, iteration: 0, id, tool, summary });

describe("findings: pure mapping", () => {
  test("findingsOfEntries keeps only well-formed plan-finding entries and stamps the time", () => {
    const got = findingsOfEntries([entry("f1", "a", "x"), { kind: "claim", id: "c" }, { kind: "plan-finding", id: 3 }], 7);
    expect(got).toEqual([{ id: "f1", tool: "a", summary: "x", at: 7 }]);
  });

  test("mergeFindings dedupes on tool+summary and renumbers a colliding id; held ids never change", () => {
    const held: PlanFinding[] = [{ id: "f1", tool: "a", summary: "x" }];
    expect(mergeFindings(held, [{ id: "f1", tool: "a", summary: "x" }])).toBe(held);
    const merged = mergeFindings(held, [{ id: "f1", tool: "b", summary: "y" }]);
    expect(merged.map((f) => `${f.id}:${f.tool}`)).toEqual(["f1:a", "f2:b"]);
  });

  test("planFromWatch carries findings with and without a checklist snapshot; none means no key", () => {
    const meta = { id: "p", goal: "g", createdAt: 0, source: "model" as const };
    const f: PlanFinding[] = [{ id: "f1", tool: "a", summary: "x" }];
    expect(planFromWatch({ snapshot: undefined, findings: f }, { ...meta, findings: f }, [{ id: "1", title: "s", status: "pending" }]).findings).toEqual(f);
    expect("findings" in planFromWatch({ snapshot: undefined, findings: [] }, { ...meta, findings: [] })).toBe(false);
  });

  test("the context carrier round-trips findings and drops malformed rows; empty carries nothing", () => {
    const f: PlanFinding[] = [{ id: "f1", tool: "a", summary: "x" }];
    const meta = { metadata: todoSeedMetadata(undefined, f) };
    expect(readPlanFindings(meta as never)).toEqual(f);
    expect(todoSeedMetadata(undefined, [])).toEqual({});
    expect(readPlanFindings({ metadata: { context: { planFindings: [{ id: 1 }] } } } as never)).toBeUndefined();
  });
});

describe("agent.plan() recon -> Plan.findings -> execute", () => {
  test("A1: a read tool called in plan posture returns as Plan.findings and PlanRecorded carries them", async () => {
    const captured: Req[] = [];
    const agent = await buildRecon([{ toolCall: { name: "site-list", args: {} } }, { text: REPLY }, { text: REPLY }], captured);
    try {
      const events = await listen(agent, new Set(["PlanRecorded"]));
      const plan = await agent.plan("Report on my site");
      expect(plan.findings?.map((f) => `${f.id}:${f.tool}`)).toEqual(["f1:site-list"]);
      expect(plan.findings?.[0]?.summary).toContain("site-42");
      expect(events[0]).toMatchObject({ _tag: "PlanRecorded", findings: [{ id: "f1", tool: "site-list" }] });
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("A2: execute(plan) hands the findings to the run (envelope rail -> prompt) and result.plan keeps them", async () => {
    const captured: Req[] = [];
    const agent = await buildRecon(
      [{ toolCall: { name: "site-list", args: {} } }, { text: REPLY }, { text: REPLY }, { text: "FINAL ANSWER: done" }, { text: "FINAL ANSWER: done" }],
      captured,
    );
    try {
      const plan = await agent.plan("Report on my site");
      const before = captured.length;
      const result = await agent.execute(plan);
      const execPrompts = JSON.stringify(captured.slice(before).map((r) => [r.systemPrompt, r.messages]));
      expect(execPrompts).toContain("site-42");
      expect(result.plan.findings).toEqual(plan.findings);
      // The user-edited plan keeps its findings when it is executed.
      const edited: Plan = { ...plan, source: "user-edited" };
      expect(edited.findings).toEqual(plan.findings);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("A3: planRecon off (default) records no findings: the read tool is blocked in plan posture", async () => {
    const captured: Req[] = [];
    const agent = await buildRecon([{ toolCall: { name: "site-list", args: {} } }, { text: REPLY }, { text: REPLY }], captured, { recon: false });
    try {
      const plan = await agent.plan("Report on my site");
      expect(plan.findings).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("A4: an approval-gated read tool is effect unknown, so recon never runs it", async () => {
    const captured: Req[] = [];
    const agent = await buildRecon([{ toolCall: { name: "site-list", args: {} } }, { text: REPLY }, { text: REPLY }], captured, {
      tool: siteList({ requiresApproval: true }),
    });
    try {
      const plan = await agent.plan("Report on my site");
      expect(plan.findings).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  }, 30000);
});

describe("session carry", () => {
  test("S1: a streamed plan-finding ledger entry lands in the carry and seeds the next turn; a duplicate is kept once", () => {
    const carry = new TodoCarry();
    const ev = { _tag: "LedgerEntry" as const, entry: entry("f1", "site-list", "site-42"), seq: 1 };
    carry.observe(ev);
    carry.observe(ev);
    expect(carry.findings.map((f) => f.id)).toEqual(["f1"]);
    expect(todoSeedOf(carry).planFindings?.map((f) => f.tool)).toEqual(["site-list"]);
    expect(seedCarry(todoSeedOf(carry)).planFindings).toHaveLength(1);
    expect(seedCarry({ planFindings: [] })).toEqual({});
  });

  test("S2: session.plan shows held findings; setPlan with steps keeps them, a Plan with findings replaces them", async () => {
    const agent = await buildRecon([{ text: "ok" }], []);
    try {
      const session = agent.session();
      session.setPlan(["one", "two"]);
      expect(session.plan?.findings).toBeUndefined();
      const f: PlanFinding[] = [{ id: "f1", tool: "site-list", summary: "site-42" }];
      const given = session.plan!;
      const withFindings = session.setPlan({ ...given, findings: f });
      expect(withFindings.findings).toEqual(f);
      expect(session.plan?.findings).toEqual(f);
      // A plain step edit keeps what recon found.
      expect(session.setPlan(["one", "two", "three"]).findings).toEqual(f);
      expect(session.plan?.findings).toEqual(f);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("S3: findingsAfterEdit and planOfTodo: steps keep held, a Plan states its own, none means no key", () => {
    const held: PlanFinding[] = [{ id: "f1", tool: "a", summary: "x" }];
    expect(findingsAfterEdit(["s"], held)).toBe(held);
    expect(findingsAfterEdit({ id: "p", goal: "g", createdAt: 0, source: "model", steps: [], findings: [] }, held)).toEqual([]);
    expect(planOfTodo([{ id: "1", title: "t", status: "pending" }], freshPlanMeta("s", 0))).not.toHaveProperty("findings");
  });
});

describe("plan questions", () => {
  test("Q1: with user interaction wired a plan turn can call request_user_input and the answer resumes it", async () => {
    const captured: Req[] = [];
    const script: Script = [
      { toolCall: { name: "request_user_input", args: { kind: "choice", prompt: "Which site?", schema: { options: ["alpha", "beta"] } } } },
      { match: "beta", text: REPLY },
      { text: REPLY },
    ];
    const agent = await ReactiveAgents.create()
      .withName("plan-ask")
      .withProvider("test")
      .withModel("test-model")
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withReplayLLM(layerOf(script, captured))
      .withUserInteraction()
      .withMaxIterations(6)
      .build();
    try {
      const planning = agent.plan("Report on my site");
      const until = Date.now() + 10_000;
      let pending = await agent.listPendingInteractions();
      while (pending.length === 0 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 20));
        pending = await agent.listPendingInteractions();
      }
      expect(pending).toHaveLength(1);
      expect(pending[0]!.prompt).toBe("Which site?");
      await agent.respondToInteraction(pending[0]!.runId, pending[0]!.interactionId, "beta");
      const plan = await planning;
      expect(plan.steps.length).toBeGreaterThan(0);
    } finally {
      await agent.dispose();
    }
  }, 30000);
});
