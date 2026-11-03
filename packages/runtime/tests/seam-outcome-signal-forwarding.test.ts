// Run: bun test packages/runtime/tests/seam-outcome-signal-forwarding.test.ts --timeout 20000
//
// Kernel outcome/exchange fields (kernel e3ad68b1a, provider 4332524b7) reach the
// recorded trace; the runtime stops approximating the kernel iteration; plan turns
// do not list withheld artifacts on the receipt; gateway/scheduled origin; abort reason.
// Read back through `loadTrace` (diagnose consumer path).
//
// RED-ON-CUT:
//  - (errorClass e2e NOT pinned: scripted-provider errors are in-band stream events the kernel stamps no errorClass for; see report.)
//  - drop readOptionalOutcomeFields spread in engine/finalize/terminal-outcome-read.ts -> (a)(b) red.
//  - drop `...kernelIterationArg(rr?.metadata)` in execution-engine.ts -> (c) red.
//  - drop the `posture` pass in builder/helpers.ts compileRunContract call -> (d) red.
//  - drop `context` origin in agent/execute-event.ts -> (e) red.
//  - drop `reason` spread in engine/execute-run-exit.ts -> (f) red.
import { describe, it, expect } from "bun:test";
import { Cause } from "effect";
import { Effect, ManagedRuntime } from "effect";
import { EventBus, EventBusLive, type AgentEvent, type Task } from "@reactive-agents/core";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace, type TraceEvent } from "@reactive-agents/trace";
import { ReactiveAgents } from "../src/builder.js";
import { readTerminalOutcome } from "../src/engine/finalize/terminal-outcome-read.js";
import { kernelIterationArg, verifyResultBoundary } from "../src/engine/finalize/result-verification.js";
import { deriveReceiptDeliverables } from "../src/builder/helpers.js";
import { gatewayRunOrigin, makeExecuteEvent } from "../src/agent/execute-event.js";
import { classifyAbortReason } from "../src/engine/execute-run-exit.js";

const gatherTool = {
  definition: {
    name: "gather",
    description: "gather research data",
    parameters: [{ name: "q", type: "string" as const, description: "query", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: () => Effect.succeed("KEY FACT: the core metric rose 12% last quarter."),
};

async function events(dir: string): Promise<TraceEvent[]> {
  const out: TraceEvent[] = [];
  for (const name of await readdir(dir)) {
    if (name.endsWith(".jsonl")) out.push(...(await loadTrace(join(dir, name))).events);
  }
  return out;
}

async function run(scenario: unknown[], task: string, opts?: { withGather?: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "ra-signal-fwd-"));
  const agent = await ReactiveAgents.create()
    .withName("signal-fwd")
    .withProvider("test")
    .withModel("test")
    .withTestScenario(scenario as never)
    .withTools(opts?.withGather ? ({ tools: [gatherTool], adaptive: false } as never) : ({ builtins: [], adaptive: false } as never))
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withMaxIterations(8)
    .withObservability({ tracing: { dir } })
    .build();
  const result = await agent.run(task).catch(() => undefined);
  await agent.dispose();
  return { evs: await events(dir), result };
}

const stall = [
  ...Array.from({ length: 5 }, () => ({ toolCall: { name: "gather", args: { q: "a" } } })),
  { text: "FINAL ANSWER: unsynthesized guess." },
];

describe("(a)(b) run-completed.outcome carries the kernel's split fields", () => {
  it("refused-deliverable run: deliverable decision + verifier verdict + outstanding on the trace", async () => {
    const { evs } = await run(stall, "Research the topic and summarize it.", { withGather: true });
    const rc = evs.find((e) => e.kind === "run-completed");
    expect(rc?.kind).toBe("run-completed");
    if (rc?.kind !== "run-completed") return;
    expect(rc.outcome?.deliverable).toBeDefined();
    expect(rc.outcome?.deliverable).not.toBeNull();
    expect(rc.outcome?.deliverable?.accepted).toBe(false);
    expect(rc.outcome?.verifierVerdict).toBeDefined();
    expect(Array.isArray(rc.outcome?.outstanding)).toBe(true);
  }, 20000);

  it("readTerminalOutcome forwards valid fields and drops malformed ones without voiding the outcome", () => {
    const base = { status: "completed", terminatedBy: "final_answer", provenance: "model-final", verdict: null, answerSatisfied: null, success: true };
    const good = readTerminalOutcome({
      extensions: {
        terminalOutcome: {
          ...base,
          deliverable: { outcome: "block", reason: "r", accepted: false },
          verifierVerdict: { verified: false, failedChecks: ["a"] },
          outstanding: ["x", "y"],
          errorClass: "LLMRateLimitError",
          finalStatus: "partial",
        },
      },
    });
    expect(good).toMatchObject({
      deliverable: { outcome: "block", reason: "r", accepted: false },
      verifierVerdict: { verified: false, failedChecks: ["a"] },
      outstanding: ["x", "y"],
      errorClass: "LLMRateLimitError",
      finalStatus: "partial",
    });
    const bad = readTerminalOutcome({
      extensions: { terminalOutcome: { ...base, deliverable: { outcome: "weird" }, verifierVerdict: 3, outstanding: [1], errorClass: 9 } },
    });
    expect(bad?.status).toBe("completed");
    expect(bad?.deliverable).toBeUndefined();
    expect(bad?.verifierVerdict).toBeUndefined();
    expect(bad?.outstanding).toBeUndefined();
    expect(bad?.errorClass).toBeUndefined();
  });
});

describe("(c) verdict iteration is the kernel's exact iteration", () => {
  it("kernelIterationArg reads only a finite number", () => {
    expect(kernelIterationArg({ extensions: { kernelIteration: 3 } })).toEqual({ kernelIteration: 3 });
    expect(kernelIterationArg({ extensions: { kernelIteration: "3" } })).toEqual({});
    expect(kernelIterationArg(undefined)).toEqual({});
  });

  it("verifyResultBoundary stamps the EXACT kernelIteration, not the step-count approximation", async () => {
    const step = (type: string) => ({ type, content: "x" }) as never;
    const stamp = (kernelIteration?: number) =>
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const seen: AgentEvent[] = [];
        yield* bus.on("VerifierVerdictEmitted", (ev) => Effect.sync(() => void seen.push(ev)));
        yield* verifyResultBoundary({
          config: {} as never, taskId: "t", task: "What is 2 + 2?", output: "4", success: true,
          steps: [step("thought"), step("thought"), step("thought"), step("thought"), step("thought")],
          toolsUsed: new Set(), iteration: 9,
          ...(kernelIteration !== undefined ? { kernelIteration } : {}),
        });
        const v = seen.find((e) => e._tag === "VerifierVerdictEmitted");
        return v?._tag === "VerifierVerdictEmitted" ? v.iteration : undefined;
      }).pipe(Effect.provide(EventBusLive), Effect.runPromise);
    expect(await stamp(2)).toBe(2); // exact wins
    expect(await stamp()).toBe(5); // fallback: thought-count approximation
  });

  it("scripted run: runtime verdict iter === result.metadata.extensions.kernelIteration", async () => {
    const { evs, result } = await run(stall, "Research the topic and summarize it.", { withGather: true });
    const kernelIteration = (result?.metadata as { extensions?: { kernelIteration?: unknown } } | undefined)?.extensions?.kernelIteration;
    expect(typeof kernelIteration).toBe("number");
    const rt = evs.find((e) => e.kind === "verifier-verdict" && e.source === "runtime");
    expect(rt).toBeDefined();
    expect(rt!.iter).toBe(kernelIteration as number);
  }, 20000);
});

