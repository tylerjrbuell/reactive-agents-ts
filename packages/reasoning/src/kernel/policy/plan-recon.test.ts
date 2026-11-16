// Run: bun test packages/reasoning/src/kernel/policy/plan-recon.test.ts --timeout 15000
//
// Plan posture questions + bounded read-only recon (spec 2026-11-16-plan-execute-posture-robustness.md,
// Addendum). RED-ON-CUT: drop the effect==='read' filter (reconEligibleSchemas), the budget in
// planTurnTools/toolPolicyFromInput, the forced-reply branch of planPostureSurface, the
// plan-finding commit in round-exit, or the planRecon flag read, and the pins below fail.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { makeObservableLLM } from "../observable-llm.js";
import { reactKernel } from "../loop/react-kernel.js";
import { runPass } from "../loop/run-pass.js";
import { RunEnvelope, buildRunEnvelope, mergeRunEnvelopeIntoKernelInput } from "../envelope/run-envelope.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import { evaluateToolPolicy, toolPolicyFromInput } from "../capabilities/act/tool-observe.js";
import { resolveHarnessConfig } from "../../harness-config.js";
import { PLAN_POSTURE_GUIDANCE } from "./run-posture.js";
import { planToolCatalogLine } from "./plan-steps.js";
import {
  PLAN_ASK_GUIDANCE,
  PLAN_FORCED_REPLY_GUIDANCE,
  PLAN_RECON_GUIDANCE,
  PLAN_RECON_MAX_CALLS,
  PLAN_RECON_MAX_PER_TOOL,
  planFindingsLine,
  planTurnTools,
  reconEligibleSchemas,
} from "./plan-recon.js";

const read = (name: string) => ({ name, description: `${name} lookup. More.`, parameters: [], effect: "read" as const });
const SCHEMAS = [
  { name: "list_websites", description: "List websites. More.", parameters: [], effect: "read" as const },
  { name: "delete_website", description: "Delete a website.", parameters: [], effect: "write" as const },
  { name: "mystery-tool", description: "Unknown effect.", parameters: [] },
  {
    name: "todo",
    description: "checklist",
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
      return { success: true, result: { websites: [{ id: "site-42", name: "docs" }] } };
    }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [] }),
});

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `q${padN}x${i}`).join(" ");
};
const PLAN_ADD = { action: "add", items: ["list the websites", "fetch stats for the docs site"] };
const SUMMARY = { text: "Plan: 1) list the websites 2) fetch stats for the docs site. Say go to start." };

const RECON_ON = resolveHarnessConfig({ planRecon: true });

const baseInput = (overrides: Partial<KernelInput> = {}): KernelInput =>
  ({
    task: "Plan how to report on my docs website traffic.",
    availableToolSchemas: SCHEMAS,
    allToolSchemas: SCHEMAS,
    metaTools: { todo: true },
    requiredTools: [],
    contextProfile: { tier: "local" },
    ...overrides,
  }) as KernelInput;

const opts: KernelRunOptions = { maxIterations: 8, strategy: "reactive", kernelType: "react", taskId: "plan-recon-test", modelId: "llama3.2:3b" };

type Turns = Parameters<typeof TestLLMServiceLayer>[0];
type Exchange = Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>;

const run = (turns: Turns, input: KernelInput, posture: "plan" | "execute" = "plan") =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
      const pass = yield* runPass(reactKernel, input, opts);
      const evs = yield* Ref.get(events);
      return { pass, exchanges: evs.filter((e): e is Exchange => e._tag === "LLMExchangeEmitted") };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeObservableLLM().pipe(Layer.provide(TestLLMServiceLayer(turns))),
          toolLayer,
          EventBusLive,
          Layer.succeed(RunEnvelope, buildRunEnvelope({ ...(posture === "plan" ? { posture } : {}) })),
        ),
      ),
    ),
  );

