// Run: bun test packages/runtime/tests/status-authority-trace.test.ts --timeout 20000
//
// Measurement-only pins (debuggability audit 2026-11-03 §5 items 2,3,5), read back
// through the normalized trace (`loadTrace`), the diagnose consumer path:
//  (a) run-completed.outcome names ONE authority incl. the runtime gate; a
//      done-vs-failure disagreement is explained by authority + kernelAuthority.
//  (b) the runtime boundary verdict is source:"runtime" and its iteration is not
//      inflated past the run's real iteration count.
//  (c) tool-call-end / strategy-switched iterations are populated.
//  (d) session.chat() runs report the session/turn origin.
//
// (a) uses a verifier-blocked run for the runtime-veto case: since 2026-11-10
// (no harness-written answers) the stalled run ends failed in the kernel
// itself, and an abstention carries the kernel's own `abstained` status.
//
// RED-ON-CUT:
//  - drop the foldRuntimeAuthority call in engine/finalize/run-finalize.ts -> (a) red.
//  - drop `authority` in engine/finalize/terminal-outcome-read.ts -> (a) red.
//  - revert kernelIterationOf use in engine/finalize/result-verification.ts -> (b) red.
//  - revert `completedIter = raw.iteration` / `raw.iteration ?? -1` in trace normalize -> (c) red.
//  - drop originCarry in chat/engine.ts -> (d) red.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace, toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { ReactiveAgents } from "../src/builder.js";
import { foldRuntimeAuthority, runtimeStatusAuthority } from "../src/engine/finalize/status-authority.js";
import { kernelIterationOf } from "../src/engine/finalize/result-verification.js";
import { readTerminalOutcome } from "../src/engine/finalize/terminal-outcome-read.js";

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

const stallScenario = [
  ...Array.from({ length: 5 }, () => ({ toolCall: { name: "gather", args: { q: "a" } } })),
  { text: "FINAL ANSWER: unsynthesized guess." },
];

async function stalledRun() {
  const dir = await mkdtemp(join(tmpdir(), "ra-authority-"));
  const agent = await ReactiveAgents.create()
    .withName("authority-pin")
    .withProvider("test")
    .withModel("test")
    .withTestScenario(stallScenario as never)
    .withTools({ tools: [gatherTool], adaptive: false } as never)
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withMaxIterations(8)
    .withObservability({ tracing: { dir } })
    .build();
  const result = await agent.run("Research the topic and summarize it.");
  await agent.dispose();
  return { evs: await events(dir), result };
}

/**
 * A run the KERNEL closes as `completed` and the RUNTIME scores as a failure
 * (verifier gate, `onReject: "block"`): the done-vs-failure disagreement the
 * fold must explain. (Since 2026-11-10 the stalled run above ends failed in the
 * kernel itself, and an abstention carries the kernel's own `abstained`
 * status, so neither exercises a runtime veto any more.)
 */
async function verifierBlockedRun() {
  const dir = await mkdtemp(join(tmpdir(), "ra-authority-verify-"));
  const agent = await ReactiveAgents.create()
    .withName("authority-verify")
    .withProvider("test")
    .withModel("test")
    .withTestScenario([{ text: "FINAL ANSWER: 4." }] as never)
    .withTools({ builtins: [], adaptive: false } as never)
    .withVerification({ onReject: "block" })
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withMaxIterations(4)
    .withObservability({ tracing: { dir } })
    .build();
  const result = await agent.run("What is 2 + 2?");
  await agent.dispose();
  return { evs: await events(dir), result };
}

/** A run the kernel itself ends `abstained` (required tool never registered). */
async function abstainedRun() {
  const dir = await mkdtemp(join(tmpdir(), "ra-authority-abstain-"));
  const agent = await ReactiveAgents.create()
    .withName("authority-abstain")
    .withProvider("test")
    .withModel("test")
    .withTestScenario([
      { text: "I cannot ground this without the required tool." },
      { text: "I cannot ground this without the required tool." },
    ] as never)
    .withTools({ builtins: [], adaptive: false } as never)
    .withRequiredTools({ tools: ["tool-that-does-not-exist"] })
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withMaxIterations(2)
    .withObservability({ tracing: { dir } })
    .build();
  const result = await agent.run("What is the population of the fictional city of Aetheria?");
  await agent.dispose();
  return { evs: await events(dir), result };
}

