import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { Elysia } from "elysia";
import { causeDescription, causeNextActions } from "@reactive-agents/trace";
import { makeRunCauseReader, type RunCauseReport } from "../services/run-cause.js";
import { runsRouter } from "../api/runs.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";

// Minimal tracer JSONL fixtures. Trace `iter` is 0-based (-1 = run level); the run view's loops are 1-based.
type Ev = Record<string, unknown>;
const at = (runId: string) => {
  let seq = 0;
  return (iter: number, e: Ev): Ev => ({ runId, iter, seq: seq++, timestamp: 1000 + seq, ...e });
};
const jsonl = (events: readonly Ev[]): string => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

/** Every real tool call fails, three loops in a row: `tool-failure`. */
function failedToolLoop(runId: string): Ev[] {
  const e = at(runId);
  return [
    e(-1, { kind: "run-started", task: "fetch the page", model: "m", provider: "test", config: {} }),
    e(0, { kind: "tool-call-end", toolName: "http-get", ok: false, args: { url: "a" }, error: "ECONNREFUSED" }),
    e(1, { kind: "tool-call-end", toolName: "http-get", ok: false, args: { url: "b" }, error: "ECONNREFUSED" }),
    e(2, { kind: "tool-call-end", toolName: "http-get", ok: false, args: { url: "c" }, error: "ECONNREFUSED" }),
    e(-1, { kind: "run-completed", status: "failure", terminatedBy: "max_iterations", totalTokens: 10, totalCostUsd: 0, durationMs: 5 }),
  ];
}

/** The satisfiability preflight declined the task: `satisfiability-abstain`. */
function abstained(runId: string): Ev[] {
  const e = at(runId);
  return [
    e(-1, { kind: "run-started", task: "t", model: "m", provider: "test", config: {}, origin: "user" }),
    e(0, { kind: "guard-fired", guard: "satisfiability-preflight", outcome: "terminate", reason: "missing capability: web access" }),
    e(-1, { kind: "run-completed", status: "failure", terminatedBy: "abstained", totalTokens: 1, totalCostUsd: 0, durationMs: 1 }),
  ];
}