const guidanceOf = (ex: Exchange): string =>
  ex.messages.filter((m) => m.role === "user" && m.content.startsWith("Guidance:")).map((m) => m.content).join("\n");
const findings = (pass: Awaited<ReturnType<typeof run>>["pass"]) =>
  (pass.state.ledger ?? []).flatMap((e) => (e.kind === "plan-finding" ? [e] : []));
const obsOf = (pass: Awaited<ReturnType<typeof run>>["pass"], tool: string) =>
  pass.state.steps.filter((s) => s.type === "observation" && s.metadata?.observationResult?.toolName === tool);

const umamiTurns = (): Turns => [
  {
    text: pad(),
    toolCalls: [
      { name: "list_websites", args: {} },
      { name: "delete_website", args: {} },
      { name: "todo", args: PLAN_ADD },
    ],
  },
  SUMMARY,
];

describe("plan recon: eligibility (effect === 'read' only)", () => {
  it("only read-effect tools are eligible; write, unknown/absent and harness tools never are; flag off ⇒ none", () => {
    const input = baseInput({ harness: RECON_ON, posture: "plan" });
    expect(reconEligibleSchemas(input).map((t) => t.name)).toEqual(["list_websites"]);
    expect(reconEligibleSchemas(baseInput({ posture: "plan" }))).toEqual([]);
    expect(reconEligibleSchemas(baseInput({ harness: RECON_ON }))).toEqual([]); // execute posture
    // allowedTools still bounds the set.
    expect(reconEligibleSchemas(baseInput({ harness: RECON_ON, posture: "plan", allowedTools: ["x"] }))).toEqual([]);
  });

  it("the flag resolves default OFF and turns on by config", () => {
    expect(resolveHarnessConfig().planRecon).toBeUndefined();
    expect(resolveHarnessConfig({ planRecon: true }).planRecon).toBe(true);
    expect(resolveHarnessConfig({ planRecon: false }).planRecon).toBeUndefined();
  });
});

describe("plan recon: budget (derived from the step record)", () => {
  const input = baseInput({ harness: RECON_ON, posture: "plan", allToolSchemas: [read("a"), read("b"), read("c"), read("d")] });
  const obs = (tool: string) => ({
    id: `o-${tool}-${Math.random()}`, type: "observation" as const, content: "ok", timestamp: new Date(),
    metadata: { observationResult: { toolName: tool, success: true } },
  }) as never;

  it("per-tool cap: a tool at its cap leaves the recon set; the others stay", () => {
    const steps = Array.from({ length: PLAN_RECON_MAX_PER_TOOL }, () => obs("a"));
    const turn = planTurnTools(input, { iteration: 2, maxIterations: 8, steps });
    expect([...turn.recon].sort()).toEqual(["b", "c", "d"]);
    expect(turn.forced).toBe(false);
  });

  it("total cap: spent budget empties the recon set and forces the plan reply", () => {
    const steps = ["a", "a", "b", "b", "c", "c"].map(obs);
    expect(steps.length).toBe(PLAN_RECON_MAX_CALLS);
    const turn = planTurnTools(input, { iteration: 3, maxIterations: 8, steps });
    expect(turn.recon.size).toBe(0);
    expect(turn.forced).toBe(true);
  });

  it("calls dispatched earlier in the same batch count (pending)", () => {
    const turn = planTurnTools(input, { iteration: 1, maxIterations: 8, steps: [], pending: ["a", "a"] });
    expect(turn.recon.has("a")).toBe(false);
    expect(turn.recon.has("b")).toBe(true);
  });

  it("the last iteration forces the reply even with budget left; no recon flag never forces", () => {
    expect(planTurnTools(input, { iteration: 7, maxIterations: 8, steps: [] }).forced).toBe(true);
    const off = planTurnTools(baseInput({ posture: "plan" }), { iteration: 7, maxIterations: 8, steps: [] });
    expect(off).toEqual({ recon: new Set(), reconSchemas: [], ask: false, forced: false });
  });

  it("gate: an over-cap recon call is blocked with the posture message; an in-budget one passes; write never", () => {
    const steps = [obs("a"), obs("a")];
    const state = { iteration: 2, meta: { maxIterations: 8 } } as never;
    const policy = toolPolicyFromInput(input, state, steps);
    expect(evaluateToolPolicy("a", { ...policy }).blocked).toBe(true);
    expect(evaluateToolPolicy("b", { ...policy }).blocked).toBe(false);
    expect(evaluateToolPolicy("a", { ...policy }).blocked && (evaluateToolPolicy("a", policy) as { message: string }).message).toContain("not available in plan posture");
    expect(evaluateToolPolicy("delete_website", { ...toolPolicyFromInput(baseInput({ harness: RECON_ON, posture: "plan" }), state) }).blocked).toBe(true);
  });
});

