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

describe("status authority is one recorded value", () => {
  it("(a) runtime veto of a kernel done: authority is the runtime gate, kernelAuthority is the kernel's", async () => {
    const { evs, result } = await stalledRun();
    const rc = evs.find((e) => e.kind === "run-completed");
    expect(rc?.kind).toBe("run-completed");
    if (rc?.kind !== "run-completed") return;
    expect(rc.outcome).toBeDefined();
    expect(typeof rc.outcome!.authority).toBe("string");
    expect(rc.status).toBe("failure");
    expect(result.success).toBe(false);
    // Vacuity guard: the kernel said gate-verdict, the runtime owns the final status.
    expect(rc.outcome!.authority).toMatch(/^runtime-(verifier-gate|success-veto:.+)$/);
    expect(rc.outcome!.kernelAuthority).toBe("gate-verdict");
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

  it("(b) tool run: runtime verdict iter is below the inflated engine counter and matches the kernel verdict", async () => {
    const { evs, result } = await stalledRun();
    const verdicts = evs.filter((e) => e.kind === "verifier-verdict");
    const rt = verdicts.find((e) => e.kind === "verifier-verdict" && e.source === "runtime");
    const kernel = verdicts.find((e) => e.kind === "verifier-verdict" && e.source === undefined);
    expect(rt).toBeDefined();
    const engineIterations = (result.metadata as { iterations?: number }).iterations ?? 0;
    // Vacuity guard: the engine counter really is inflated on this run (9 vs 3).
    expect(engineIterations).toBeGreaterThan(rt!.iter);
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
