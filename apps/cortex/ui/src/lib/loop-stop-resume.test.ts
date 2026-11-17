import { describe, expect, it } from "bun:test";
import {
  continueBody,
  continueChatRun,
  continueDeskRun,
  continueTarget,
  DEFAULT_EXTRA_ITERATIONS,
  fetchChatResumable,
  loopStopFacts,
  loopStopHeadline,
  loopStopHint,
  MAX_EXTRA_ITERATIONS,
  parseExtraIterations,
  type ContinueTurn,
  type LoopStopWire,
  type ResumableRunWire,
} from "./loop-stop-resume.js";

const stop = (over: Partial<LoopStopWire> = {}): LoopStopWire => ({
  reason: "loop_detected:repeat",
  repeatedTool: "web-search",
  toolsDone: [{ tool: "web-search", calls: 3 }, { tool: "file-read", calls: 1 }],
  unfinished: ["write report", "send summary"],
  iteration: 7,
  ...over,
});
const run = (over: Partial<ResumableRunWire> = {}): ResumableRunWire => ({ runId: "d1", task: "t", updatedAt: 1, loopStop: stop(), ...over });

describe("loop-stop wording", () => {
  it("says what the guard saw in plain words", () => {
    expect(loopStopHeadline({ reason: "loop_detected:repeat" })).toContain("repeating the same step");
    expect(loopStopHeadline({ reason: "loop_graceful" })).toContain("going in circles");
    expect(loopStopHeadline({ reason: "dispatcher-early-stop" })).toContain("not making progress");
    expect(loopStopHeadline({ reason: "weird" })).toBe("The run was stopped (weird).");
  });

  it("lists the repeated tool, the tools done with counts, and what is left", () => {
    expect(loopStopFacts(stop())).toEqual([
      { label: "Kept repeating", items: ["web-search"], mono: true },
      { label: "Already done", items: ["web-search x3", "file-read"], mono: true },
      { label: "Left to do", items: ["write report", "send summary"], mono: false },
    ]);
  });

  it("leaves empty groups out and caps long lists", () => {
    expect(loopStopFacts(stop({ repeatedTool: undefined, toolsDone: [], unfinished: [] }))).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => `row ${i}`);
    const left = loopStopFacts(stop({ unfinished: many })).find((f) => f.label === "Left to do")!;
    expect(left.items).toEqual([...many.slice(0, 5), "and 4 more"]);
  });
});

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

  it("never offers it for an abstention or a turn the person stopped", () => {
    expect(continueTarget([{ role: "assistant", runFailed: { ending: "abstained" } }], false, resumable)).toBeUndefined();
    expect(continueTarget([{ role: "assistant", runFailed: { ending: "interrupted" } }], false, resumable)).toBeUndefined();
  });
});

describe("loopStopHint", () => {
  const loopTurn: ContinueTurn = { role: "assistant", runFailed: { ending: "failed", terminatedBy: "loop_detected:repeat" } };

  it("points at Durable execution when a loop-stopped turn has nothing to continue", () => {
    expect(loopStopHint([loopTurn], false, undefined, true)).toContain("Durable execution");
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