describe("plan recon: scripted umami-shaped plan turn", () => {
  it("ON: list_websites (read) runs, the write tool is blocked and recorded, a finding is recorded, the plan reply is produced", async () => {
    executed.length = 0;
    const { pass } = await run(umamiTurns(), baseInput({ harness: RECON_ON }));
    expect(executed).toEqual(["list_websites"]);
    const del = obsOf(pass, "delete_website");
    expect(del.length).toBe(1);
    expect(del[0]?.metadata?.observationResult?.success).toBe(false);
    expect(del[0]?.content).toContain("not available in plan posture");
    expect(findings(pass)).toEqual([
      expect.objectContaining({ kind: "plan-finding", id: "f1", tool: "list_websites", summary: expect.stringContaining("site-42") }),
    ]);
    expect(pass.state.status).toBe("done");
    expect(pass.state.output).toContain("Plan: 1) list the websites");
  });

  it("OFF (default): the same script blocks the read tool too, runs nothing, records no finding, and the guidance is the one posture line", async () => {
    executed.length = 0;
    const { pass, exchanges } = await run(umamiTurns(), baseInput());
    expect(executed).toEqual([]);
    expect(obsOf(pass, "list_websites")[0]?.content).toContain("not available in plan posture");
    expect(findings(pass)).toEqual([]);
    expect(pass.state.status).toBe("done");
    for (const ex of exchanges) {
      expect(ex.toolSchemaNames.every((n) => n === "todo")).toBe(true);
      expect(guidanceOf(ex).startsWith(`Guidance:\n- ${PLAN_POSTURE_GUIDANCE}`)).toBe(true);
      expect(guidanceOf(ex)).not.toContain(PLAN_RECON_GUIDANCE);
    }
  });

  it("ON: the model is offered the read tool (not the write or unknown one) and sees the recon line; a spent budget withholds all but todo and forces the reply", async () => {
    executed.length = 0;
    const turns: Turns = [
      { text: pad(), toolCalls: [{ name: "list_websites", args: { page: 1 } }] },
      { text: pad(), toolCalls: [{ name: "list_websites", args: { page: 2 } }] },
      SUMMARY,
    ];
    const { pass, exchanges } = await run(turns, baseInput({ harness: RECON_ON }));
    expect(exchanges[0]?.toolSchemaNames).toContain("list_websites");
    expect(exchanges[0]?.toolSchemaNames).not.toContain("delete_website");
    expect(exchanges[0]?.toolSchemaNames).not.toContain("mystery-tool");
    expect(guidanceOf(exchanges[0]!)).toContain(PLAN_RECON_GUIDANCE);
    // Two calls = the per-tool cap: the third think turn has only todo and the forced-reply line.
    expect(executed).toEqual(["list_websites", "list_websites"]);
    const last = exchanges[exchanges.length - 1]!;
    expect(last.toolSchemaNames).toEqual(["todo"]);
    expect(guidanceOf(last)).toContain(PLAN_FORCED_REPLY_GUIDANCE);
    expect(findings(pass).map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(pass.state.status).toBe("done");
  });

  it("ON: a model that names a read tool past its cap anyway is blocked + recorded, never executed", async () => {
    executed.length = 0;
    const call = (page: number) => ({ name: "list_websites", args: { page } });
    const { pass } = await run([{ text: pad(), toolCalls: [call(1), call(2), call(3)] }, SUMMARY], baseInput({ harness: RECON_ON }));
    expect(executed.length).toBe(PLAN_RECON_MAX_PER_TOOL);
    expect(obsOf(pass, "list_websites").filter((s) => s.content.includes("not available in plan posture")).length).toBe(1);
    expect(findings(pass).length).toBe(PLAN_RECON_MAX_PER_TOOL);
  });
});

describe("plan questions: request_user_input", () => {
  it("offered with one ask line only when user interaction is wired; a run without it never sees the tool", async () => {
    const wired = await run([SUMMARY], baseInput({ metaTools: { todo: true, userInteraction: true } }));
    expect(wired.exchanges[0]?.toolSchemaNames).toContain("request_user_input");
    const g = guidanceOf(wired.exchanges[0]!);
    expect(g).toContain(PLAN_ASK_GUIDANCE);
    expect(g.split(PLAN_ASK_GUIDANCE).length - 1).toBe(1);
    const unwired = await run([SUMMARY], baseInput());
    expect(unwired.exchanges[0]?.toolSchemaNames).not.toContain("request_user_input");
    expect(guidanceOf(unwired.exchanges[0]!)).not.toContain(PLAN_ASK_GUIDANCE);
  });
});

describe("plan findings: catalog marks and execute seeding", () => {
  it("the catalog line marks recon-eligible tools (read) only when recon tools are given", () => {
    const schemas = [read("a"), { name: "b", description: "Writes. X.", parameters: [] }];
    const plain = planToolCatalogLine(schemas);
    expect(plain).not.toContain("(read");
    expect(plain).toContain("You cannot call these now;");
    const marked = planToolCatalogLine(schemas, [schemas[0]!]);
    expect(marked).toContain("a (read; a lookup.)");
    expect(marked).toContain("; b (Writes.)");
  });

  it("recorded findings render ONCE as 'Findings from planning' in an execute run; plan posture and none render nothing", async () => {
    const seeds = [{ id: "f1", tool: "list_websites", summary: "site-42 docs" }];
    expect(planFindingsLine({ planFindings: seeds })).toBe("Findings from planning: list_websites: site-42 docs.");
    expect(planFindingsLine({ planFindings: seeds, posture: "plan" })).toBeUndefined();
    expect(planFindingsLine({})).toBeUndefined();
    const withSeeds = await run(
      [{ text: pad(), toolCalls: [{ name: "mystery-tool", args: { a: 1 } }] }, SUMMARY],
      baseInput({ planFindings: seeds, requiredTools: [] }),
      "execute",
    );
    const text = withSeeds.exchanges.flatMap((e) => e.messages.map((m) => m.content)).join("\n");
    expect(text.split("Findings from planning:").length - 1).toBe(1);
    const none = await run([SUMMARY], baseInput(), "execute");
    expect(none.exchanges.flatMap((e) => e.messages.map((m) => m.content)).join("\n")).not.toContain("Findings from planning");
  });

  it("the envelope carries findings to the kernel input (own input wins; empty adds nothing)", () => {
    const seeds = [{ id: "f1", tool: "t", summary: "s" }];
    const env = buildRunEnvelope({ planFindings: seeds });
    expect(mergeRunEnvelopeIntoKernelInput(baseInput(), env).planFindings).toEqual(seeds);
    expect(mergeRunEnvelopeIntoKernelInput(baseInput({ planFindings: [] }), env).planFindings).toEqual([]);
    expect("planFindings" in mergeRunEnvelopeIntoKernelInput(baseInput(), buildRunEnvelope({ planFindings: [] }))).toBe(false);
  });
});