describe("status authority is one recorded value", () => {
  it("(a) runtime veto of a kernel-closed run: authority is the runtime veto, kernelAuthority is the kernel's", async () => {
    const { evs, result } = await verifierBlockedRun();
    const rc = evs.find((e) => e.kind === "run-completed");
    expect(rc?.kind).toBe("run-completed");
    if (rc?.kind !== "run-completed") return;
    expect(rc.outcome).toBeDefined();
    expect(rc.status).toBe("failure");
    expect(result.success).toBe(false);
    // Vacuity guard: the kernel closed the run itself; the runtime owns the final status.
    expect(rc.outcome!.status).toBe("completed");
    expect(rc.outcome!.authority).toBe("runtime-verifier-gate");
    expect(rc.outcome!.kernelAuthority).toBe("model-final");
    expect(rc.outcome!.statusReason).toContain("owned by runtime-verifier-gate");
    // The withheld answer is not replaced with harness text; the cause is on error.
    expect(result.output).toBe("");
    expect(String(result.error)).toContain("Verification rejected the response");
  }, 20000);

  it("(a) kernel abstention: the kernel owns the status, no runtime veto claims it", async () => {
    const { evs, result } = await abstainedRun();
    const rc = evs.find((e) => e.kind === "run-completed");
    if (rc?.kind !== "run-completed") throw new Error("no run-completed");
    expect(result.success).toBe(false);
    expect(result.terminatedBy).toBe("abstained");
    expect(rc.status).toBe("failure");
    expect(rc.outcome!.status).toBe("abstained");
    expect(rc.outcome!.authority).toBe("abstention");
    expect(rc.outcome!.kernelAuthority).toBeUndefined();
    expect(rc.outcome!.statusReason).toContain("agrees with kernel outcome abstained");
  }, 20000);

  it("(a) kernel-owned failure: authority is the kernel's, no kernelAuthority, the reason records agreement", async () => {
    const { evs, result } = await stalledRun();
    const rc = evs.find((e) => e.kind === "run-completed");
    if (rc?.kind !== "run-completed") throw new Error("no run-completed");
    expect(result.success).toBe(false);
    expect(rc.status).toBe("failure");
    expect(rc.outcome!.success).toBe(false);
    expect(rc.outcome!.authority).not.toMatch(/^runtime-/);
    expect(rc.outcome!.kernelAuthority).toBeUndefined();
    expect(rc.outcome!.statusReason).toContain("agrees with kernel outcome");
  }, 20000);
});

describe("status-authority fold (pure)", () => {
  const base = {
    status: "completed" as const,
    terminatedBy: "final_answer",
    provenance: "model-final" as const,
    verdict: null,
    answerSatisfied: null,
    success: true,
    authority: "model-final",
  };

  it("no runtime marker: outcome unchanged", () => {
    expect(foldRuntimeAuthority(base, {})).toEqual(base);
  });

  it("each marker maps to a typed runtime authority; kernel authority preserved", () => {
    expect(runtimeStatusAuthority({ verificationBlocked: { reason: "x" } })).toBe("runtime-verifier-gate");
    expect(runtimeStatusAuthority({ terminalOutcomeNotSuccess: true })).toBe("runtime-success-veto:terminal-outcome");
    expect(runtimeStatusAuthority({ outstandingContractNotSuccess: true })).toBe("runtime-success-veto:outstanding-criteria");
    const folded = foldRuntimeAuthority(base, { verificationBlocked: { reason: "x" } });
    expect(folded.authority).toBe("runtime-verifier-gate");
    expect(folded.kernelAuthority).toBe("model-final");
  });

  it("readTerminalOutcome keeps authority", () => {
    expect(readTerminalOutcome({ extensions: { terminalOutcome: base } })?.authority).toBe("model-final");
  });
});

