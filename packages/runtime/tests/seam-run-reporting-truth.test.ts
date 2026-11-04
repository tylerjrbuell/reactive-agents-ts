// Run: bun test packages/runtime/tests/seam-run-reporting-truth.test.ts
//
// Reporting-truth pins (Cortex/TUI polish verification, 2026-11-04).
//
//   R1 — the compact `◉ [complete]` console line must not print a success mark
//        for a run that did not succeed (engine/execute-completion-obs.ts).
//   R2 — `metadata.strategyUsed` (run() AND StreamCompleted, one assembly) must
//        name the strategy that FINISHED the run after a mid-run switch, not
//        the entry strategy (engine/phases/agent-loop/strategy-switch-capture.ts
//        → engine/execute-result-assembly.ts).
//   R3 — `.withTools({ include: [...] })` is not a ToolsOptions key; it was
//        dropped silently, the run saw only meta-tools and abstained. The
//        wither now names the unknown key and the key it probably meant
//        (builder/withers/tools.ts).
import { afterEach, beforeEach, describe, it, expect, spyOn } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { Task, TaskResult } from "@reactive-agents/core";
import {
  captureStrategySwitch,
  readStrategySwitchedTo,
  STRATEGY_SWITCHED_TO_KEY,
} from "../src/engine/phases/agent-loop/strategy-switch-capture.js";
import { emitCompletionObservability } from "../src/engine/execute-completion-obs.js";
import type { ObsLike } from "../src/engine/runtime-context.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../src/types.js";
import { ReactiveAgents } from "../src/builder.js";
import type { ToolsOptions } from "../src/builder.js";
import { unknownToolsOptionKeys } from "../src/builder/withers/tools.js";

// ── R1 ──────────────────────────────────────────────────────────────────────

function captureObs(lines: string[]): ObsLike {
  const noop = () => Effect.void;
  return {
    withSpan: (_n, eff) => eff,
    incrementCounter: noop,
    recordHistogram: noop,
    setGauge: noop,
    captureSnapshot: () => Effect.succeed(undefined),
    debug: noop,
    info: (msg: string) => Effect.sync(() => { lines.push(msg); }),
    warn: noop,
    error: noop,
    getTraceContext: () => Effect.succeed({ traceId: "t", spanId: "s" }),
    flush: noop,
    verbosity: () => "normal",
    attachChildren: noop,
  };
}

async function completeLine(executionSucceeded: boolean): Promise<string> {
  const lines: string[] = [];
  const ctx = { taskId: "task-1", tokensUsed: 10, cost: 0, iteration: 1 } as Partial<ExecutionContext> as ExecutionContext;
  const result = { metadata: { duration: 1000, cost: 0 } } as Partial<TaskResult> as TaskResult;
  await Effect.runPromise(
    emitCompletionObservability({
      obs: captureObs(lines),
      isNormal: true,
      ctx,
      task: { id: "task-1" } as Partial<Task> as Task,
      config: {} as ReactiveAgentsConfig,
      result,
      executionSucceeded,
      resolvedCalibration: undefined,
    }),
  );
  return lines.find((l) => l.startsWith("◉ [complete]")) ?? "";
}

describe("R1: completion line reflects the run outcome", () => {
  it("a failed run prints a failure mark, never the success mark", async () => {
    const line = await completeLine(false);
    expect(line).toContain("task-1");
    expect(line).toContain("✗");
    expect(line).not.toContain("✓");
  });

  it("a successful run keeps the success mark", async () => {
    const line = await completeLine(true);
    expect(line).toContain("✓");
    expect(line).not.toContain("✗");
  });
});

// ── R2 ──────────────────────────────────────────────────────────────────────

// The kernel's own switch cannot be scripted deterministically through the
// test provider (a repeated-call loop trips the low-delta guard first), so the
// switch is published from INSIDE the run on the run's own EventBus — the same
// event `kernel-hooks.ts onStrategySwitched` publishes. A decoy for another
// task id proves the filter (sub-agents share the bus).
function switchingTool(taskIdRef: { current: string | undefined }) {
  return {
    definition: {
      name: "gather",
      description: "gather research data",
      parameters: [{ name: "q", type: "string" as const, description: "query", required: true }],
      riskLevel: "low" as const,
      timeoutMs: 5_000,
      requiresApproval: false,
      source: "function" as const,
    },
    handler: () =>
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const base = { reason: "loop detected", timestamp: Date.now() };
        yield* bus.publish({ _tag: "StrategySwitched", taskId: taskIdRef.current ?? "", from: "reactive", to: "plan-execute-reflect", ...base });
        yield* bus.publish({ _tag: "StrategySwitched", taskId: "some-other-task", from: "reactive", to: "tree-of-thought", ...base });
        return "KEY FACT: the core metric rose 12% last quarter.";
      }),
  };
}

const switchScenario = [
  { toolCall: { name: "gather", args: { q: "a" } } },
  { text: "FINAL ANSWER: the core metric rose 12% last quarter." },
];

async function streamStrategyUsed(withSwitch: boolean) {
  const taskIdRef: { current: string | undefined } = { current: undefined };
  const agent = await ReactiveAgents.create()
    .withName("strategy-used-pin")
    .withProvider("test")
    .withModel("test")
    .withTestScenario(switchScenario as never)
    .withTools({ tools: [switchingTool(withSwitch ? taskIdRef : { current: "not-this-run" })], adaptive: false } as never)
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(4)
    .build();
  const unsub = await agent.subscribe("AgentStarted", (e) => {
    taskIdRef.current = String(e.taskId);
  });
  let completedStrategy: string | undefined;
  for await (const ev of agent.runStream("Research the topic and summarize it.")) {
    if (ev._tag === "StreamCompleted") {
      completedStrategy = (ev.metadata as { strategyUsed?: string }).strategyUsed;
    }
  }
  unsub();
  await agent.dispose();
  return { completedStrategy, taskId: taskIdRef.current };
}

