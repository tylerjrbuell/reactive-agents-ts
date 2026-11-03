// Run: bun test packages/reasoning/src/kernel/policy/run-posture.test.ts --timeout 15000
//
// Run posture (plan-only), kernel half — plan 2026-10-29-run-posture-plan-mode.md P3.
// Posture is HARNESS state (RunEnvelope.rails.posture), not prompt wording:
//   RED-ON-CUT: drop the surface filter / act-time block / guidance override /
//   required-tool clearing in run-posture.ts consumers and the pins below fail.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, foldAdvisory, type AgentEvent } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { makeObservableLLM } from "../observable-llm.js";
import { reactKernel } from "../loop/react-kernel.js";
import { runPass } from "../loop/run-pass.js";
import { RunEnvelope, buildRunEnvelope, mergeRunEnvelopeIntoKernelInput } from "../envelope/run-envelope.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import { evaluateToolPolicy } from "../capabilities/act/tool-observe.js";
import {
  PLAN_POSTURE_GUIDANCE,
  PLAN_POSTURE_TOOLS,
  POSTURE_APPLIED_GUARD,
  isPlanRecorded,
  blockedPostureCalls,
} from "./run-posture.js";

const SCHEMAS = [
  { name: "crypto-price", description: "price", parameters: [{ name: "coin", type: "string", required: true }] },
  { name: "file-write", description: "write", parameters: [{ name: "path", type: "string", required: true }] },
  { name: "recall", description: "recall", parameters: [{ name: "key", type: "string", required: false }] },
  {
    name: "todo",
    description: "checklist",
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

describe("run posture: plan (kernel)", () => {
  it("crypto-price attempted under plan is blocked + recorded, plan recorded, summary delivered", async () => {
    executed.length = 0;
    const { pass, events } = await run(planTurns(), "plan");

    // Never executed.
    expect(executed).toEqual([]);
    // Recorded as a failed observation, with the posture block message.
    const blockedObs = pass.state.steps.filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "crypto-price",
    );
    expect(blockedObs.length).toBe(1);
    expect(blockedObs[0]?.metadata?.observationResult?.success).toBe(false);
    expect(blockedObs[0]?.content).toContain("not available in plan posture");
    expect(blockedPostureCalls(pass.state.steps)).toEqual(["crypto-price"]);
    // Plan recorded as checklist facts.
    const facts = (pass.state.ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []));
    expect(foldAdvisory(facts).map((i) => i.title)).toEqual(["fetch the price", "write it to a file"]);
    // The todo result carries the PLAN closing line, not the execute one.
    const todoObs = pass.state.steps.find(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "todo",
    );
    expect(todoObs?.content).toContain("Plan recorded (2 items)");
    expect(todoObs?.content).not.toContain("Do not give your final answer while items are open");
    // Complete: required-tool gate did not fail/force the run; summary delivered.
    expect(pass.state.status).toBe("done");
    expect(pass.state.output).toContain("Plan: 1) fetch the price");

    // Trace shape: posture-applied on the guard-fired event.
    const posture = events.filter(
      (e) => e._tag === "GuardFiredEmitted" && e.guard === POSTURE_APPLIED_GUARD,
    ) as Extract<AgentEvent, { _tag: "GuardFiredEmitted" }>[];
    expect(posture.length).toBeGreaterThanOrEqual(2);
    const last = posture[posture.length - 1];
    expect(last?.outcome).toBe("block");
    expect(last?.metadata).toEqual({
      posture: "plan",
      allowedTools: [...PLAN_POSTURE_TOOLS],
      blockedCalls: ["crypto-price"],
      planRecorded: true,
      // Tracked signal: the stable ledger id (same on every pass of the run).
      signalId: expect.stringMatching(/^sig-/),
    });
    expect(new Set(posture.map((p) => (p.metadata as { signalId?: string }).signalId)).size).toBe(1);
  });


  it("the model only SEES the posture-allowed surface and exactly one Guidance line", async () => {
    const { events } = await run(planTurns(), "plan");
    const exchanges = events.filter((e) => e._tag === "LLMExchangeEmitted") as Extract<
      AgentEvent,
      { _tag: "LLMExchangeEmitted" }
    >[];
    expect(exchanges.length).toBeGreaterThanOrEqual(2);
    for (const ex of exchanges) {
      expect(ex.toolSchemaNames).not.toContain("crypto-price");
      expect(ex.toolSchemaNames).not.toContain("file-write");
      const userGuidance = ex.messages.filter((m) => m.role === "user" && m.content.startsWith("Guidance:"));
      expect(userGuidance.length).toBe(1);
      expect(userGuidance[0]?.content).toBe(`Guidance:\n- ${PLAN_POSTURE_GUIDANCE}`);
    }
    // No execute-oriented nudge anywhere in what the model was shown.
    const everything = exchanges.flatMap((e) => e.messages.map((m) => m.content)).join("\n");
    expect(everything).not.toContain("You must still call");
    expect(everything).not.toContain("Do not give your final answer while items are open");
  });
  it("guidance is ONE concrete action line, not a rule to acknowledge", () => {
    expect(PLAN_POSTURE_GUIDANCE).toBe("Call todo to add each step of the plan, then write the plan for the user.");
    expect(PLAN_POSTURE_GUIDANCE).not.toContain("\n");
  });

  it("prose-only reply (no todo) completes honestly: success, and the trace says planRecorded:false", async () => {
    const { pass, events } = await run([SUMMARY], "plan");
    expect(pass.state.status).toBe("done");
    expect(pass.state.output).toContain("Plan:");
    expect(isPlanRecorded(pass.state.ledger)).toBe(false);
    const posture = events.filter(
      (e) => e._tag === "GuardFiredEmitted" && e.guard === POSTURE_APPLIED_GUARD,
    ) as Extract<AgentEvent, { _tag: "GuardFiredEmitted" }>[];
    expect(posture.length).toBeGreaterThanOrEqual(1);
    expect((posture[posture.length - 1]?.metadata as { planRecorded?: boolean }).planRecorded).toBe(false);
    // No fabricated checklist rows.
    expect((pass.state.ledger ?? []).some((e) => e.kind === "checklist-item")).toBe(false);
  });

  it("duplicate todo add after the plan is recorded does not trip the loop guard", async () => {
    const { pass } = await run(
      [
        { text: pad(), toolCalls: [{ name: "todo", args: PLAN_ADD }] },
        { text: pad(), toolCalls: [{ name: "todo", args: PLAN_ADD }] },
        { text: pad(), toolCalls: [{ name: "todo", args: PLAN_ADD }] },
        SUMMARY,
      ],
      "plan",
    );
    expect(pass.state.status).toBe("done");
    expect(pass.state.meta?.terminatedBy).not.toBe("max_iterations");
    expect(pass.state.steps.some((s) => s.content.includes("Loop detected"))).toBe(false);
    expect(pass.state.output).toContain("Plan: 1) fetch the price");
    expect(isPlanRecorded(pass.state.ledger)).toBe(true);
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

  it("policy gate: plan blocks capability AND non-allowed META tools; allows plan tools", () => {
    for (const name of ["crypto-price", "checkpoint", "discover-tools", "activate-skill"]) {
      expect(evaluateToolPolicy(name, { posture: "plan" }).blocked).toBe(true);
    }
    for (const name of PLAN_POSTURE_TOOLS) {
      expect(evaluateToolPolicy(name, { posture: "plan" }).blocked).toBe(false);
    }
    // No posture: META bypass and open policy exactly as before.
    expect(evaluateToolPolicy("checkpoint", {}).blocked).toBe(false);
    expect(evaluateToolPolicy("crypto-price", {}).blocked).toBe(false);
  });
});

// Keep the LLMService import honest for layer typing in this file.
void LLMService;