/** A clean success. */
function success(runId: string): Ev[] {
  const e = at(runId);
  return [
    e(-1, { kind: "run-started", task: "t", model: "m", provider: "test", config: {} }),
    e(0, { kind: "guard-fired", guard: "terminal_decision", outcome: "terminate", reason: "end_turn", metadata: { terminatedBy: "end_turn", status: "done", authority: "model-final" } }),
    e(-1, { kind: "run-completed", status: "success", terminatedBy: "end_turn", output: "42", totalTokens: 1, totalCostUsd: 0, durationMs: 1 }),
  ];
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-cause-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const write = (runId: string, events: readonly Ev[]): void => writeFileSync(join(dir, `${runId}.jsonl`), jsonl(events));
const causeOf = (runId: string, reader = makeRunCauseReader({ dirs: () => [dir] })): Promise<RunCauseReport> =>
  Effect.runPromise(reader.causeOf(runId));

describe("run cause (framework trace diagnosis)", () => {
  test("a failed tool loop names tool-failure, links its evidence to the 1-based loop, and attributes it", async () => {
    write("FAIL1", failedToolLoop("FAIL1"));
    const r = await causeOf("FAIL1");
    if (!r.available) throw new Error("expected a report");
    expect(r.cause).toBe("tool-failure");
    expect(r.subCause).toBe("all-calls-failed");
    // The framework's own words, the lines `rax-diagnose cause` prints.
    expect(r.headline).toBe(causeDescription("tool-failure"));
    expect(r.nextActions).toEqual(causeNextActions({ cause: "tool-failure", subCause: "all-calls-failed" }));
    expect(r.nextActions.length).toBeGreaterThan(0);
    expect(r.outcomeStatus).toBe("failure");
    // The first failing call is trace iter 0, the run view's loop 1.
    expect(r.evidence[0]).toMatchObject({ eventKind: "tool-call-end", seq: 1, loop: 1 });
    expect(r.attribution.verdict).toBe("environment");
    expect(r.attribution.reason).toBe("environment:tool-failure");
  });

  test("an abstained run names satisfiability-abstain; the attribution stays unattributed", async () => {
    write("ABST1", abstained("ABST1"));
    const r = await causeOf("ABST1");
    if (!r.available) throw new Error("expected a report");
    expect(r.cause).toBe("satisfiability-abstain");
    expect(r.confidence).toBe("decisive");
    expect(r.evidence[0]?.detail).toContain("missing capability");
    expect(r.attribution.verdict).toBe("unattributed");
  });

  test("a successful run reads none / not-failed; run-level evidence has no loop", async () => {
    write("OK1", success("OK1"));
    const r = await causeOf("OK1");
    if (!r.available) throw new Error("expected a report");
    expect(r.cause).toBe("none");
    expect(r.headline).toBe("Finished normally");
    expect(r.nextActions).toEqual([]); // a healthy run has nothing to try
    expect(r.attribution.verdict).toBe("not-failed");
    for (const e of r.evidence) if (e.eventKind === "run-completed") expect(e.loop).toBeNull();
  });

  test("no trace file, a malformed id, and a direct model call are not reports", async () => {
    expect(await causeOf("MISSING")).toEqual({ available: false, reason: "no-trace" });
    expect(await causeOf("../etc")).toEqual({ available: false, reason: "no-trace" });
    write("CHAT1", [{ runId: "CHAT1", iter: -1, seq: 0, timestamp: 1, kind: "llm-exchange", provider: "p", model: "m", requestKind: "complete", messages: [], toolSchemaNames: [], response: { content: "hi" } }]);
    expect(await causeOf("CHAT1")).toEqual({ available: false, reason: "not-a-run" });
  });

  test("cached per run until the trace file changes", async () => {
    const reader = makeRunCauseReader({ dirs: () => [dir] });
    write("GROW1", success("GROW1").slice(0, 1)); // still running: only run-started so far
    const first = await causeOf("GROW1", reader);
    expect(first.available && first.cause).toBe("incomplete-trace");
    expect(await causeOf("GROW1", reader)).toBe(first); // same object: served from cache
    write("GROW1", success("GROW1"));
    const done = await causeOf("GROW1", reader);
    expect(done.available && done.cause).toBe("none");
  });

  test("GET /api/runs/:runId/cause serves the report", async () => {
    write("FAIL2", failedToolLoop("FAIL2"));
    const db = new Database(":memory:");
    applySchema(db);
    const runner = Layer.succeed(CortexRunnerService, {
      resumeCrashed: () => Effect.succeed({ agentId: "a", runId: "r" }),
      start: () => Effect.succeed({ agentId: "a", runId: "r" }),
      pause: () => Effect.void,
      resume: () => Effect.void,
      stop: () => Effect.void,
      terminate: () => Effect.void,
      getActive: () => Effect.succeed(new Map()),
      listPendingApprovals: () => Effect.succeed([]),
      approveApproval: () => Effect.void,
      denyApproval: () => Effect.void,
      listPendingInteractions: () => Effect.succeed([]),
      respondToInteraction: () => Effect.succeed({ success: true, output: "" }),
    });
    const app = new Elysia().use(runsRouter(CortexStoreServiceLive(db), runner, makeRunCauseReader({ dirs: () => [dir] })));
    const res = await app.handle(new Request("http://localhost/api/runs/FAIL2/cause"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunCauseReport;
    expect(body.available && body.cause).toBe("tool-failure");
    const none = await app.handle(new Request("http://localhost/api/runs/NOPE/cause"));
    expect(await none.json()).toEqual({ available: false, reason: "no-trace" });
    db.close();
  });
});
