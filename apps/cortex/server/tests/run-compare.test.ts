import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { Elysia } from "elysia";
import { loadRecordedRun } from "@reactive-agents/replay";
import { applySchema } from "../db/schema.js";
import { upsertRun, updateRunStats } from "../db/queries.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { runsRouter } from "../api/runs.js";
import { makeRunCauseReader } from "../services/run-cause.js";
import {
  compareRecordedRuns,
  diffConfigs,
  makeRunCompareReader,
  stableJson,
  type RunCompareReport,
} from "../services/run-compare.js";

// Tracer JSONL fixtures: trace `iter` is 0-based (-1 = run level); the compare page's loops are 1-based.
type Ev = Record<string, unknown>;
const at = (runId: string) => {
  let seq = 0;
  return (iter: number, e: Ev): Ev => ({ runId, iter, seq: seq++, timestamp: 1000 + seq, ...e });
};
const jsonl = (events: readonly Ev[]): string => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

const CONFIG_A = { mechanisms: { posture: { mode: "auto" }, verifier: true }, builder: { strategy: "reactive", maxIterations: 10 } };
const CONFIG_B = { mechanisms: { posture: { mode: "lean" }, verifier: true }, builder: { maxIterations: 10, strategy: "reactive" } };

/**
 * Run A searches, fetches, then searches again with the same arguments (loop 3).
 * Its repeat is the trap: the framework snapshot groups calls by tool + args, so
 * read in that order A looks like [search, search, fetch].
 */
function runA(runId: string): Ev[] {
  const e = at(runId);
  return [
    e(-1, { kind: "run-started", task: "find the price", model: "m", provider: "test", config: CONFIG_A }),
    e(0, { kind: "tool-call-end", toolName: "web-search", ok: true, args: { q: "price" }, result: "r" }),
    e(1, { kind: "tool-call-end", toolName: "http-get", ok: true, args: { url: "x" }, result: "page" }),
    e(2, { kind: "tool-call-end", toolName: "web-search", ok: true, args: { q: "price" }, result: "r" }),
    e(-1, { kind: "run-completed", status: "success", output: "It costs 4.\nSource: x", totalTokens: 300, totalCostUsd: 0.01, durationMs: 900 }),
  ];
}