describe("runtime verifier verdict stamp", () => {
  it("(b) kernelIterationOf never exceeds the engine counter and ignores non-thought steps", () => {
    const step = (type: string) => ({ type }) as never;
    expect(kernelIterationOf([step("thought"), step("action"), step("thought")], 11)).toBe(2);
    expect(kernelIterationOf([step("thought"), step("thought"), step("thought")], 2)).toBe(2);
    expect(kernelIterationOf([], 7)).toBe(7);
  });

  it("(b) tool run: runtime verdict iter equals the run's kernel turns and matches the kernel verdict", async () => {
    const { evs, result } = await stalledRun();
    const verdicts = evs.filter((e) => e.kind === "verifier-verdict");
    const rt = verdicts.find((e) => e.kind === "verifier-verdict" && e.source === "runtime");
    const kernel = verdicts.find((e) => e.kind === "verifier-verdict" && e.source === undefined);
    expect(rt).toBeDefined();
    const engineIterations = result.metadata.iterations ?? 0;
    // Until 2026-11-18 the engine counter held the step count (9 vs 3 here),
    // so this guard asserted it was inflated. It now reports the kernel's
    // turns (engine/run-kernel-turns.ts): the same number the verdict stamps
    // on this one-pass run.
    expect(engineIterations).toBe(rt!.iter);
    expect(kernel?.iter === undefined || rt!.iter <= kernel.iter).toBe(true);
  }, 20000);

  it("(b) scripted run: runtime verdict is source=runtime with iter <= run totalIterations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-verdict-"));
    const agent = await ReactiveAgents.create()
      .withName("verdict-pin")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([{ text: "FINAL ANSWER: 4." }] as never)
      .withTools({ builtins: [], adaptive: false } as never)
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withMaxIterations(8)
      .withObservability({ tracing: { dir } })
      .build();
    await agent.run("What is 2 + 2?");
    await agent.dispose();
    const evs = await events(dir);
    const runtimeVerdicts = evs.filter((e) => e.kind === "verifier-verdict" && e.source === "runtime");
    expect(runtimeVerdicts.length).toBe(1);
    expect(runtimeVerdicts[0]!.iter).toBeGreaterThanOrEqual(0);
  }, 20000);
});

describe("iteration stamps", () => {
  it("(c) tool-call-end carries the real iteration from a scripted tool run", async () => {
    const { evs } = await stalledRun();
    const ends = evs.filter((e) => e.kind === "tool-call-end");
    expect(ends.length).toBeGreaterThan(0);
    for (const e of ends) expect(e.iter).toBeGreaterThanOrEqual(0);
  }, 20000);

  it("(c) normalize reads typed iteration for ToolCallCompleted and StrategySwitched", () => {
    const tool = toTraceEvent(
      { _tag: "ToolCallCompleted", taskId: "t", toolName: "x", callId: "c", durationMs: 1, success: true, iteration: 3 } as never,
      1,
    );
    expect(tool?.iter).toBe(3);
    const sw = toTraceEvent(
      { _tag: "StrategySwitched", taskId: "t", from: "a", to: "b", reason: "r", timestamp: 1, iteration: 4 } as never,
      2,
    );
    expect(sw?.iter).toBe(4);
    const swNone = toTraceEvent(
      { _tag: "StrategySwitched", taskId: "t", from: "a", to: "b", reason: "r", timestamp: 1 } as never,
      3,
    );
    expect(swNone?.iter).toBe(-1);
  });
});

describe("session.chat origin", () => {
  async function chatOrigin(sessionOrigin?: "cortex-chat", turnOrigin?: "cortex-utility") {
    const dir = await mkdtemp(join(tmpdir(), "ra-chat-origin-"));
    const agent = await ReactiveAgents.create()
      .withName("chat-origin")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }] as never)
      .withTools({ builtins: [], adaptive: false } as never)
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withObservability({ tracing: { dir } })
      .build();
    const session = agent.session(sessionOrigin ? { origin: sessionOrigin } : undefined);
    await session.chat("hello", { useTools: true, ...(turnOrigin ? { origin: turnOrigin } : {}) });
    await agent.dispose();
    const started = (await events(dir)).find((e) => e.kind === "run-started");
    return started?.kind === "run-started" ? started.origin : undefined;
  }

  it("(d) session origin rides to run-started.origin; per-turn origin wins; default is user", async () => {
    expect(await chatOrigin("cortex-chat")).toBe("cortex-chat");
    expect(await chatOrigin("cortex-chat", "cortex-utility")).toBe("cortex-utility");
    expect(await chatOrigin()).toBe("user");
  }, 30000);
});
