// Run: bun test packages/reasoning/src/kernel/policy/run-posture.test.ts --timeout 15000
//
// Run posture (plan-only), kernel half — plan 2026-10-29-run-posture-plan-mode.md P3.
// Posture is HARNESS state (RunEnvelope.rails.posture), not prompt wording:
//   RED-ON-CUT: drop the surface filter / act-time block / guidance override /
//   required-tool clearing in run-posture.ts consumers and the pins below fail.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { makeObservableLLM } from "../observable-llm.js";
import { reactKernel } from "../loop/react-kernel.js";
import { runPass } from "../loop/run-pass.js";
import { RunEnvelope, buildRunEnvelope, mergeRunEnvelopeIntoKernelInput } from "../envelope/run-envelope.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import { evaluateToolPolicy } from "../capabilities/act/tool-observe.js";
import { resolveHarnessConfig } from "../../harness-config.js";
import { FOLLOW_PLAN_GUIDANCE } from "./plan-steps.js";
import { PLAN_TASK_FRAME } from "./plan-task-frame.js";
import {
  PLAN_POSTURE_GUIDANCE,
  PLAN_POSTURE_TOOLS,
  POSTURE_APPLIED_GUARD,
  blockedPostureCalls,
} from "./run-posture.js";

const SCHEMAS = [
  { name: "crypto-price", description: "price", parameters: [{ name: "coin", type: "string", required: true }] },
  { name: "file-write", description: "write", parameters: [{ name: "path", type: "string", required: true }] },
  { name: "recall", description: "recall", parameters: [{ name: "key", type: "string", required: false }] },
  {
    name: "todo",
    description: "checklist",
    // As the runtime builds it (tool-capabilities.ts toToolSchema): an opted-in meta tool is wire-visible.
    scope: "domain" as const,
    parameters: [
      { name: "action", type: "string", required: true },
      { name: "items", type: "array", required: false },
    ],
  },
];

const executed: string[] = [];
const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string }) =>
    Effect.sync(() => {
      executed.push(req.toolName);
      return { success: true, result: { price: 123 } };
    }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

// Unique ~700-token thought per scripted turn keeps the token-delta / repeat guards quiet.
let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `p${padN}x${i}`).join(" ");
};
const PLAN_ADD = { action: "add", items: ["fetch the price", "write it to a file"] };
const SUMMARY = { text: "Plan: 1) fetch the price 2) write it to a file. Say go to start." };

const baseInput = (overrides: Partial<KernelInput> = {}): KernelInput =>
  ({
    task: "Plan how to get the BTC price and save it.",
    availableToolSchemas: SCHEMAS,
    metaTools: { todo: true },
    // A classifier-demanded required tool: under plan it must NOT gate the run.
    requiredTools: ["crypto-price"],
    contextProfile: { tier: "local" },
    ...overrides,
  }) as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 8,
  strategy: "reactive",
  kernelType: "react",
  taskId: "posture-test",
  modelId: "llama3.2:3b",
};

type Turns = Parameters<typeof TestLLMServiceLayer>[0];

const run = (turns: Turns, posture: "plan" | undefined, input: KernelInput = baseInput()) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
      yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
      const pass = yield* runPass(reactKernel, input, opts);
      return { pass, events: yield* Ref.get(events) };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeObservableLLM().pipe(Layer.provide(TestLLMServiceLayer(turns))),
          toolLayer,
          EventBusLive,
          Layer.succeed(RunEnvelope, buildRunEnvelope({ ...(posture ? { posture } : {}) })),
        ),
      ),
    ),
  );

const planTurns = (): Turns => [
  {
    text: pad(),
    toolCalls: [
      { name: "crypto-price", args: { coin: "BTC" } },
      { name: "todo", args: PLAN_ADD },
    ],
  },
  SUMMARY,
];

const checklistFacts = (pass: Awaited<ReturnType<typeof run>>["pass"]) =>
  (pass.state.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []));
const postureEvents = (events: AgentEvent[]) =>
  events.filter((e) => e._tag === "GuardFiredEmitted" && e.guard === POSTURE_APPLIED_GUARD) as Extract<
    AgentEvent,
    { _tag: "GuardFiredEmitted" }
  >[];