/** Run B: the same first two calls, then writes a file in loop 3 instead of searching again. */
function runB(runId: string): Ev[] {
  const e = at(runId);
  return [
    e(-1, { kind: "run-started", task: "find the price", model: "m", provider: "test", config: CONFIG_B }),
    e(0, { kind: "tool-call-end", toolName: "web-search", ok: true, args: { q: "price" }, result: "r" }),
    e(1, { kind: "tool-call-end", toolName: "http-get", ok: true, args: { url: "x" }, result: "page" }),
    e(2, { kind: "tool-call-end", toolName: "file-write", ok: false, args: { path: "p.md" }, error: "denied" }),
    e(-1, { kind: "run-completed", status: "success", output: "It costs 5.\nSource: x", totalTokens: 250, totalCostUsd: 0.008, durationMs: 700 }),
  ];
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-compare-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const write = (runId: string, events: readonly Ev[]): void => writeFileSync(join(dir, `${runId}.jsonl`), jsonl(events));

describe("run compare: trace diff (framework replay diffTraces)", () => {
  test("aligns steps in run order, finds the first divergence in loop 3, and aligns matching loops", async () => {
    write("CMPA", runA("CMPA"));
    write("CMPB", runB("CMPB"));
    const t = compareRecordedRuns(await loadRecordedRun(join(dir, "CMPA.jsonl")), await loadRecordedRun(join(dir, "CMPB.jsonl")));
    // Run order, not the snapshot's grouped order: step 1 is the fetch on both sides.
    expect(t.steps.map((s) => [s.a?.toolName, s.b?.toolName, s.same])).toEqual([
      ["web-search", "web-search", true],
      ["http-get", "http-get", true],
      ["web-search", "file-write", false],
    ]);
    expect(t.firstDivergence).toEqual({ step: 2, loopA: 3, loopB: 3 });
    expect(t.loops.map((l) => [l.loop, l.same])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    expect(t.steps[2]?.b).toMatchObject({ ok: false, loop: 3, args: '{"path":"p.md"}' });
    // The framework diff, A = original, B = replay.
    expect(t.diff.outputDiff).toEqual({ original: "It costs 4.\nSource: x", replay: "It costs 5.\nSource: x", equal: false });
    expect(t.diff.tokensDelta).toBe(-50);
    expect(t.diff.durationDeltaMs).toBe(-200);
    expect(t.diff.identical).toBe(false);
    expect(t.a).toMatchObject({ task: "find the price", toolCalls: 3, totalTokens: 300 });
  });

  test("a loop only one run reached is not the same on both, even with no tool calls (2026-11-11 QA)", async () => {
    const SNAP = { toolsUsed: [], scratchpadKeys: [], stepsCount: 0, stepsByType: {}, outputPreview: null, outputLen: 0, messagesCount: 1, tokens: 0, cost: 0, llmCalls: 0 };
    const ea = at("LONG");
    const long: Ev[] = [
      ea(-1, { kind: "run-started", task: "t", model: "m", provider: "test", config: CONFIG_A }),
      // traceStats counts loops from kernel-state snapshots (and entropy scores).
      ea(0, { kind: "kernel-state-snapshot", ...SNAP, status: "thinking" }),
      ea(1, { kind: "kernel-state-snapshot", ...SNAP, status: "done" }),
      ea(-1, { kind: "run-completed", status: "success", output: "done", totalTokens: 10, totalCostUsd: 0, durationMs: 5 }),
    ];
    const eb = at("NONE");
    const none: Ev[] = [
      eb(-1, { kind: "run-started", task: "t", model: "m", provider: "test", config: CONFIG_A }),
      eb(-1, { kind: "run-aborted", causeClass: "failure", error: "plan failed" }),
    ];
    write("LONG", long);
    write("NONE", none);
    const t = compareRecordedRuns(await loadRecordedRun(join(dir, "LONG.jsonl")), await loadRecordedRun(join(dir, "NONE.jsonl")));
    expect(t.a.iterations).toBeGreaterThan(0);
    expect(t.b.iterations).toBe(0);
    expect(t.loops.length).toBeGreaterThan(0);
    for (const l of t.loops) {
      expect(l.same).toBe(false);
      expect(l.ran).toEqual({ a: true, b: false });
    }
  });

  test("two identical recordings never diverge", async () => {
    write("SAME1", runA("SAME1"));
    write("SAME2", runA("SAME2"));
    const t = compareRecordedRuns(await loadRecordedRun(join(dir, "SAME1.jsonl")), await loadRecordedRun(join(dir, "SAME2.jsonl")));
    expect(t.firstDivergence).toBeNull();
    expect(t.loops.every((l) => l.same)).toBe(true);
    expect(t.diff.identical).toBe(true);
  });
});

describe("run compare: config difference", () => {
  test("lists only differing leaf paths; key order is not a difference", () => {
    const c = diffConfigs(CONFIG_A, CONFIG_B);
    expect(c.differs).toEqual([{ path: "mechanisms.posture.mode", a: '"auto"', b: '"lean"' }]);
    expect(c.sameCount).toBe(3);
    expect(c.truncated).toBe(false);
  });

  test("a path set on one run only, and a run with no config", () => {
    expect(diffConfigs({ x: 1 }, { x: 1, y: [1, 2] }).differs).toEqual([{ path: "y", b: "[1,2]" }]);
    const none = diffConfigs(undefined, { x: 1 });
    expect(none.a).toBe(false);
    expect(none.differs).toEqual([{ path: "x", b: "1" }]);
  });

  test("stableJson sorts object keys", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

const runner = Layer.succeed(CortexRunnerService, {
  resumeCrashed: () => Effect.succeed({ agentId: "a", runId: "r" }),
  start: () => Effect.succeed({ agentId: "a", runId: "r" }),
  pause: () => Effect.succeed("not-live" as const),
  resume: () => Effect.void,
  stop: () => Effect.succeed("not-live" as const),
  terminate: () => Effect.void,
  getActive: () => Effect.succeed(new Map()),
  listPendingApprovals: () => Effect.succeed([]),
  approveApproval: () => Effect.void,
  denyApproval: () => Effect.void,
  listPendingInteractions: () => Effect.succeed([]),
  respondToInteraction: () => Effect.succeed({ success: true, output: "" }),
});

function seedRun(db: Database, runId: string, opts: { config?: Record<string, unknown>; tokensOut: number; durationMs: number }): void {
  upsertRun(db, "agent-1", runId, `run ${runId}`);
  updateRunStats(db, runId, { status: "completed", provider: "test", model: "m", tokensUsedTotal: 100, completedAt: Date.now() + 1500 });
  const ins = db.prepare("INSERT INTO cortex_events (agent_id, run_id, session_id, seq, ts, type, payload) VALUES (?, ?, NULL, ?, ?, ?, ?)");
  if (opts.config) ins.run("agent-1", runId, 0, 1, "AgentStarted", JSON.stringify({ _tag: "AgentStarted", config: opts.config }));
  ins.run("agent-1", runId, 1, 2, "LLMRequestCompleted", JSON.stringify({ provider: "test", model: "m", durationMs: opts.durationMs, firstTokenMs: 0, tokensOut: opts.tokensOut }));
}

describe("GET /api/runs/compare", () => {
  const appOf = (db: Database) =>
    new Elysia().use(
      runsRouter(CortexStoreServiceLive(db), runner, makeRunCauseReader({ dirs: () => [dir] }), makeRunCompareReader({ dirs: () => [dir] })),
    );

  test("both traces: summary, speed, config diff and the step diff", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    seedRun(db, "CMPA", { config: CONFIG_A, tokensOut: 100, durationMs: 1000 });
    seedRun(db, "CMPB", { tokensOut: 100, durationMs: 500 }); // no AgentStarted: config falls back to the trace's run-started
    write("CMPA", runA("CMPA"));
    write("CMPB", runB("CMPB"));
    const res = await appOf(db).handle(new Request("http://localhost/api/runs/compare?a=CMPA&b=CMPB"));
    expect(res.status).toBe(200);
    const r = (await res.json()) as RunCompareReport;
    expect(r.a.run.runId).toBe("CMPA");
    expect(r.a.hasTrace && r.b.hasTrace).toBe(true);
    expect(r.a.speed.tokensPerSecond?.median).toBe(100);
    expect(r.b.speed.tokensPerSecond?.median).toBe(200);
    expect(r.config.differs.map((d) => d.path)).toEqual(["mechanisms.posture.mode"]);
    expect(r.trace.available && r.trace.firstDivergence?.step).toBe(2);
  });

  test("a run without a trace degrades to the summary comparison", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    seedRun(db, "CMPA", { config: CONFIG_A, tokensOut: 10, durationMs: 100 });
    seedRun(db, "NOTRACE", { config: CONFIG_B, tokensOut: 10, durationMs: 100 });
    write("CMPA", runA("CMPA"));
    const r = (await (await appOf(db).handle(new Request("http://localhost/api/runs/compare?a=CMPA&b=NOTRACE"))).json()) as RunCompareReport;
    expect(r.trace).toEqual({ available: false, missing: ["b"] });
    expect(r.a.hasTrace).toBe(true);
    expect(r.b.hasTrace).toBe(false);
    expect(r.config.differs.map((d) => d.path)).toEqual(["mechanisms.posture.mode"]);
  });

  test("400 without two ids, 404 for an unknown run, and the path never reads as a run id", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    seedRun(db, "CMPA", { tokensOut: 1, durationMs: 1 });
    const app = appOf(db);
    expect((await app.handle(new Request("http://localhost/api/runs/compare?a=CMPA"))).status).toBe(400);
    const missing = await app.handle(new Request("http://localhost/api/runs/compare?a=CMPA&b=GONE"));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { runId: string }).runId).toBe("GONE");
  });

  test("the trace half is cached until a trace file changes", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    seedRun(db, "CMPA", { tokensOut: 1, durationMs: 1 });
    seedRun(db, "CMPB", { tokensOut: 1, durationMs: 1 });
    write("CMPA", runA("CMPA"));
    write("CMPB", runA("CMPB"));
    const reader = makeRunCompareReader({ dirs: () => [dir] });
    const store = CortexStoreServiceLive(db);
    const run = () => Effect.runPromise(reader.compare("CMPA", "CMPB").pipe(Effect.provide(store)));
    const first = (await run()) as RunCompareReport;
    expect((await run() as RunCompareReport).trace).toBe(first.trace);
    write("CMPB", runB("CMPB"));
    const after = (await run()) as RunCompareReport;
    expect(after.trace.available && after.trace.firstDivergence?.step).toBe(2);
  });
});