describe("(d) plan turn receipt withholds artifacts the posture withholds", () => {
  const task = "Write the report to report.md and summarize.";
  it("execute lists the artifact; plan does not (vacuity guard on the former)", () => {
    const exec = deriveReceiptDeliverables({ task, output: "x" });
    expect(JSON.stringify(exec ?? [])).toContain("report.md");
    const plan = deriveReceiptDeliverables({ task, output: "x", posture: "plan" });
    expect(JSON.stringify(plan ?? [])).not.toContain("report.md");
  });
});

describe("(e) gateway/scheduled origin", () => {
  it("heartbeat/cron are scheduled; channel/other are gateway", () => {
    expect(gatewayRunOrigin("heartbeat")).toBe("scheduled");
    expect(gatewayRunOrigin("cron")).toBe("scheduled");
    expect(gatewayRunOrigin("channel")).toBe("gateway");
    expect(gatewayRunOrigin("webhook")).toBe("gateway");
  });
});

describe("(e) gateway executeEvent stamps origin on the task it runs", () => {
  it("heartbeat task carries context.origin=scheduled; channel task gateway", async () => {
    const tasks: Task[] = [];
    const rt = ManagedRuntime.make(EventBusLive);
    const exec = makeExecuteEvent({
      publish: async () => {},
      glog: (() => {}) as never,
      engine: { execute: (t) => (tasks.push(t), Effect.fail({ message: "stop here" } as never)) },
      runtime: rt as never,
      gw: {} as never,
      agentId: "a", persistMemory: true,
      getIsExecuting: () => false, setIsExecuting: () => {}, incrementTotalRuns: () => {},
    });
    await exec({}, "heartbeat", "tick");
    await exec({}, "channel", "msg");
    expect(tasks.map((t) => t.metadata?.context?.["origin"])).toEqual(["scheduled", "gateway"]);
  });
});

describe("(f) run-aborted reason", () => {
  it("classifies timeout / abort / user-stop / terminate; unknown stays undefined", () => {
    expect(classifyAbortReason(Cause.interrupt({} as never), { timeoutMs: 100, durationMs: 150 })).toBe("timeout");
    expect(classifyAbortReason(Cause.interrupt({} as never), { timeoutMs: 100, durationMs: 20 })).toBe("abort");
    expect(classifyAbortReason(Cause.interrupt({} as never), { durationMs: 20 })).toBe("abort");
    expect(classifyAbortReason(Cause.fail({ _tag: "KillSwitchTriggeredError", reason: "stop() requested" }), { durationMs: 1 })).toBe("user-stop");
    expect(classifyAbortReason(Cause.fail({ _tag: "KillSwitchTriggeredError", reason: "pin terminate" }), { durationMs: 1 })).toBe("terminate");
    expect(classifyAbortReason(Cause.fail({ _tag: "Other" }), { durationMs: 1 })).toBeUndefined();
  });

  it("per-execution timeout run leaves run-aborted reason=timeout on the trace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-abort-reason-"));
    const agent = await ReactiveAgents.create()
      .withName("abort-reason")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([{ text: "slow", delayMs: 1500 }] as never)
      .withTools({ builtins: [], adaptive: false } as never)
      .withTimeout(150)
      .withObservability({ tracing: { dir } })
      .build();
    await agent.run("hang").catch(() => undefined);
    await agent.dispose();
    const aborted = (await events(dir)).find((e) => e.kind === "run-aborted");
    expect(aborted?.kind === "run-aborted" && aborted.reason).toBe("timeout");
  }, 20000);
});
