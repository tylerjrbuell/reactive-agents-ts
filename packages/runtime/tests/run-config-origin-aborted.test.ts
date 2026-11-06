/**
 * Measurement-only trace fields (debuggability audit 2026-11-03, §5 items 1+5):
 *  - `run-started.config` records the resolved harness config, secret-free.
 *  - `run-started.origin` records the caller.
 *  - `run-aborted` is left when the run ends without `run-completed`.
 * Read back through the normalized trace (`loadTrace`), the diagnose consumer path.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace, type TraceEvent } from "@reactive-agents/trace";
import { ReactiveAgents } from "../src";
import { buildRunConfigSnapshot, resolveRunOrigin } from "../src/engine/execute-run-config";
import type { ReactiveAgentsConfig } from "../src/types";
import { makeRuntimeConfig } from "../src/testing/index";

const TRACE_DIR = mkdtempSync(join(tmpdir(), "ra-run-config-"));
const PRIOR_DIR = process.env.REACTIVE_AGENTS_TRACE_DIR;
const PRIOR_FLAG = process.env.REACTIVE_AGENTS_TRACE;
process.env.REACTIVE_AGENTS_TRACE_DIR = TRACE_DIR;
delete process.env.REACTIVE_AGENTS_TRACE;

const SECRET = "sk-ant-SUPERSECRET-0123456789";

afterAll(() => {
  if (PRIOR_DIR === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
  else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR_DIR;
  if (PRIOR_FLAG !== undefined) process.env.REACTIVE_AGENTS_TRACE = PRIOR_FLAG;
  delete process.env.RA_SAFE_PIN_FLAG;
  delete process.env.RA_PIN_API_KEY;
  rmSync(TRACE_DIR, { recursive: true, force: true });
});

const eventsOf = async (path: string): Promise<readonly TraceEvent[]> => (await loadTrace(path)).events;

const newTraceFiles = (before: ReadonlySet<string>): string[] =>
  readdirSync(TRACE_DIR).filter((f) => f.endsWith(".jsonl") && !before.has(f));

describe("run-started config + origin", () => {
  test("config is populated, deterministic, secret-free; origin defaults to user", async () => {
    process.env.RA_SAFE_PIN_FLAG = "1";
    process.env.RA_PIN_API_KEY = SECRET;
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withSystemPrompt(`never leak ${SECRET}`)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(3)
      .build();
    const result = await agent.run("config pin");
    await agent.dispose();
    const events = await eventsOf(result.metadata.tracePath!);
    const started = events.find((e) => e.kind === "run-started");
    expect(started?.kind).toBe("run-started");
    if (started?.kind !== "run-started") return;
    const cfg = started.config as {
      mechanisms: Record<string, unknown>;
      builder: Record<string, unknown>;
      env: Record<string, string>;
    };
    expect(Object.keys(cfg)).toEqual(["mechanisms", "disclosure", "builder", "env"]);
    expect(cfg.builder.maxIterations).toBe(3);
    expect(cfg.builder.strategy).toBe("reactive");
    expect(cfg.mechanisms.leanHarness).toBe(false);
    expect(typeof cfg.mechanisms.lazyDisclosure).toBe("boolean");
    expect(cfg.env.RA_SAFE_PIN_FLAG).toBe("1");
    expect(cfg.env.RA_PIN_API_KEY).toBeUndefined();
    expect(JSON.stringify(started)).not.toContain(SECRET);
    expect(started.origin).toBe("user");
  });

  test("explicit origin option rides to run-started.origin", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    const result = await agent.run("title this chat", { origin: "cortex-utility" });
    await agent.dispose();
    const started = (await eventsOf(result.metadata.tracePath!)).find((e) => e.kind === "run-started");
    expect(started?.kind === "run-started" && started.origin).toBe("cortex-utility");
  });

  test(".withTools({ disclosure }) is recorded with its source on run-started.config.disclosure", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({ disclosure: "index" })
      .build();
    const result = await agent.run("disclosure pin");
    await agent.dispose();
    const started = (await eventsOf(result.metadata.tracePath!)).find((e) => e.kind === "run-started");
    const c = (started?.kind === "run-started" ? started.config : {}) as {
      disclosure?: unknown;
      mechanisms?: Record<string, unknown>;
    };
    expect(c.disclosure).toEqual({ mode: "index", source: "withTools" });
    expect(c.mechanisms?.toolIndex).toBe(true);
    expect(c.mechanisms?.toolDiscovery).toBe(false);
  });

  test("lean harness is recorded as a mechanism", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withLeanHarness()
      .build();
    const result = await agent.run("lean pin");
    await agent.dispose();
    const started = (await eventsOf(result.metadata.tracePath!)).find((e) => e.kind === "run-started");
    const mech = (started?.kind === "run-started" ? started.config : {}) as { mechanisms?: Record<string, unknown> };
    expect(mech.mechanisms?.leanHarness).toBe(true);
    expect(mech.mechanisms?.strategySwitching).toBe(false);
  });

  test(".withHarness({ actOrAnswer }) is recorded as a mechanism (default off)", async () => {
    const mechanismsOf = async (agentRun: Promise<{ metadata: { tracePath?: string } }>) => {
      const started = (await eventsOf((await agentRun).metadata.tracePath!)).find((e) => e.kind === "run-started");
      return ((started?.kind === "run-started" ? started.config : {}) as { mechanisms?: Record<string, unknown> })
        .mechanisms;
    };
    const on = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withHarness({ actOrAnswer: true })
      .build();
    const onMech = await mechanismsOf(on.run("act-or-answer pin"));
    await on.dispose();
    expect(onMech?.actOrAnswer).toBe(true);

    const prior = process.env.RA_ACT_OR_ANSWER;
    delete process.env.RA_ACT_OR_ANSWER;
    const off = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    const offMech = await mechanismsOf(off.run("act-or-answer default pin"));
    await off.dispose();
    if (prior !== undefined) process.env.RA_ACT_OR_ANSWER = prior;
    expect(offMech?.actOrAnswer).toBe(false);
  });
});

describe("run-aborted sentinel", () => {
  test("interrupted run leaves run-aborted(interrupt) and no run-completed", async () => {
    const before = new Set(readdirSync(TRACE_DIR));
    const agent = await ReactiveAgents.create()
      .withName("abort-sentinel")
      .withTestScenario([{ text: "slow", delayMs: 1500 }])
      .withKillSwitch()
      .build();
    const runP = agent.run("abort me", { taskId: "abort-sentinel-1" }).then(() => "resolved", () => "rejected");
    setTimeout(() => void agent.terminate("pin terminate"), 60);
    expect(await runP).toBe("rejected");
    await agent.dispose();
    const files = newTraceFiles(before);
    expect(files.length).toBe(1);
    const events = await eventsOf(join(TRACE_DIR, files[0]!));
    const aborted = events.find((e) => e.kind === "run-aborted");
    expect(aborted).toBeDefined();
    if (aborted?.kind !== "run-aborted") return;
    expect(["interrupt", "failure"]).toContain(aborted.causeClass);
    expect(events.some((e) => e.kind === "run-completed")).toBe(false);
    expect(events.some((e) => e.kind === "run-started")).toBe(true);
  }, 10_000);
});

describe("pure helpers", () => {
  const base: ReactiveAgentsConfig = makeRuntimeConfig({
    maxIterations: 4, agentId: "a",
    systemPrompt: SECRET, receiptSigningKey: SECRET,
  });

  test("snapshot is stable and carries no prompt or key material", () => {
    const a = buildRunConfigSnapshot({ config: base, provider: "p", model: "m", lean: false, env: { RA_X: "1", RA_TOKEN_Q: SECRET } });
    const b = buildRunConfigSnapshot({ config: base, provider: "p", model: "m", lean: false, env: { RA_X: "1", RA_TOKEN_Q: SECRET } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toContain(SECRET);
    expect(a.env).toEqual({ RA_X: "1" });
  });

  test("snapshot is size-bounded", () => {
    const huge: ReactiveAgentsConfig = { ...base, allowedTools: Array.from({ length: 5000 }, (_, i) => `tool-${i}-${"x".repeat(40)}`) };
    const s = buildRunConfigSnapshot({ config: huge, provider: "p", model: "m", lean: false });
    expect(JSON.stringify(s).length).toBeLessThan(8 * 1024);
  });

  test("origin resolution: explicit > subagent > user; junk ignored", () => {
    const t = (context?: Record<string, unknown>) => ({ metadata: { tags: [], ...(context ? { context } : {}) } }) as never;
    expect(resolveRunOrigin(t())).toBe("user");
    expect(resolveRunOrigin(t({ origin: "gateway" }))).toBe("gateway");
    expect(resolveRunOrigin(t({ origin: "bogus" }))).toBe("user");
    expect(resolveRunOrigin(t({ parentAgentId: "p" }))).toBe("subagent");
    expect(resolveRunOrigin(t({ origin: "eval", parentAgentId: "p" }))).toBe("eval");
  });
});
