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
  it("offers only loop-stopped resumable runs, newest first", () => {
    const out = resumableRunsOf([
      rec({ runId: "old", updatedAt: 1, loopStop: stop, resumable: true }),
      rec({ runId: "new", updatedAt: 5, loopStop: stop, resumable: true }),
      rec({ runId: "plain", updatedAt: 9 }),
      rec({ runId: "flagless", updatedAt: 9, loopStop: stop }),
    ]);
    expect(out.map((r) => r.runId)).toEqual(["new", "old"]);
    expect(out[0]!.loopStop).toEqual(stop);
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
