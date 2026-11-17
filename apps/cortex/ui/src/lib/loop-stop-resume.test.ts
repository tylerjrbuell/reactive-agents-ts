import { describe, expect, it } from "bun:test";
import {
  continueBody,
  continueChatRun,
  continueDeskRun,
  continueTarget,
  DEFAULT_EXTRA_ITERATIONS,
  fetchChatResumable,
  fetchLoopStoppedRuns,
  loopStopHint,
  MAX_EXTRA_ITERATIONS,
  parseExtraIterations,
  type ContinueTurn,
  type LoopStoppedRunWire,
  type ResumableRunWire,
} from "./loop-stop-resume.js";
import type { StopWire } from "./run-stop.js";

const stop = (over: Partial<StopWire> = {}): StopWire => ({
  reason: "loop_detected:repeat",
  repeatedTool: "web-search",
  toolsDone: [{ tool: "web-search", calls: 3 }, { tool: "file-read", calls: 1 }],
  unfinished: ["write report", "send summary"],
  iteration: 7,
  ...over,
});
const run = (over: Partial<ResumableRunWire> = {}): ResumableRunWire => ({ runId: "d1", task: "t", updatedAt: 1, status: "stopped", kind: "loop", stop: stop(), ...over });

describe("iteration grant and request body", () => {
  it("reads empty as the default and refuses anything but a whole number in range", () => {
    expect(parseExtraIterations("")).toEqual({ ok: true, value: DEFAULT_EXTRA_ITERATIONS });
    expect(parseExtraIterations(" 25 ")).toEqual({ ok: true, value: 25 });
    for (const bad of ["0", "-3", "2.5", "abc", String(MAX_EXTRA_ITERATIONS + 1)]) expect(parseExtraIterations(bad).ok).toBe(false);
  });

  it("sends only what differs from the framework default", () => {
    expect(continueBody("", "10")).toEqual({ ok: true, body: {} });
    expect(continueBody("  use the cache ", "20")).toEqual({ ok: true, body: { note: "use the cache", extraIterations: 20 } });
    expect(continueBody("x", "0").ok).toBe(false);
  });
});

describe("continueTarget", () => {
  const failed: ContinueTurn = { role: "assistant", runFailed: { ending: "failed" } };
  const resumable = [run({ runId: "old", updatedAt: 1 }), run({ runId: "new", updatedAt: 9 })];

  it("offers the newest stopped run on the latest failed assistant turn", () => {
    expect(continueTarget([{ role: "user" }, failed], false, resumable)?.runId).toBe("new");
    expect(continueTarget([{ role: "user" }, { role: "assistant", runFailed: { ending: "partial" } }], false, resumable)?.runId).toBe("new");
  });

  it("offers nothing while a turn is in flight, with no stopped run, or when the turn did not fail", () => {
    expect(continueTarget([failed], true, resumable)).toBeUndefined();
    expect(continueTarget([failed], false, [])).toBeUndefined();
    expect(continueTarget([{ role: "assistant" }], false, resumable)).toBeUndefined();
    expect(continueTarget([failed, { role: "user" }], false, resumable)).toBeUndefined();
    expect(continueTarget([{ role: "assistant", streaming: true, runFailed: { ending: "failed" } }], false, resumable)).toBeUndefined();
  });

  it("never offers it for an abstention", () => {
    expect(continueTarget([{ role: "assistant", runFailed: { ending: "abstained" } }], false, resumable)).toBeUndefined();
  });

  it("offers it on a turn the person stopped: the framework keeps that run resumable (needs the stored run)", () => {
    const stopped: ContinueTurn = { role: "assistant", runFailed: { ending: "interrupted" } };
    const mine = [run({ runId: "by-user", kind: "user-stopped", status: "stopped", updatedAt: 3 })];
    expect(continueTarget([{ role: "user" }, stopped], false, mine)?.runId).toBe("by-user");
    expect(continueTarget([{ role: "user" }, stopped], false, [])).toBeUndefined();
  });
});