describe("R2: strategyUsed names the strategy that finished the run", () => {
  it("after a mid-run switch, StreamCompleted.metadata.strategyUsed is the switch target", async () => {
    const { completedStrategy, taskId } = await streamStrategyUsed(true);
    // Vacuity guard: the switch was published for the live task.
    expect(taskId).toBeDefined();
    expect(completedStrategy).toBe("plan-execute-reflect");
  }, 20000);

  it("a switch for another task id does not leak into this run's strategyUsed", async () => {
    const { completedStrategy } = await streamStrategyUsed(false);
    expect(completedStrategy).toBe("reactive");
  }, 20000);
});

describe("strategy-switch capture (seam)", () => {
  it("keeps the LAST switch target for the task and unsubscribes after the pass", async () => {
    const program = Effect.gen(function* () {
      const bus = yield* EventBus;
      const publish = (taskId: string, to: string) =>
        bus.publish({ _tag: "StrategySwitched", taskId, from: "x", to, reason: "r", timestamp: 1 });
      const pass = yield* captureStrategySwitch(
        "t1",
        Effect.gen(function* () {
          yield* publish("t1", "plan-execute-reflect");
          yield* publish("t2", "tree-of-thought");
          yield* publish("t1", "blueprint");
          return 7;
        }),
      );
      // After the pass: a late event must not be observed by anyone.
      const late = yield* captureStrategySwitch("t1", Effect.succeed(0));
      yield* publish("t1", "reflexion");
      return { pass, late };
    });
    const { pass, late } = await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)));
    expect(pass.exit._tag).toBe("Success");
    expect(pass.switchedTo).toBe("blueprint");
    expect(late.switchedTo).toBeUndefined();
    expect(readStrategySwitchedTo({ [STRATEGY_SWITCHED_TO_KEY]: "blueprint" })).toBe("blueprint");
    expect(readStrategySwitchedTo({ [STRATEGY_SWITCHED_TO_KEY]: undefined })).toBeUndefined();
  });

  it("runs the pass without an EventBus and reports no switch (R2 helper)", async () => {
    const pass = await Effect.runPromise(captureStrategySwitch("t1", Effect.fail("boom" as const)));
    expect(pass.exit._tag).toBe("Failure");
    expect(pass.switchedTo).toBeUndefined();
  });
});

// ── R3 ──────────────────────────────────────────────────────────────────────

/** Visible tool names on the FIRST resolved surface of a write-a-file run. */
async function firstVisibleSurface(tools: ToolsOptions): Promise<readonly string[]> {
  const dir = mkdtempSync(join(tmpdir(), "ra-r3-surface-"));
  try {
    const agent = await ReactiveAgents.create()
      .withName("r3-surface")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([{ text: "FINAL ANSWER: done." }] as never)
      .withTools(tools)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2)
      .withTracing({ dir })
      .build();
    await agent.run("Write the text 'hello' to the file ./out/hello.txt.");
    await agent.dispose();
    for (const f of readdirSync(dir)) {
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as { kind?: string; visible?: readonly string[] };
        if (e.kind === "tool-surface-resolved" && Array.isArray(e.visible)) return e.visible;
      }
    }
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("R3: withTools({ include }) is not an option — it must not be dropped silently", () => {
  // Effect.logWarning's default logger writes via console.log.
  let log: ReturnType<typeof spyOn>;
  beforeEach(() => {
    log = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
  });
  const withToolsNotices = (): string[] =>
    (log.mock.calls as ReadonlyArray<ReadonlyArray<unknown>>)
      .map((call) => String(call[0]))
      .filter((msg) => msg.includes("withTools"));

  // `include` is not a ToolsOptions key. TypeScript rejects the literal; an
  // untyped caller (plain JS, a spread config object) got a silent no-op.
  const includeOptions: ToolsOptions & Record<string, unknown> = { include: ["file-write", "file-read"] };

  it("diagnosis: `include` exposes neither tool; `builtins` (the real key) exposes both", async () => {
    log.mockRestore();
    const viaInclude = await firstVisibleSurface(includeOptions);
    const viaBuiltins = await firstVisibleSurface({ builtins: ["file-write", "file-read"] });
    expect(viaBuiltins).toContain("file-write");
    expect(viaBuiltins).toContain("file-read");
    expect(viaInclude).not.toContain("file-write");
    expect(viaInclude).not.toContain("file-read");
    log = spyOn(console, "log").mockImplementation(() => {});
  }, 30000);

  it("the wither logs one notice naming the unknown key and the key it meant", () => {
    ReactiveAgents.create().withTools(includeOptions);
    const notices = withToolsNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("unknown option 'include'");
    expect(notices[0]).toContain("did you mean 'builtins'");
  });

  it("known keys log nothing", () => {
    ReactiveAgents.create().withTools({ builtins: ["file-write"], adaptive: false, required: ["file-write"] });
    ReactiveAgents.create().withTools();
    const notices = withToolsNotices();
    expect(notices).toHaveLength(0);
  });

  it("pure helper: unknown keys only, with a suggestion when one is known", () => {
    expect(unknownToolsOptionKeys({ builtins: true })).toEqual([]);
    expect(unknownToolsOptionKeys(includeOptions)).toEqual([{ key: "include", suggestion: "builtins" }]);
    const odd: ToolsOptions & Record<string, unknown> = { frobnicate: 1 };
    expect(unknownToolsOptionKeys(odd)).toEqual([{ key: "frobnicate", suggestion: undefined }]);
  });
});