describe("run posture: plan (kernel) — planning meta tools only, durable checklist", () => {
  it("the capability tool the model names is blocked + recorded, never executed; its todo call RUNS and records the plan; the reply completes the run", async () => {
    executed.length = 0;
    const { pass, events } = await run(planTurns(), "plan");

    expect(executed).toEqual([]);
    const blocked = pass.state.steps.filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "crypto-price",
    );
    expect(blocked.length).toBe(1);
    expect(blocked[0]?.metadata?.observationResult?.success).toBe(false);
    expect(blocked[0]?.content).toContain("not available in plan posture");
    expect(blockedPostureCalls(pass.state.steps)).toEqual(["crypto-price"]);
    // todo is a planning tool: it ran (not blocked) and recorded the model's own list.
    const todoObs = pass.state.steps.filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "todo",
    );
    expect(todoObs.length).toBe(1);
    expect(todoObs[0]?.content).not.toContain("not available in plan posture");
    const facts = checklistFacts(pass);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.origin === "harness-derived")).toBe(false); // model recorded: nothing derived
    expect(pass.state.status).toBe("done");
    expect(pass.state.output).toContain("Plan: 1) fetch the price");

    const posture = postureEvents(events);
    expect(posture.length).toBeGreaterThanOrEqual(2);
    const last = posture[posture.length - 1];
    expect(last?.outcome).toBe("block");
    expect(last?.metadata).toEqual({
      posture: "plan",
      allowedTools: ["todo", "brief", "final-answer"],
      blockedCalls: ["crypto-price"],
      planSteps: 2,
      planSource: "recorded",
      // Tracked signal: the stable ledger id (same on every pass of the run).
      signalId: expect.stringMatching(/^sig-/),
    });
    expect(new Set(posture.map((p) => (p.metadata as { signalId?: string }).signalId)).size).toBe(1);
  });

  it("the model is offered ONLY planning tools (todo, no capability tool) and sees exactly one Guidance line", async () => {
    const { events } = await run(planTurns(), "plan");
    const exchanges = events.filter((e) => e._tag === "LLMExchangeEmitted") as Extract<
      AgentEvent,
      { _tag: "LLMExchangeEmitted" }
    >[];
    expect(exchanges.length).toBeGreaterThanOrEqual(2);
    for (const ex of exchanges) {
      expect(ex.toolSchemaNames).toContain("todo");
      expect(ex.toolSchemaNames.every((n) => PLAN_POSTURE_TOOLS.has(n))).toBe(true);
      expect(ex.toolSchemaNames).not.toContain("crypto-price");
      expect(ex.toolSchemaNames).not.toContain("file-write");
      const userGuidance = ex.messages.filter((m) => m.role === "user" && m.content.startsWith("Guidance:"));
      expect(userGuidance.length).toBe(1);
      // The default-on tool catalog may follow the one posture line.
      expect(userGuidance[0]?.content.startsWith(`Guidance:\n- ${PLAN_POSTURE_GUIDANCE}`)).toBe(true);
    }
    // No execute-oriented nudge anywhere in what the model was shown.
    const everything = exchanges.flatMap((e) => e.messages.map((m) => m.content)).join("\n");
    expect(everything).not.toContain("You must still call");
    expect(everything).not.toContain("Do not give your final answer while items are open");
  });

  it("guidance is ONE line: reason, record steps with todo, present the plan, no other tools until the user switches", () => {
    expect([...PLAN_POSTURE_TOOLS].sort()).toEqual(["brief", "final-answer", "todo"]);
    expect(PLAN_POSTURE_GUIDANCE).not.toContain("\n");
    expect(PLAN_POSTURE_GUIDANCE).toBe(
      "Plan mode: reason it through, then record the steps with todo (one actionable step each, naming the tool to use when known), then present the plan. You cannot run tools other than todo until the user switches to execute.",
    );
  });

  it("a prose reply with no todo call completes the run; the harness DERIVES the checklist from the reply, tagged origin harness-derived, published on the ledger tap", async () => {
    executed.length = 0;
    const published: unknown[] = [];
    const { pass, events } = await Effect.runPromise(
      Effect.gen(function* () {
        const evs = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("GuardFiredEmitted", (ev) => Ref.update(evs, (xs) => [...xs, ev]));
        yield* bus.on("LedgerEntryAppended", (ev) => Effect.sync(() => void published.push(...ev.entries)));
        const p = yield* runPass(reactKernel, baseInput(), opts);
        return { pass: p, events: yield* Ref.get(evs) };
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeObservableLLM().pipe(Layer.provide(TestLLMServiceLayer([SUMMARY]))),
            toolLayer,
            EventBusLive,
            Layer.succeed(RunEnvelope, buildRunEnvelope({ posture: "plan" })),
          ),
        ),
      ),
    );
    expect(pass.state.status).toBe("done");
    expect(pass.state.output).toContain("Plan:");
    expect(executed).toEqual([]);
    const facts = checklistFacts(pass);
    expect(facts.length).toBe(1);
    expect(facts[0]?.origin).toBe("harness-derived");
    expect(facts[0]?.change).toEqual({
      op: "add",
      items: [
        { id: "1", title: "fetch the price" },
        { id: "2", title: "write it to a file" },
      ],
    });
    // Published through the live ledger tap (what the runtime turns into ChecklistUpdated).
    expect(published.some((e) => (e as { kind?: string; origin?: string }).kind === "checklist-item" && (e as { origin?: string }).origin === "harness-derived")).toBe(true);
    const last = postureEvents(events).at(-1);
    expect(last?.outcome).toBe("pass");
    expect(last?.metadata).toMatchObject({ planSteps: 2, planSource: "harness-derived" });
    expect("planRecorded" in (last?.metadata as object)).toBe(false);
  });

  it("a reply with nothing derivable still completes, records no checklist, and emits the plan-no-steps signal", async () => {
    const { pass, events } = await run([{ text: "Sounds good, I will think about it and get back to you." }], "plan");
    expect(pass.state.status).toBe("done");
    expect(checklistFacts(pass)).toEqual([]);
    const last = postureEvents(events).at(-1);
    expect(last?.metadata).toMatchObject({ planSteps: 0, planNoSteps: true });
  });

  it("execute posture never derives a checklist, even from a numbered reply", async () => {
    const { pass, events } = await run([SUMMARY], undefined, baseInput({ requiredTools: [] }));
    expect(checklistFacts(pass)).toEqual([]);
    expect(postureEvents(events)).toEqual([]);
  });

  it("plan posture frames the goal the model sees as plan-only (once); execute posture shows the raw task; the typed task is untouched", async () => {
    const seen = async (posture: "plan" | undefined) => {
      const input = baseInput({ requiredTools: [] });
      const { events } = await run([SUMMARY], posture, input);
      const ex = events.find((e) => e._tag === "LLMExchangeEmitted") as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
      return { text: ex.messages.map((m) => m.content).join("\n"), task: input.task };
    };
    const planned = await seen("plan");
    expect(planned.text).toContain(`${PLAN_TASK_FRAME}${planned.task}`);
    expect(planned.text.split(PLAN_TASK_FRAME).length - 1).toBeLessThanOrEqual(2); // system goal + user turn, never doubled
    expect(planned.task).toBe("Plan how to get the BTC price and save it.");
    const executed = await seen(undefined);
    expect(executed.text).not.toContain(PLAN_TASK_FRAME);
  });

  it("opt-in planToolCatalog appends ONE capped catalog line to plan guidance; off/absent is the single posture line", async () => {
    const guidanceOf = async (harness: KernelInput["harness"]) => {
      const { events } = await run([SUMMARY], "plan", baseInput({ ...(harness ? { harness } : {}) }));
      const ex = events.find((e) => e._tag === "LLMExchangeEmitted") as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
      return ex.messages.filter((m) => m.role === "user" && m.content.startsWith("Guidance:")).map((m) => m.content);
    };
    const off = await guidanceOf(resolveHarnessConfig({ planToolCatalog: false }));
    expect(off).toEqual([`Guidance:\n- ${PLAN_POSTURE_GUIDANCE}`]);
    const on = await guidanceOf({ planToolCatalog: true } as KernelInput["harness"]);
    expect(on.length).toBe(1);
    expect(on[0]?.startsWith(`Guidance:\n- ${PLAN_POSTURE_GUIDANCE}\n- Execute-phase tools: `)).toBe(true);
    expect(on[0]).toContain("crypto-price (price)");
    expect(on[0]).toContain("file-write (write)");
    expect(on[0]).not.toContain("; todo");
    expect(on[0]).toContain("`tool: name`");
  });

  it("resolved-default catalog reaches the plan-turn request with MCP tools from the full catalog (pruned surface has none); none registered adds nothing; execute unchanged", async () => {
    const mcp = (name: string) => ({ name, description: "Umami stat. Extra.", parameters: [] });
    const guidanceOf = async (posture: "plan" | undefined, over: Partial<KernelInput>) => {
      const { events } = await run([SUMMARY], posture, baseInput({ harness: resolveHarnessConfig(), ...over }));
      const ex = events.find((e) => e._tag === "LLMExchangeEmitted") as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;
      return ex.messages.filter((m) => m.role === "user" && m.content.startsWith("Guidance:")).map((m) => m.content).join("\n");
    };
    const g = await guidanceOf("plan", {
      availableToolSchemas: [{ name: "todo", description: "checklist", parameters: [] }],
      allToolSchemas: [mcp("umami/get_website_stats"), mcp("umami/get_pageviews"), ...SCHEMAS],
    });
    expect(g).toContain("MCP umami: umami/get_website_stats (Umami stat.); umami/get_pageviews (Umami stat.)");
    expect(g).toContain("`tool: name`");
    const none = await guidanceOf("plan", { availableToolSchemas: [], allToolSchemas: [] });
    expect(none).toBe(`Guidance:\n- ${PLAN_POSTURE_GUIDANCE}`);
    expect(await guidanceOf(undefined, { requiredTools: [], allToolSchemas: [mcp("umami/get_pageviews")] })).not.toContain("Execute-phase tools");
  });

  it("completes even with a classifier-demanded required tool and a task that names a deliverable (no act-or-answer forcing)", async () => {
    const { pass, events } = await run([SUMMARY], "plan", baseInput({ requiredTools: ["crypto-price", "file-write"] }));
    expect(pass.state.status).toBe("done");
    // One model call: nothing forced a retry.
    const exchanges = events.filter((e) => e._tag === "LLMExchangeEmitted");
    expect(exchanges.length).toBe(1);
  });

  it("posture does not switch provider thinking off (no thinking:false override on any request)", async () => {
    const thinkingSeen: Array<boolean | undefined> = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runPass(reactKernel, baseInput(), opts);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeObservableLLM().pipe(
              Layer.provide(
                Layer.effect(
                  LLMService,
                  Effect.gen(function* () {
                    const inner = yield* LLMService;
                    return {
                      ...inner,
                      complete: (req) => {
                        thinkingSeen.push(req.thinking);
                        return inner.complete(req);
                      },
                      stream: (req) => {
                        thinkingSeen.push(req.thinking);
                        return inner.stream(req);
                      },
                    };
                  }),
                ).pipe(Layer.provide(TestLLMServiceLayer([SUMMARY]))),
              ),
            ),
            toolLayer,
            EventBusLive,
            Layer.succeed(RunEnvelope, buildRunEnvelope({ posture: "plan" })),
          ),
        ),
      ),
    );
    expect(thinkingSeen.length).toBeGreaterThan(0);
    expect(thinkingSeen.every((t) => t !== false)).toBe(true);
  });

  it("execute control: the same duplicate todo add IS still caught by the loop guard", async () => {
    const turns: Turns = [
      { text: pad(), toolCalls: [{ name: "todo", args: PLAN_ADD }] },
      { text: pad(), toolCalls: [{ name: "todo", args: PLAN_ADD }] },
      { text: pad(), toolCalls: [{ name: "todo", args: PLAN_ADD }] },
      SUMMARY,
    ];
    const { pass } = await run(turns, undefined, baseInput({ requiredTools: [] }));
    expect(pass.state.steps.some((s) => s.content.includes("Loop detected")) || pass.state.status === "failed").toBe(true);
  });

  it("plan never accumulates execute nudges (actReminder) in pendingGuidance; execute does", async () => {
    const snapshotsOf = async (posture: "plan" | undefined) => {
      const out: Array<Record<string, unknown> | undefined> = [];
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* EventBus;
          yield* bus.on("KernelStateSnapshotEmitted", (ev) => Effect.sync(() => void out.push(ev.pendingGuidance)));
          yield* runPass(reactKernel, baseInput({ requiredTools: [] }), opts);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              makeObservableLLM().pipe(
                Layer.provide(TestLLMServiceLayer([{ text: pad(), toolCalls: [{ name: "todo", args: PLAN_ADD }] }, SUMMARY])),
              ),
              toolLayer,
              EventBusLive,
              Layer.succeed(RunEnvelope, buildRunEnvelope({ ...(posture ? { posture } : {}) })),
            ),
          ),
        ),
      );
      return out;
    };
    const plan = await snapshotsOf("plan");
    const execute = await snapshotsOf(undefined);
    expect(execute.some((g) => g?.actReminder !== undefined)).toBe(true); // non-vacuous control
    expect(plan.length).toBeGreaterThan(0);
    for (const g of plan) {
      expect(g?.actReminder).toBeUndefined();
      expect(g?.errorRecovery).toBeUndefined();
    }
  });

  it("environment-update notice is NOT stamped rendered under plan (suppressed), but is under execute", async () => {
    const withNotice = baseInput({ environmentUpdate: "File x.txt changed since your last turn." });
    const envEntry = (pass: Awaited<ReturnType<typeof run>>["pass"]) =>
      (pass.state.signalLedger ?? []).find((e) => e.signalKind === "environment-update");
    const plan = await run([SUMMARY], "plan", withNotice);
    expect(envEntry(plan.pass)).toBeDefined();
    expect(envEntry(plan.pass)?.state).not.toBe("rendered");
    const exec = await run([SUMMARY], undefined, { ...withNotice, requiredTools: [] } as KernelInput);
    expect(envEntry(exec.pass)?.state).toBe("rendered");
    // And the model never saw it under plan.
    const planGuidance = plan.events
      .filter((e) => e._tag === "LLMExchangeEmitted")
      .flatMap((e) => (e as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>).messages.map((m) => m.content))
      .join("\n");
    expect(planGuidance).not.toContain("changed since your last turn");
  });

  it("execute run seeded with an unchecked checklist renders ONE follow-the-plan line; all-done or empty seeds render none (byte-identical)", async () => {
    // Two turns (a tool call, then the answer): the line renders on the second
    // think turn. One scripted answer used to get its second turn from the todo
    // wrap-up, which is opt-in now.
    const guidanceLines = async (initialAdvisory: KernelInput["initialAdvisory"]) => {
      const { events } = await run(
        [{ text: pad(), toolCalls: [{ name: "crypto-price", args: { coin: "BTC" } }] }, SUMMARY],
        undefined,
        baseInput({ requiredTools: [], ...(initialAdvisory ? { initialAdvisory } : {}) }),
      );
      const exs = events.filter((e) => e._tag === "LLMExchangeEmitted") as Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>[];
      return exs.flatMap((e) => e.messages.map((m) => m.content)).join("\n");
    };
    const open = await guidanceLines([
      { id: "1", title: "fetch the price", status: "completed" },
      { id: "2", title: "write it to a file", status: "pending" },
    ]);
    expect(open.split(FOLLOW_PLAN_GUIDANCE).length - 1).toBe(1);
    expect(await guidanceLines([{ id: "1", title: "fetch", status: "completed" }])).not.toContain("Follow the plan checklist");
    expect(await guidanceLines([])).not.toContain("Follow the plan checklist");
    expect(await guidanceLines(undefined)).not.toContain("Follow the plan checklist");
  });

  it("execute posture is unchanged: same input, no posture ⇒ tool runs, no posture signal", async () => {
    executed.length = 0;
    const { events } = await run(
      [{ text: pad(), toolCalls: [{ name: "crypto-price", args: { coin: "BTC" } }] }, { text: "BTC is 123." }],
      undefined,
    );
    expect(executed).toContain("crypto-price");
    expect(events.some((e) => e._tag === "GuardFiredEmitted" && e.guard === POSTURE_APPLIED_GUARD)).toBe(false);
    const exchanges = events.filter((e) => e._tag === "LLMExchangeEmitted") as Extract<
      AgentEvent,
      { _tag: "LLMExchangeEmitted" }
    >[];
    expect(exchanges[0]?.toolSchemaNames).toContain("crypto-price");
  });

  it("merge boundary: plan clears required tools and stamps posture; execute/absent is identity", () => {
    const input = baseInput();
    const plan = mergeRunEnvelopeIntoKernelInput(input, buildRunEnvelope({ posture: "plan" }));
    expect(plan.posture).toBe("plan");
    expect(plan.requiredTools).toEqual([]);
    const none = mergeRunEnvelopeIntoKernelInput(input, buildRunEnvelope());
    expect("posture" in none).toBe(false);
    expect(none.requiredTools).toEqual(["crypto-price"]);
    expect(buildRunEnvelope().rails).toEqual({});
  });

  it("policy gate: plan blocks every tool outside PLAN_POSTURE_TOOLS (capability and the other meta/exit tools); planning tools pass", () => {
    for (const name of [
      "crypto-price", "checkpoint", "discover-tools", "activate-skill",
      "recall", "find", "context-status", "pulse", "task-complete",
    ]) {
      expect(evaluateToolPolicy(name, { posture: "plan" }).blocked).toBe(true);
    }
    for (const name of ["todo", "brief", "final-answer"]) {
      expect(evaluateToolPolicy(name, { posture: "plan" }).blocked).toBe(false);
    }
    // No posture: META bypass and open policy exactly as before.
    expect(evaluateToolPolicy("checkpoint", {}).blocked).toBe(false);
    expect(evaluateToolPolicy("crypto-price", {}).blocked).toBe(false);
  });
});

// Keep the LLMService import honest for layer typing in this file.
void LLMService;
