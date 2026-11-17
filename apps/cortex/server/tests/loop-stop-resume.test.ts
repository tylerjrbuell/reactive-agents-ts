// Continue a loop-stopped run: the pure rules (services/loop-stop-resume.ts) and the chat
// agent's durable-runs default (services/chat-durable-runs.ts).
import { describe, expect, it } from "bun:test";
import { DurableConfigMismatchError, DurableRunNotFoundError, RunNotResumableError, type RunRecord } from "@reactive-agents/runtime";
import {
  continueMessage,
  MAX_EXTRA_ITERATIONS,
  MAX_RESUME_NOTE_CHARS,
  parseResumeInput,
  ResumeGuard,
  resumableRunsOf,
  resumeFailureOf,
  resumeStatusOf,
} from "../services/loop-stop-resume.js";
import { chatDurableSource } from "../services/chat-resume.js";

const rec = (over: Partial<RunRecord>): RunRecord => ({
  runId: "d1",
  agentId: "a",
  task: "t",
  status: "failed",
  configHash: "h",
  updatedAt: 1,
  ...over,
});
const stop = { reason: "loop_detected:repeat", repeatedTool: "web-search", toolsDone: [{ tool: "web-search", calls: 3 }], unfinished: ["write report"], iteration: 7 };

describe("resumableRunsOf", () => {
  it("offers every resumable run (any kind), newest first, and never one the framework does not flag", () => {
    const out = resumableRunsOf([
      rec({ runId: "old", updatedAt: 1, stop: { ...stop, kind: "loop" }, resumable: true }),
      rec({ runId: "new", updatedAt: 5, stop: { ...stop, kind: "loop" }, resumable: true }),
      rec({ runId: "plain", updatedAt: 9 }),
      rec({ runId: "flagless", updatedAt: 9, stop }),
    ]);
    expect(out.map((r) => r.runId)).toEqual(["new", "old"]);
    expect(out[0]).toMatchObject({ kind: "loop", status: "failed", stop: { ...stop, kind: "loop" } });
  });

  it("labels each run by its stop kind: user stop, user pause, budget, timeout, error", () => {
    const kinds = ["user-stopped", "user-paused", "budget", "timeout", "error"] as const;
    const out = resumableRunsOf(
      kinds.map((kind, i) => rec({ runId: kind, updatedAt: i, status: kind === "user-paused" ? "paused" : "stopped", stop: { ...stop, kind }, resumable: true })),
    );
    expect(Object.fromEntries(out.map((r) => [r.runId, r.kind]))).toEqual(Object.fromEntries(kinds.map((k) => [k, k])));
    expect(out.find((r) => r.runId === "user-paused")?.status).toBe("paused");
  });

  it("reads a stop from before kinds existed as a loop stop, and a run with no stop record as a crash", () => {
    const [crash, legacy] = resumableRunsOf([
      rec({ runId: "legacy", updatedAt: 1, stop, resumable: true }),
      rec({ runId: "crash", updatedAt: 2, status: "running", resumable: true }),
    ]);
    expect(crash).toMatchObject({ runId: "crash", kind: "crash", status: "running" });
    expect(crash!.stop).toBeUndefined();
    expect(legacy).toMatchObject({ runId: "legacy", kind: "loop" });
  });

  it("leaves out the runs live in the agent now (a running row with a checkpoint reads resumable)", () => {
    const out = resumableRunsOf(
      [rec({ runId: "live", status: "running", resumable: true }), rec({ runId: "crashed", status: "running", resumable: true })],
      ["live"],
    );
    expect(out.map((r) => r.runId)).toEqual(["crashed"]);
  });
});

describe("parseResumeInput", () => {
  it("leaves the framework defaults alone when nothing is given", () => {
    expect(parseResumeInput(undefined)).toEqual({ ok: true, options: {} });
    expect(parseResumeInput(null)).toEqual({ ok: true, options: {} });
    expect(parseResumeInput({ note: "   " })).toEqual({ ok: true, options: {} });
  });

  it("passes a trimmed note and a whole-number iteration grant through", () => {
    expect(parseResumeInput({ note: "  use the cached file  ", extraIterations: 15 })).toEqual({
      ok: true,
      options: { note: "use the cached file", extraIterations: 15 },
    });
  });

  it("refuses a bad note or iteration count with plain wording", () => {
    expect(parseResumeInput({ note: 4 }).ok).toBe(false);
    expect(parseResumeInput({ note: "x".repeat(MAX_RESUME_NOTE_CHARS + 1) }).ok).toBe(false);
    for (const bad of [0, -1, 1.5, MAX_EXTRA_ITERATIONS + 1, "10"]) {
      expect(parseResumeInput({ extraIterations: bad }).ok).toBe(false);
    }
  });
});

describe("continueMessage", () => {
  it("is the person's note, or a bare Continue", () => {
    expect(continueMessage(undefined)).toBe("Continue");
    expect(continueMessage("  ")).toBe("Continue");
    expect(continueMessage("skip the PDF")).toBe("Continue: skip the PDF");
  });
});

describe("resumeFailureOf", () => {
  it("maps RunNotResumableError to a 4xx a person can act on", () => {
    const f = resumeFailureOf(new RunNotResumableError({ runId: "r", reason: "not loop-stopped" }));
    expect(f.code).toBe("not-resumable");
    expect(resumeStatusOf(f.code)).toBe(409);
    expect(f.message).toContain("Send a new message instead");
    expect(f.message).not.toContain("RunNotResumableError");
  });

  it("maps the other framework resume errors and falls back to a 422", () => {
    expect(resumeFailureOf(new DurableRunNotFoundError({ runId: "r" })).code).toBe("not-found");
    const mismatch = resumeFailureOf(new DurableConfigMismatchError({ runId: "r", storedHash: "a", currentHash: "b" }));
    expect(mismatch.code).toBe("not-resumable");
    const other = resumeFailureOf(new Error("boom"));
    expect(other).toEqual({ code: "failed", message: "boom" });
    expect(resumeStatusOf(other.code)).toBe(422);
    expect(resumeStatusOf("not-found")).toBe(404);
    expect(resumeStatusOf("busy")).toBe(409);
  });
});

describe("ResumeGuard", () => {
  it("refuses a second claim of a run until the first is released", () => {
    const g = new ResumeGuard();
    const release = g.claim("r");
    expect(release).toBeDefined();
    expect(g.claim("r")).toBeUndefined();
    expect(g.claim("other")).toBeDefined();
    release!();
    expect(g.isLive("r")).toBe(false);
    expect(g.claim("r")).toBeDefined();
  });
});

describe("chatDurableSource", () => {
  it("finds a session's store from its stable id and configured dir", () => {
    expect(chatDurableSource({ stableAgentId: "chat-1", agentConfig: {} })).toEqual({ agentId: "chat-1" });
    expect(chatDurableSource({ stableAgentId: "chat-1", agentConfig: { durableRuns: { enabled: true, dir: "/d" } } })).toEqual({ agentId: "chat-1", dir: "/d" });
    expect(chatDurableSource({ agentConfig: {} })).toBeUndefined();
    expect(chatDurableSource(undefined)).toBeUndefined();
  });
});
