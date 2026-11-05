import { afterAll, describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace } from "@reactive-agents/trace";
import { ReactiveAgents } from "../src/builder.js";
import type { ReasoningOptions } from "../src/types.js";

describe("withReasoning strategy switching options", () => {
  it("accepts enableStrategySwitching: true", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ enableStrategySwitching: true });
    expect(builder).toBeDefined();
  });

  it("accepts maxStrategySwitches", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ maxStrategySwitches: 2 });
    expect(builder).toBeDefined();
  });

  it("accepts fallbackStrategy", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ fallbackStrategy: "plan-execute-reflect" });
    expect(builder).toBeDefined();
  });
});

// ─── Resolved default (opt-in since 2026-11-05) ──────────────────────────────
//
// Strategy switching is OPT-IN: the lift gate returned no measurable accuracy
// lift at +28% billed tokens
// (wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md).
//
// Read back through `run-started.config.mechanisms.strategySwitching`, which is
// `config.strategySwitching?.enabled === true` — the exact field the kernel
// gates the switch on (`switchCfg?.enabled`). An e2e loop trigger through the
// builder is not used: the test provider cannot force the kernel's loop
// detector deterministically, and the kernel-level enabled/disabled behavior
// is already pinned in packages/reasoning strategy-switching-e2e.test.ts.

const TRACE_DIR = mkdtempSync(join(tmpdir(), "ra-switch-default-"));
const PRIOR_DIR = process.env.REACTIVE_AGENTS_TRACE_DIR;
const PRIOR_FLAG = process.env.REACTIVE_AGENTS_TRACE;
process.env.REACTIVE_AGENTS_TRACE_DIR = TRACE_DIR;
delete process.env.REACTIVE_AGENTS_TRACE;

afterAll(() => {
  if (PRIOR_DIR === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
  else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR_DIR;
  if (PRIOR_FLAG !== undefined) process.env.REACTIVE_AGENTS_TRACE = PRIOR_FLAG;
  rmSync(TRACE_DIR, { recursive: true, force: true });
});

const resolvedSwitching = async (reasoning: ReasoningOptions): Promise<unknown> => {
  const agent = await ReactiveAgents.create()
    .withTestScenario([{ text: "FINAL ANSWER: ok" }])
    .withReasoning(reasoning)
    .build();
  const result = await agent.run("switch default pin");
  await agent.dispose();
  const events = (await loadTrace(result.metadata.tracePath!)).events;
  const started = events.find((e) => e.kind === "run-started");
  const config = (started?.kind === "run-started" ? started.config : {}) as {
    mechanisms?: Record<string, unknown>;
  };
  return config.mechanisms?.strategySwitching;
};

describe("strategy switching resolved default", () => {
  it("is OFF when enableStrategySwitching is unset", async () => {
    expect(await resolvedSwitching({ defaultStrategy: "reactive" })).toBe(false);
  });

  it("is ON when enableStrategySwitching: true", async () => {
    expect(
      await resolvedSwitching({ defaultStrategy: "reactive", enableStrategySwitching: true }),
    ).toBe(true);
  });

  it("is OFF when enableStrategySwitching: false", async () => {
    expect(
      await resolvedSwitching({ defaultStrategy: "reactive", enableStrategySwitching: false }),
    ).toBe(false);
  });
});