describe("continueTarget: only a run that belongs to the latest reply", () => {
  const stoppedByUser: ContinueTurn = { role: "assistant", ts: 500, runFailed: { ending: "partial", interruptedBy: "user" } };
  const earlier: ContinueTurn[] = [{ role: "user", ts: 100 }, { role: "assistant", ts: 200 }, { role: "user", ts: 480 }];

  it("ignores an interrupted run stored before the previous exchange ended (the live 'nothing to continue from' contradiction)", () => {
    const stale = [run({ runId: "stale", kind: "user-paused", status: "paused", updatedAt: 150 })];
    expect(continueTarget([...earlier, stoppedByUser], false, stale)).toBeUndefined();
    const fresh = [...stale, run({ runId: "fresh", kind: "user-stopped", status: "stopped", updatedAt: 495 })];
    expect(continueTarget([...earlier, stoppedByUser], false, fresh)?.runId).toBe("fresh");
  });

  it("for a reply the person stopped, offers only a run the person stopped", () => {
    const loop = [run({ runId: "loop", kind: "loop", updatedAt: 495 })];
    expect(continueTarget([...earlier, stoppedByUser], false, loop)).toBeUndefined();
    expect(continueTarget([...earlier, { role: "assistant", ts: 500, runFailed: { ending: "failed" } }], false, loop)?.runId).toBe("loop");
  });
});

describe("loopStopHint for a reply the person stopped", () => {
  const stopped: ContinueTurn = { role: "assistant", runFailed: { ending: "partial", interruptedBy: "user" } };
  it("points at Durable runs when there is no saved run to continue", () => {
    expect(loopStopHint([stopped], false, undefined, true)).toContain("Durable runs with /durable");
    expect(loopStopHint([stopped], false, undefined, false)).toBeUndefined();
    expect(loopStopHint([stopped], false, run(), true)).toBeUndefined();
  });
});

describe("loopStopHint", () => {
  const loopTurn: ContinueTurn = { role: "assistant", runFailed: { ending: "failed", terminatedBy: "loop_detected:repeat" } };

  it("points at Durable execution when a loop-stopped turn has nothing to continue", () => {
    expect(loopStopHint([loopTurn], false, undefined, true)).toContain("Durable runs with /durable");
  });

  it("stays quiet while looking up, when Continue is offered, mid-turn, or for a non-loop ending", () => {
    expect(loopStopHint([loopTurn], false, undefined, false)).toBeUndefined();
    expect(loopStopHint([loopTurn], false, run(), true)).toBeUndefined();
    expect(loopStopHint([loopTurn], true, undefined, true)).toBeUndefined();
    expect(loopStopHint([{ role: "assistant", runFailed: { ending: "failed", terminatedBy: "max_iterations" } }], false, undefined, true)).toBeUndefined();
  });
});

describe("clients", () => {
  const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it("reads a session's stopped runs, and an empty list on any failure", async () => {
    expect(await fetchChatResumable("s 1", reply(200, { runs: [run()] }))).toHaveLength(1);
    expect(await fetchChatResumable("s1", reply(404, { error: "no" }))).toEqual([]);
    expect(await fetchChatResumable("s1", async () => { throw new Error("down"); })).toEqual([]);
  });

  it("reads the interrupted desk runs with their kind and status", async () => {
    const row: LoopStoppedRunWire = { runId: "r1", agentId: "a", name: null, startedAt: 1, durableRunId: "d1", checkpointIteration: 2, updatedAt: 3, status: "paused", kind: "user-paused" };
    expect(await fetchLoopStoppedRuns(reply(200, { runs: [row] }))).toEqual([row]);
    expect(await fetchLoopStoppedRuns(reply(500, {}))).toEqual([]);
  });

  it("posts the note and grant to the chat route and reports a run that stopped again", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const out = await continueChatRun("s 1", "d/1", { note: "go on", extraIterations: 20 }, async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ reply: "x", success: false, resumable: true }), { status: 200 });
    });
    expect(out).toEqual({ ok: true, success: false, resumable: true });
    expect(seen[0]!.url).toContain("/api/chat/sessions/s%201/resume/d%2F1");
    expect(seen[0]!.body).toEqual({ note: "go on", extraIterations: 20 });
  });

  it("returns the server's plain reason for a refusal and the failure text for a network error", async () => {
    expect(await continueChatRun("s", "r", {}, reply(409, { error: "Send a new message instead." }))).toEqual({ ok: false, status: 409, error: "Send a new message instead." });
    expect(await continueDeskRun("r", {}, async () => { throw new Error("offline"); })).toEqual({ ok: false, status: 0, error: "offline" });
    expect(await continueDeskRun("r1", {}, reply(200, { agentId: "a", runId: "r1" }))).toEqual({ ok: true, success: true, resumable: false });
  });
});
